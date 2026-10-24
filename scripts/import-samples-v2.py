"""Import reviewed new images and build a compact demo index and credits."""
from pathlib import Path
import hashlib
from datetime import datetime, timezone
import html
import json
import shutil
import sys
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')
    temporary.replace(path)


def main():
    home=ROOT/'samples'
    catalog=json.loads((home/'catalog.json').read_text(encoding='utf-8'))
    aliases=json.loads((home/'aliases.json').read_text(encoding='utf-8'))
    groups={'people':'Người mẫu','faces':'Chân dung','garments':'Trang phục','scenes':'Bối cảnh','objects':'Đồ vật'}
    assets={a['id']:a for a in catalog['assets']}
    for folder in ('generated','downloaded'):
        source=ROOT/'workspace/sample-intake/v2'/folder
        rows=sorted(source.glob('*.json'))
        expected=32 if folder=='generated' else 16
        if len(rows)!=expected:raise ValueError(f'Expected {expected} reviewed assets in {folder}, got {len(rows)}')
        for file in rows:
            row=json.loads(file.read_text(encoding='utf-8'))
            if row.get('review')!='accepted':raise ValueError('Visual review pending: '+row['id'])
            original=source/(row['id']+'.png' if folder=='generated' else row['file'])
            relative=f"demo/{row['group']}/{row['id']}{original.suffix.lower()}"
            target=home/relative;target.parent.mkdir(parents=True,exist_ok=True)
            digest=hashlib.sha256(original.read_bytes()).hexdigest()
            if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest()!=digest:raise ValueError('Conflicting imported asset')
            shutil.copy2(original,target)
            with Image.open(target) as im:width,height=im.size
            generated=folder=='generated'
            provenance=({'synthetic':True,'generator':'ChatGPT built-in ImageGen','prompt':row['prompt'],
                         'license':'generation-terms','redistributable':True,'generatedAt':datetime.fromtimestamp(original.stat().st_mtime, timezone.utc).isoformat(),
                         'adultFictionalPeople':True,'sourceRecord':f'licenses/{row["id"]}.json'} if generated else
                        {'synthetic':False,'sourceUrl':row['sourceUrl'],'downloadUrl':row['downloadUrl'],
                         'license':row['license'],'licenseUrl':row['licenseUrl'],'author':row['author'],
                         'credit':row['credit'],'redistributable':True,'modifications':row['modifications'],
                         'sourceRecord':f'licenses/{row["id"]}.json'})
            assets[relative]={'id':relative,'path':relative,'storage':'samples','label':row['label'],
                             'group':groups[row['group']],'roles':['demo'],'tasks':row['tasks'],
                             'sha256':digest,'width':width,'height':height,'bytes':target.stat().st_size,
                             'provenance':provenance,'evaluation':'demo-visible; not an independent holdout'}
            aliases['aliases'][relative]=relative
            save(home/f'licenses/{row["id"]}.json',row)
    catalog['assets']=list(assets.values())
    save(home/'aliases.json',aliases);save(home/'catalog.json',catalog)
    demo=[a for a in catalog['assets']if 'demo'in a['roles']]
    if len(demo)!=64:raise ValueError(f'Expected 64 demo images, got {len(demo)}')
    cards=[]
    for asset in demo:
        thumbnail=f'previews/demo/{asset["sha256"][:16]}.webp'
        target=home/thumbnail;target.parent.mkdir(parents=True,exist_ok=True)
        with Image.open(resolve_sample(ROOT,asset['id'])) as image:
            preview=ImageOps.exif_transpose(image)
            preview.thumbnail((384,384))
            preview.save(target,'WEBP',quality=84)
        asset['thumbnail']=thumbnail
        provenance=asset['provenance']
        esc=lambda value:html.escape(str(value))
        source=provenance.get('sourceUrl','')
        author=provenance.get('author',provenance.get('source','ChatGPT / OpenAI ImageGen'))
        license_url=provenance.get('licenseUrl','')
        license_text=esc(provenance['license'])
        if license_url:license_text=f'<a href="{esc(license_url)}">{license_text}</a>'
        cards.append(f'<article id="{asset["sha256"][:16]}"><img src="/sample-thumbnails/{asset["sha256"][:16]}.webp" alt="{esc(asset["label"])}"><div><h2>{esc(asset["label"])}</h2><p>{esc(author)}</p><p>{license_text}</p>'+
                     (f'<a href="{esc(source)}">Trang nguồn</a>'if source else'<p>Ảnh tổng hợp; không phải ảnh chụp người thật hoặc hàng hóa thật.</p>')+
                     '<p>Ảnh gốc được giữ nguyên. Ảnh xem trước đã thu nhỏ. Khi chia sẻ bản chỉnh sửa, giữ thông tin nguồn và tuân theo giấy phép của từng ảnh.</p></div></article>')
    page='<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nguồn ảnh mẫu — AI Atelier</title><style>body{max-width:960px;margin:40px auto;padding:0 20px;font:16px/1.6 system-ui;color:#223}article{display:flex;gap:24px;border-top:1px solid #ddd;padding:24px 0}img{width:180px;height:180px;object-fit:contain}h2{margin:0;font-size:20px}a{color:#245db4}p{margin:8px 0}</style><h1>Nguồn ảnh mẫu</h1><p>64 ảnh tuyển chọn. Giấy phép dưới đây áp dụng cho từng ảnh, không thay thế giấy phép phần mềm.</p>'+''.join(cards)+'</html>'
    (home/'licenses/index.html').write_text(page,encoding='utf-8')
    save(home/'catalog.json',catalog)
    save(ROOT/'workspace/diagnostics/samples-v2/import-result.json',{'demo':len(demo),'generated':32,'downloaded':16,'reused':16,'assets':len(assets)})
    print(json.dumps({'demo':len(demo),'generated':32,'downloaded':16,'reused':16}))


if __name__=='__main__':main()
