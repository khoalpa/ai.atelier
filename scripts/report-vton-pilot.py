"""Build a local visual comparison from a completed pilot; no image uploads."""
import argparse
import html
import json
import os
from pathlib import Path
from urllib.parse import quote

from PIL import Image, ImageDraw, ImageFont


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--run',type=Path,required=True)
    args=parser.parse_args(); root=args.run.resolve()
    report=json.loads((root/'run.json').read_text(encoding='utf-8'))
    if report['status']!='completed':
        raise ValueError('Only completed experiments can be reported')
    data=Path(report['config']['dataset']).resolve()
    rows=[json.loads(line) for line in (data/'manifest.jsonl').read_text(encoding='utf-8').splitlines()]
    val=[row for row in rows if row['split']=='validation']
    by_product={r['productId']:r for r in rows}
    review_path=root/'visual-review.json'
    review=json.loads(review_path.read_text(encoding='utf-8')) if review_path.is_file() else {}
    observations={(r['id'],r['mode']):r for r in review.get('records',[])}
    font=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',18)
    small=ImageFont.truetype('C:/Windows/Fonts/arial.ttf',16)
    sections=[]
    for mode,title in [('paired','Tái tạo đúng mẫu áo'),('transfer','Thay sang mẫu áo khác')]:
        cards=[];sheets=[]
        for index,row in enumerate(val):
            tile=index%3
            if tile==0:
                sheet=Image.new('RGB',(4*300,min(3,len(val)-index)*440),(246,246,246));draw=ImageDraw.Draw(sheet)
            ref=row
            if mode=='transfer':
                ref=by_product[report['baseline']['records'][index]['transferProductId']]
            items=[('Ảnh gốc',data/row['personImage']),('Áo tham chiếu',data/ref['productImage']),
                   ('Trước huấn luyện',root/'baseline'/f'{row["id"]}-{mode}.png'),
                   ('Sau huấn luyện',root/'adapted'/f'{row["id"]}-{mode}.png')]
            label=Path(row['sourcePersonImage']).stem
            draw.text((8,tile*440+2),label,font=small,fill='#202020')
            cells=[]
            for col,(caption,path) in enumerate(items):
                im=Image.open(path).convert('RGB'); im.thumbnail((290,385),Image.Resampling.LANCZOS)
                sheet.paste(im,(col*300+(300-im.width)//2,tile*440+50))
                draw.text((col*300+8,tile*440+27),caption,font=font,fill='#202020')
                url=quote(os.path.relpath(path,root).replace('\\','/'))
                cells.append(f'<figure><figcaption>{caption}</figcaption><a href="{url}" target="_blank"><img loading="lazy" src="{url}" alt="{html.escape(label+" — "+caption)}"></a></figure>')
            note=observations.get((row['id'],mode),{})
            notes=''.join(f'<p><strong>{caption}:</strong> {html.escape(note[field])}</p>'
                for field,caption in [('baselineIssuesVi','Trước'),('adaptedIssuesVi','Sau'),('changeVi','Đối chiếu')]
                if note.get(field))
            cards.append(f'<article><h3>{html.escape(label)} · {html.escape(row.get("cohort",""))}</h3><div class="images">'+''.join(cells)+'</div>'+notes+'</article>')
            if tile==2 or index==len(val)-1:
                name=f'comparison-{mode}-page-{index//3+1}.jpg';sheet.save(root/name,quality=94);sheets.append(name)
        links=' · '.join(f'<a href="{name}">Bảng ảnh {i+1}</a>' for i,name in enumerate(sheets))
        sections.append(f'<section><h2>{title}</h2><p>{links}</p>'+''.join(cards)+'</section>')
    before=report['baseline']['meanPairedEditRegionMAE']; after=report['adapted']['meanPairedEditRegionMAE']
    conclusion=html.escape(review.get('summaryVi','Đang chờ kết luận kiểm tra trực quan.'))
    width,height=report['method']['resolution']
    dataset_url=quote(os.path.relpath(data/'intake-status.json',root).replace('\\','/'))
    verification=''
    if (root/'checkpoint-verification.json').is_file():
        verified=json.loads((root/'checkpoint-verification.json').read_text(encoding='utf-8'))
        if verified.get('verified') and verified.get('sha256')==report.get('attentionSha256'):
            verification='<p>Đã kiểm tra nạp lại đúng trọng số đã lưu bằng bộ nạp mô hình. <a href="checkpoint-verification.json">Chi tiết kiểm tra</a>.</p>'
    cohort_rows=''
    for cohort,stats in report['baseline'].get('cohorts',{}).items():
        later=report['adapted']['cohorts'][cohort]
        cohort_rows+=f'<tr><td>{html.escape(cohort)} ({stats["count"]} ảnh)</td><td>{stats["meanPairedEditRegionMAE"]:.3f}</td><td>{later["meanPairedEditRegionMAE"]:.3f}</td></tr>'
    page=f'''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Đối chiếu huấn luyện thử — Couple Tee</title><style>
body{{font:16px/1.6 system-ui,sans-serif;background:#f3f4f6;color:#192334;margin:0;padding:32px}}
main{{max-width:1350px;margin:auto}}h1{{font-size:30px}}h2{{margin-top:48px}}article{{background:white;padding:20px;border-radius:14px;margin:20px 0}}
.images{{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}}figure{{margin:0}}img{{width:100%;height:auto;max-height:450px;object-fit:contain}}figcaption{{font-weight:600;margin-bottom:10px}}
.note{{background:#fff5dc;border-left:4px solid #d49a21;padding:18px}}table{{border-collapse:collapse}}td,th{{padding:10px 20px;text-align:left;border-bottom:1px solid #ccd2da}}
@media(max-width:700px){{body{{padding:12px}}.images{{grid-template-columns:repeat(2,1fr)}}}}
</style><main><h1>Đối chiếu huấn luyện thử — Couple Tee</h1>
<p>{len(by_product)} sản phẩm · {report['counts']['train']} cặp huấn luyện · {len(val)} cặp kiểm định thuộc {len({r['productId'] for r in val})} sản phẩm riêng · {report['config']['steps']} bước cập nhật.</p>
<p class="note">Đây là thử nghiệm quy mô nhỏ. Chưa xác nhận các nhóm dùng những người mẫu khác nhau. Ảnh sản phẩm còn phụ kiện và một số lỗi biên tách nền. Chưa bật mô hình thử nghiệm trong ứng dụng.</p>
<p><strong>Kết luận kiểm tra trực quan:</strong> {conclusion}</p>
{verification}<p><a href="{dataset_url}">Thống kê bộ dữ liệu</a> · <a href="run.json">Thông số và chỉ số đầy đủ</a> · <a href="training.jsonl">Nhật ký huấn luyện</a></p>
<table><tr><th>Đo trên vùng áo của {len(val)} ảnh tái tạo</th><th>Trước</th><th>Sau</th></tr><tr><td>Sai số màu trung bình, thang 0–255; thấp hơn tốt hơn</td><td>{before:.3f}</td><td>{after:.3f}</td></tr>{cohort_rows}</table>
<p>Chỉ số này đo độ gần với ảnh gốc, không đủ kết luận về logo, kiểu cổ, tay áo hay chất lượng thay sang áo khác. Các ảnh thay áo khác không có ảnh thật tương ứng để tính sai số.</p>
{''.join(sections)}<p>Ảnh hiển thị là đầu ra trực tiếp của mô hình ở {width} × {height}, chưa ghép phục hồi vùng ngoài và vùng bảo vệ. Hai bản dùng cùng đầu vào, vùng thay và hạt giống ngẫu nhiên.</p>
</main></html>'''
    (root/'review.html').write_text(page,encoding='utf-8')
    print(json.dumps({'review':str(root/'review.html'),'beforeMAE':before,'afterMAE':after}))


if __name__=='__main__': main()
