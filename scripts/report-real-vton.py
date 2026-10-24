"""Local, stage-by-stage real VTON review; no automatic model promotion."""
import argparse
import html
import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parents[1]
RUN_LABELS={'base-auto-1024':'CatVTON gốc — vùng tự động',
            'adapted-auto-1024':'CatVTON tinh chỉnh — vùng tự động',
            'base-reviewed-1024':'CatVTON gốc — vùng đã duyệt',
            'idm-vton-auto-1024':'IDM-VTON — vùng tự động'}


def review_html(review):
    text='<h2>Kết luận trực quan</h2>'
    text+='<p>'+html.escape(review.get('summary','Đang hoàn tất đối chiếu; chưa thay mô hình đang dùng.'))+'</p>'
    for note in review.get('limitations',[]):
        text+='<p>'+html.escape(note)+'</p>'
    for name,run in review.get('runs',{}).items():
        text+='<details><summary>'+html.escape(RUN_LABELS.get(name,name))+'</summary>'
        for item in run.get('cases',[]):
            text+='<p><strong>'+html.escape(item['case'])+'</strong></p><ul>'
            text+=''.join('<li>'+html.escape(note)+'</li>' for note in item.get('findings',[]))+'</ul>'
        text+='</details>'
    return text


def report(root):
    manifest=json.loads((root/'cases.json').read_text(encoding='utf-8'))
    cases=manifest['cases'];runs=sorted(p for p in (root/'results').iterdir() if p.is_dir() and (p/'config.json').is_file())
    summaries=[];body=[]
    for run in runs:
        records=[json.loads(p.read_text(encoding='utf-8')) for p in run.glob('*/result.json')]
        complete=[r for r in records if r['status']=='completed']
        mae=[r['metrics']['pairedEditMAE'] for r in complete if r['metrics']['pairedEditMAE'] is not None]
        summaries.append({'run':run.name,'completed':len(complete),'failed':sum(r['status']=='failed' for r in records),
                          'running':sum(r['status']=='running' for r in records),
                          'pairedMAE':sum(mae)/len(mae) if mae else None,
                          'outsideMaskChangedPixels':sum(r['metrics']['outsideMaskChangedPixels'] for r in complete),
                          'protectedChangedPixels':sum(r['metrics']['protectedChangedPixels'] for r in complete),
                          'oldGarmentExcludedPixels':sum(r['metrics']['oldGarmentExcludedPixels'] for r in complete),
                          'autoGatePassed':sum(r['qualityGate']['passed'] for r in complete)})
    def figure(path,label):
        link=html.escape(path.relative_to(root).as_posix(),quote=True)
        return '<figure><a href="'+link+'" target="_blank"><img loading="lazy" src="'+link+'"></a><figcaption>'+html.escape(label)+'</figcaption></figure>'
    for case in cases:
        folder=root/'inputs'/case['id']
        body.append('<section data-mode="'+case['mode']+'"><h2>'+html.escape(case['id'])+'</h2><div class="images">')
        for file,label in [('source.png','Ảnh gốc'),('garment.png','Sản phẩm'),('auto-preview.jpg','Vùng tự động'),('reviewed-preview.jpg','Vùng đối chứng')]:
            body.append(figure(folder/file,label))
        body.append('</div>')
        for run in runs:
            current=run/case['id'];result=current/'result.json'
            if not result.is_file():continue
            record=json.loads(result.read_text(encoding='utf-8'))
            body.append('<details open><summary>'+html.escape(RUN_LABELS.get(run.name,run.name))+'</summary>')
            if record['status']=='completed':
                body.append('<div class="images">')
                for file,label in [('actual-mask.png','Vùng thay thực tế'),('model-raw.png','Ảnh thô của mô hình'),('restored-raw.png','Ảnh thô về tỷ lệ gốc'),('final.png','Ảnh sau ghép')]:
                    body.append(figure(current/file,label))
                body.append('</div><details><summary>Số đo chi tiết</summary><pre>'+html.escape(json.dumps(record['metrics'],indent=2))+'</pre></details>')
            else:body.append('<p>'+html.escape(record.get('error','Đang xử lý' if record['status']=='running' else 'Chưa hoàn tất'))+'</p>')
            body.append('</details>')
        body.append('</section>')
    review_file=root/'visual-review.json'
    review=json.loads(review_file.read_text(encoding='utf-8')) if review_file.is_file() else {'status':'pending_visual_review','promote':False}
    data={'independentTestSet':False,'runs':summaries,'review':review,
          'limitations':manifest['limitations'],'autoGateIsNotVisualApproval':True}
    (root/'summary.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    page='''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Đối chứng Thay trang phục</title>
<style>body{font:16px system-ui;background:#f5f7fa;color:#17243b;max-width:1500px;margin:auto;padding:24px}section{background:white;padding:20px;margin:24px 0;border-radius:16px}h2{font-size:19px}.images{display:flex;gap:12px;flex-wrap:wrap}figure{margin:8px 0;width:calc(25% - 12px)}img{width:100%;height:370px;object-fit:contain;background:#eee}figcaption{text-align:center;padding:8px}summary{cursor:pointer;padding:15px;background:#e9eff8}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{padding:10px;margin:6px}table{border-collapse:collapse}td,th{padding:10px;border:1px solid #c9d2df}@media(max-width:700px){figure{width:calc(50% - 8px)}img{height:260px}}</style>
<h1>Đối chứng Thay trang phục trên ảnh thật</h1><p>12 ca: tái tạo đúng áo và đổi sang áo khác. Cùng ảnh, seed và thông số trong mỗi phép so sánh. Ảnh người được chuẩn bị lại từ ảnh gốc; mô hình dùng khung 768 × 1024. Bộ này đã dùng để chọn thí nghiệm, chưa phải bộ kiểm tra độc lập.</p>
<p>Đối chiếu cổ, tay, gấu, lớp áo, họa tiết/logo, áo cũ còn sót và cơ thể. Sai số màu và kiểm tra tự động không thay thế đánh giá này.</p>
<p>Phép thử dùng ảnh sản phẩm đã chuẩn bị và vùng chọn cố định; tắt tạo lại cơ thể, sửa biên và lượt thử lại để phân biệt lỗi vùng chọn, mô hình và ghép ảnh. Đây là đối chứng chẩn đoán, chưa phải đánh giá mọi chế độ của ứng dụng.</p>'''
    page+='<table><tr><th>Lượt</th><th>Hoàn tất</th><th>MAE tái tạo</th><th>Điểm ảnh đổi ngoài vùng</th><th>Điểm ảnh đổi trong vùng bảo vệ</th></tr>'
    for row in summaries:
        values=[RUN_LABELS.get(row['run'],row['run']),row['completed'],
                f'{row["pairedMAE"]:.3f}' if row['pairedMAE'] is not None else 'Không áp dụng',
                row['outsideMaskChangedPixels'],row['protectedChangedPixels']]
        page+='<tr>'+''.join('<td>'+html.escape(str(value))+'</td>' for value in values)+'</tr>'
    page+='</table>'+review_html(review)
    page+='''<button onclick="filter('all')">Tất cả</button><button onclick="filter('paired')">Tái tạo</button><button onclick="filter('transfer')">Đổi áo</button>'''+''.join(body)
    page+='''<script>function filter(mode){document.querySelectorAll('section').forEach(s=>s.hidden=mode!=='all'&&s.dataset.mode!==mode)}</script></html>'''
    (root/'review.html').write_text(page,encoding='utf-8')
    # Contact sheets are derived previews only; all full resolution assets remain.
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',15)
    for mode in ('paired','transfer'):
        subset=[c for c in cases if c['mode']==mode]
        for start in range(0,len(subset),3):
            columns=2+len(runs);sheet=Image.new('RGB',(columns*220,3*335),'white');draw=ImageDraw.Draw(sheet)
            for index,case in enumerate(subset[start:start+3]):
                files=[(root/'inputs'/case['id']/'source.png','Source'),(root/'inputs'/case['id']/'garment.png','Garment')]
                files += [(run/case['id']/'final.png',run.name) for run in runs]
                for col,(path,label) in enumerate(files):
                    draw.text((col*220+3,index*335+3),label,font=font,fill='black')
                    draw.text((col*220+3,index*335+20),case['sourceId'],font=font,fill='black')
                    if path.is_file():
                        im=Image.open(path).convert('RGB');im.thumbnail((216,290));sheet.paste(im,(col*220,index*335+40))
            sheet.save(root/f'comparison-{mode}-{start//3+1}.jpg',quality=95)
    print(json.dumps(summaries,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--root',type=Path,default=ROOT/'workspace/diagnostics/real-vton-20261022')
    report(parser.parse_args().root.resolve())
