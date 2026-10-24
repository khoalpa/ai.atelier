"""Source-bound replay of one published character variant."""
import json
import secrets
from pathlib import Path
import character
import makeup
from PIL import Image


def regenerate(body,env):
    root=Path(env['ROOT']).resolve();base=(Path(env['OUTPUTS'])/'character').resolve()
    value=body.get('file')
    if not isinstance(value,str):raise ValueError('Chọn phương án cần tạo lại.')
    path=(root/value).resolve()
    if not path.is_relative_to(base) or path.suffix!='.png' or not path.is_file():raise ValueError('Phương án không hợp lệ.')
    metadata=path.parent/'metadata.json'
    if not metadata.is_file():raise ValueError('Không tìm thấy thiết lập của phương án.')
    report=json.loads(metadata.read_text(encoding='utf8'))
    item=next((item for item in report.get('results',[]) if (root/item.get('file','')).resolve()==path),None)
    if item is None or item.get('previewOnly'):raise ValueError('Chỉ tạo lại phương án đã lưu đầy đủ.')
    request={**item['settings'],'sampleId':item['sampleId'],'sourceSha256':item['sourceSha256'],'count':1,'preview':False,
             'variantOffset':item.get('variantIndex',report['results'].index(item)),'seed':secrets.randbelow(2147483640),'parentFile':value,'jobId':body.get('jobId','')}
    for key,name in [('protectedDetailMask','protected_mask.png'),('editableMask','editable_mask.png')]:
        with Image.open(path.parent/name) as image:request[key]=makeup.encode(image.convert('L'))
    # Revalidate original/reference hashes and masks. Published files are never
    # replaced; a retry is a new child run with its own cancellation lifecycle.
    prepared=character.prepare(request,env)
    request['planHash']=prepared['plan_hash']
    return character.run(request,env)
