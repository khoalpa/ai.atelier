"""Build a local review report from completed, paired object-removal trials."""
from datetime import datetime, timezone
import html
import json
from pathlib import Path
from statistics import median
from urllib.parse import quote

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'workspace/diagnostics/object-removal-benchmark'
MODELS=['sdxl-inpaint-base-0.1','flux-1-fill-dev']


def main():
    rows=[json.loads(p.read_text(encoding='utf-8')) for p in OUT.glob('*.json')
          if p.name not in ('summary.json','acceptance.json')]
    rows=[row for row in rows if 'maskedMAE' in row]
    groups={model:{row['case']['id']:row for row in rows if row['model']==model} for model in MODELS}
    summary={'createdAt':datetime.now(timezone.utc).isoformat(),'synthetic':True,
             'limitation':'Ảnh tổng hợp có nền chuẩn; không phải tỷ lệ thành công trên ảnh chụp thực tế.',
             'models':{}}
    for model,items in groups.items():
        data=list(items.values())
        if data:summary['models'][model]={'cases':len(data),'medianMaskedMAE':median(r['maskedMAE'] for r in data),
            'medianSeconds':median(r['seconds'] for r in data),'improvedOverInput':sum(r['improvedOverInput'] for r in data),
            'outsidePreserved':sum(r['outsideMaxDifference']==0 for r in data)}
    common=sorted(set(groups[MODELS[0]])&set(groups[MODELS[1]]))
    summary['pairedComparison']={'cases':len(common),'winsByMaskedMAE':{model:sum(groups[model][key]['maskedMAE']<groups[other][key]['maskedMAE'] for key in common) for model,other in [MODELS,MODELS[::-1]]}}
    tests_path=ROOT/'workspace/diagnostics/object-removal-tests.json'
    if tests_path.exists():
        tests=json.loads(tests_path.read_text(encoding='utf-8'))
        summary['tests']={'passed':sum(t['passed'] for t in tests),'total':len(tests)}
    (OUT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    totals=''.join(f'<tr><td>{html.escape(model)}</td><td>{data["cases"]}</td><td>{data["medianMaskedMAE"]:.2f}</td><td>{data["medianSeconds"]:.1f} giây</td><td>{data["outsidePreserved"]}/{data["cases"]}</td></tr>' for model,data in summary['models'].items())
    cards=[]
    manifest=json.loads((ROOT/'samples/object-removal-benchmark/manifest.json').read_text(encoding='utf-8'))
    for case in manifest['cases']:
        key=case['id'];figures=[]
        def figure(label,src,caption=''):
            return f'<figure><figcaption>{html.escape(label)}</figcaption><a href="{html.escape(src)}"><img loading="lazy" src="{html.escape(src)}" alt="{html.escape(label)}"></a><small>{html.escape(caption)}</small></figure>'
        base='../../../samples/object-removal-benchmark/'+quote(key)
        figures.append(figure('Ảnh đầu vào',base+'/source.png'))
        figures.append(figure('Vùng xóa',base+'/mask.png'))
        for model in MODELS:
            row=groups[model].get(key)
            if row:
                relative=Path(row['directory']).as_posix().replace('workspace/outputs/','../../outputs/')
                figures.append(figure('SDXL' if model==MODELS[0] else 'FLUX Fill',quote(relative)+f'/result_seed_{case["seed"]}.png',f'MAE {row["maskedMAE"]:.2f} · {row["seconds"]:.1f}s'))
        figures.append(figure('Nền chuẩn',base+'/clean.png'))
        cards.append(f'<article><h2>{html.escape(key)}</h2><p>{html.escape(case["prompt"])} · Seed {case["seed"]}</p><div class="images">'+''.join(figures)+'</div></article>')
    page='''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kiểm chứng Xóa vật thể</title>
<style>body{max-width:1400px;margin:auto;padding:32px;background:#f6f4ee;color:#252724;font:16px/1.6 system-ui}h1{font-size:36px;margin-bottom:8px}h2{font-size:20px}p{max-width:1000px}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd}article{margin:28px 0;padding:20px;background:white;border:1px solid #ddd;border-radius:12px}.images{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}figure{margin:0}figcaption{font-weight:600;margin:8px 0}img{width:100%;aspect-ratio:3/2;object-fit:contain;background:#eee}small{color:#5c625c}.note{padding:18px;background:#e8efe5;border-left:4px solid #526c44}</style>
<h1>Kiểm chứng chức năng Xóa vật thể</h1><p>40 ảnh tổng hợp có nền gốc để đối chiếu: nền phẳng, chuyển sáng, gạch, vân gỗ và đường kẻ; gồm vật thể nhỏ, sát mép, dây mảnh, bóng đổ, ít tương phản và nhiều vùng tách biệt.</p>
<p class="note">MAE là sai lệch màu trung bình trong vùng xóa trên thang 0–255; thấp hơn là gần nền chuẩn hơn. Đây là phép đo kỹ thuật trên ảnh tổng hợp, không thay thế đánh giá độ tự nhiên của ảnh chụp. Các model chỉ được so trực tiếp trên những ca cả hai đã chạy. Nhấp ảnh để xem kích thước gốc.</p>
<table><thead><tr><th>Model</th><th>Số ca</th><th>MAE trung vị</th><th>Thời gian trung vị</th><th>Giữ nguyên ngoài vùng ghép</th></tr></thead><tbody>'''+totals+'</tbody></table>'
    page+=f'<p>Kiểm thử tự động: {summary.get("tests",{}).get("passed","—")}/{summary.get("tests",{}).get("total","—")}. So sánh cùng ca: {len(common)} ảnh. Kết quả đều lưu seed, vùng chọn và thông số thực chạy.</p>'
    for model,items in groups.items():
        if items:
            settings=next(iter(items.values()))['settings']
            page+=f'<p><strong>{html.escape(model)}</strong>: {settings["maxSide"]} px, {settings["steps"]} bước, strength {settings["strength"]}, guidance {settings["guidance"]}. Thời gian gồm xử lý, lưu ảnh và nạp model nếu có; không suy ra tốc độ ở 1024 px.</p>'
    page+=''.join(cards)+'</html>'
    (OUT/'report.html').write_text(page,encoding='utf-8')
    print(json.dumps(summary),flush=True)


if __name__=='__main__':main()
