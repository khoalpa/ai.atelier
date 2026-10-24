"""Local, source-bound subject masks for the manual editor."""
import hashlib
import io
import re
from pathlib import Path

import numpy as np
from PIL import Image


def cutout(body, root, segment):
    match = re.fullmatch(r"/manual-assets/([a-f0-9]{64})\.png", str(body.get("asset", "")))
    if not match:
        raise ValueError("Ảnh không thuộc phiên chỉnh sửa.")
    directory = Path(root) / "workspace/manual/assets"
    source_path = directory / (match[1] + ".png")
    if source_path.resolve().parent != directory.resolve():
        raise ValueError("Đường dẫn ảnh không hợp lệ.")
    with Image.open(source_path) as image:
        if image.width * image.height > 16777216 or max(image.size) > 8192:
            raise ValueError("Ảnh vượt giới hạn 16 triệu pixel.")
        source = image.convert("RGBA")
    mask = segment(source.convert("RGB"))
    if mask is None:
        raise ValueError("Chưa có model tách chủ thể trên máy. Có thể dùng vùng chọn thủ công.")
    mask = mask.convert("L").resize(source.size, Image.Resampling.BILINEAR)
    values = np.asarray(mask, dtype=np.float32)
    # The renderer applies source alpha once when compositing the subject.
    visible = values * np.asarray(source.getchannel("A"), dtype=np.float32) / 255
    if float((visible > 0).mean()) < .001:
        raise ValueError("Chưa nhận diện được chủ thể. Dùng vùng chọn để chỉ rõ phần cần giữ.")
    output = Image.fromarray(values.astype(np.uint8), "L").convert("RGB")
    stream = io.BytesIO()
    output.save(stream, "PNG")
    data = stream.getvalue()
    name = hashlib.sha256(data).hexdigest() + ".png"
    target = directory / name
    if not target.exists():
        temporary = directory / (name + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(target)
    return {"ok": True, "maskUrl": "/manual-assets/" + name,
            "width": source.width, "height": source.height}
