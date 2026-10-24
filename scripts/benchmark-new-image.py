"""Fixed prompts/seeds; baseline versus candidate settings and anonymous visual review."""
import argparse
import hashlib
import html
import json
import os
import time
import urllib.request
import urllib.error
import uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
CASES=[
 ('product','Studio product photograph of a blue cotton shirt laid flat on a white background, complete garment, realistic fabric weave, soft directional light.','1:1'),
 ('portrait','Fashion portrait of an adult woman wearing a beige linen jacket, natural skin texture, relaxed expression, soft window light, gray studio background.','4:5'),
 ('full-body','Full-body editorial photograph of an adult man wearing a navy suit and brown shoes, standing with both hands visible, entire body in frame, neutral studio background.','2:3'),
 ('two-people','Two adults standing side by side, woman on the left wearing a red jacket, man on the right wearing a blue shirt, both faces and hands visible, daylight.','3:2'),
 ('fabric','Close-up product photograph of a folded green and cream checkered cotton shirt, regular intersecting lines, visible seams and buttons, soft studio light.','1:1'),
 ('composition','Wide fashion campaign photograph, an adult woman in a yellow coat on the left third, empty pale gray wall on the right, full body visible, soft side lighting.','16:9'),
]


def post(base,path,body):
    req=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(req,timeout=7200) as r:return json.load(r)
    except urllib.error.HTTPError as error:
        raise RuntimeError(error.read().decode('utf-8',errors='replace')) from error


def render(directory):
    reports=[]
    for p in sorted(directory.glob('case-*.json')):
        v=json.loads(p.read_text(encoding='utf-8'))
        if v.get('result',{}).get('results'):reports.append(v)
    key={};cards=[]
    # Stable hash order conceals model/profile identities until the reviewer opens the key.
    reports.sort(key=lambda r:hashlib.sha256(r['id'].encode()).hexdigest())
    for i,r in enumerate(reports,1):
        item=r['result']['results'][0];name=f'Image {i:02}';review_id=hashlib.sha256(r['id'].encode()).hexdigest()[:16]
        key[name]={'reviewKey':review_id,'id':r['id'],'model':r['request']['modelId'],'profile':r['profile'],'report':r['result']['report']}
        path=ROOT/'workspace'/item['image'].lstrip('/')
        relative=os.path.relpath(path,directory).replace('\\','/')
        inputs=''.join(f'<label>{label}<input type="number" min="1" max="5" data-key="{review_id}:{field}"></label>' for field,label in [('intent','Đúng yêu cầu'),('anatomy','Hình thể'),('material','Chất liệu'),('composition','Bố cục'),('clean','Ít lỗi')])
        cards.append(f'<article><h2>{name} · {html.escape(r["case"])}</h2><p>{html.escape(r["request"]["prompt"])}</p><a href="{relative}"><img src="{relative}"></a><div>{inputs}</div><textarea data-key="{review_id}:notes" placeholder="Ghi chú; bỏ trống tiêu chí không áp dụng"></textarea></article>')
    (directory/'blind-key.json').write_text(json.dumps(key,ensure_ascii=False,indent=2),encoding='utf-8')
    page='''<!doctype html><meta charset="utf-8"><title>Đối chiếu Ảnh mới</title><style>body{font:16px system-ui;background:#f4f1eb;margin:24px;color:#24302c}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(330px,1fr));gap:24px}article{background:white;padding:16px;border-radius:12px}img{width:100%;max-height:600px;object-fit:contain}label{display:inline-block;width:30%;font-size:13px}input{width:45px;margin:5px}textarea{width:95%;margin-top:15px}button{padding:12px;margin:16px 0}</style><h1>Đối chiếu Ảnh mới</h1><p>Chấm từ 1 (kém) đến 5 (tốt). Không hiện model hay cấu hình khi chấm. Xem ảnh ở kích thước đầy đủ trước khi nhận xét. Để trống tiêu chí không áp dụng.</p><button id="export">Tải điểm duyệt</button><main>'''+''.join(cards)+'''</main><script>const key='new-image-review:'+location.pathname;let values=JSON.parse(localStorage.getItem(key)||'{}');document.querySelectorAll('[data-key]').forEach(e=>{e.value=values[e.dataset.key]||'';e.addEventListener('input',()=>{values[e.dataset.key]=e.value;localStorage.setItem(key,JSON.stringify(values));});});document.getElementById('export').onclick=()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(values,null,2)],{type:'application/json'}));a.download='review-scores.json';a.click();URL.revokeObjectURL(a.href);};</script>'''
    (directory/'index.html').write_text(page,encoding='utf-8')
    return reports


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--base',default='http://127.0.0.1:47860');ap.add_argument('--models',nargs='+',default=['flux-2-klein-4b','sd35-medium','flux-chroma1-hd']);ap.add_argument('--limit',type=int,default=1);ap.add_argument('--seeds',nargs='+',type=int,default=[433]);ap.add_argument('--profiles',nargs='+',default=['baseline','candidate']);ap.add_argument('--output',default='workspace/diagnostics/new-image-quality');ap.add_argument('--render-only',action='store_true');args=ap.parse_args()
    directory=ROOT/args.output;directory.mkdir(parents=True,exist_ok=True)
    if not args.render_only:
        for model in args.models:
            for case,prompt,ratio in CASES[:args.limit]:
                for seed in args.seeds:
                    for profile in args.profiles:
                        identity=f'{model}-{case}-{seed}-{profile}';file=directory/f'case-{identity}.json'
                        if file.exists() and json.loads(file.read_text(encoding='utf-8')).get('result',{}).get('ok'):continue
                        klein=model=='flux-2-klein-4b';chroma=model=='flux-chroma1-hd';baseline=profile=='baseline'
                        body={'jobId':'new-image-bench-'+uuid.uuid4().hex,'modelId':model,'prompt':prompt,'negativePrompt':'' if klein else 'blur, distorted anatomy, watermark',
                              'size':768 if baseline else 1024,'aspectRatio':'1:1' if baseline else ratio,'count':1,'seed':seed,
                              'steps':4 if klein else (28 if chroma else 35) if baseline else 40,'guidance':1 if klein else 3 if baseline or chroma else 4.5,'livePreview':False}
                        print('START '+identity,flush=True)
                        record={'id':identity,'case':case,'profile':profile,'request':body}
                        try:
                            planned=post(args.base,'/api/new-image-plan',body)
                            if not planned['valid']:raise ValueError(' '.join(planned['errors']))
                            record['result']=post(args.base,'/api/chroma-generate',body)
                            print('DONE '+identity+' '+str(record['result'].get('totalSeconds'))+' s',flush=True)
                        except Exception as error:
                            record['error']=str(error);print('FAILED '+identity+' '+str(error),flush=True)
                        file.write_text(json.dumps(record,ensure_ascii=False,indent=2),encoding='utf-8');render(directory)
    render(directory);print(directory/'index.html',flush=True)


if __name__=='__main__':main()
