"""Validate local manual-editor images and preserve their decoded RGBA pixels."""
import sys
from pathlib import Path
from PIL import Image, ImageOps, ImageCms

Image.MAX_IMAGE_PIXELS = 16777216

def normalize(source, target):
    with Image.open(source) as opened:
        if opened.format not in ('PNG', 'JPEG', 'WEBP'):
            raise ValueError('Chỉ hỗ trợ PNG, JPEG hoặc WebP.')
        if getattr(opened, 'n_frames', 1) != 1:
            raise ValueError('Chọn ảnh tĩnh, không dùng ảnh động.')
        w, h = opened.size
        if w * h > 16777216 or max(w, h) > 8192:
            raise ValueError('Ảnh tối đa 16 triệu pixel và 8192 px mỗi chiều.')
        opened.load()
        image = ImageOps.exif_transpose(opened).convert('RGBA')
        icc = opened.info.get('icc_profile')
        if icc:
            from io import BytesIO
            alpha = image.getchannel('A')
            rgb = ImageCms.profileToProfile(image.convert('RGB'), ImageCms.ImageCmsProfile(BytesIO(icc)), ImageCms.createProfile('sRGB'), outputMode='RGB')
            image = rgb.convert('RGBA'); image.putalpha(alpha)
        if target == '--verify':
            return image.size
        suffix = Path(target).suffix.lower()
        if suffix == '.jpg':
            background = Image.new('RGB', image.size, 'white'); background.paste(image, mask=image.getchannel('A')); image = background
        image.save(target, **({'quality':95} if suffix in ('.jpg', '.webp') else {}))
        return image.size

if __name__ == '__main__':
    try:
        import json
        width,height=normalize(sys.argv[1],sys.argv[2]);print(json.dumps({'width':width,'height':height}))
    except Exception as exc:
        print(str(exc),file=sys.stderr);sys.exit(1)
