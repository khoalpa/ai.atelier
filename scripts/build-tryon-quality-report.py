"""Assemble the completed local pilot and its separate visual review."""
import html
import json
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT=Path(__file__).resolve().parents[1]
import sys
sys.path.insert(0, str(ROOT))
from sample_catalog import resolve_sample
FOLDER=ROOT/'workspace/diagnostics/tryon-quality-20261022'


def main():
    runs={key:json.loads((FOLDER/name/'report.json').read_text(encoding='utf-8')) for key,name in {
        'before':'before-catvton','catvton':'after-catvton-native','idm':'after-idm-vton-native'}.items()}
    if any(len(report['cases'])!=3 or any(item['status']!='completed' for item in report['cases']) for report in runs.values()):
        raise SystemExit('Wait for all three cases of each run to finish.')
    suites={name:json.loads((FOLDER/f'{name}-tests.json').read_text(encoding='utf-8-sig')) for name in ('python','javascript')}
    failures=[test['name'] for suite in suites.values() for test in suite if test['exitCode']]
    if failures:raise SystemExit(f'Failed checks: {failures}')
    summary={'softwareChecks':sum(len(v) for v in suites.values()),'softwareFailures':failures,
             'training':'waiting-for-real-paired-dataset-path',
             'scope':'Three unpaired transfers on existing illustrated people; not a real-photo product-identity benchmark.',
             'metricCaveat':'Before uses v1 and after uses v2. Quality scores are not directly comparable.',
             'runs':runs,'requiresHumanReview':True,'approvedForProduction':False}
    (FOLDER/'implementation-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf-8')
    labels=['Source','Reference','Before / CatVTON','After / CatVTON','After / IDM-VTON']
    sheet=Image.new('RGB',(1400,1400),'#f4f2ed');draw=ImageDraw.Draw(sheet)
    font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',17)
    small=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',14)
    draw.text((20,12),'Local pilot — automatic checks do not replace visual review',fill='#252525',font=font)
    blocks=[]
    names={'upper_body':'Áo','overall':'Váy liền','lower_body':'Quần'}
    for row,original in enumerate(runs['before']['cases']):
        category=original['category'];sample=original['sample']
        items=[next(item for item in runs[key]['cases'] if item['category']==category) for key in ('before','catvton','idm')]
        paths=[resolve_sample(ROOT, f'characters/{sample}.png'),ROOT/'workspace/references'/category/'reference.png',*[ROOT/item['selected'] for item in items]]
        figures=[]
        for column,(label,file) in enumerate(zip(labels,paths)):
            x=column*280;y=50+row*445
            draw.text((x+10,y),label,fill='#252525',font=small)
            thumb=ImageOps.contain(Image.open(file).convert('RGB'),(265,390))
            sheet.paste(thumb,(x+(280-thumb.width)//2,y+28))
            relative=os.path.relpath(file,FOLDER).replace('\\','/')
            figures.append(f'<figure><img src="{html.escape(relative)}" alt="{label}"><figcaption>{label}</figcaption></figure>')
        stats=[]
        for label,item in zip(labels[2:],items):
            metadata=json.loads((ROOT/item['directory']/'metadata.json').read_text(encoding='utf-8'))
            gate='đạt kiểm tra tự động' if item['gate']['passed'] else 'cần xem lại: '+(', '.join(item['gate'].get('reasons',[])) or 'điểm chưa đạt')
            stats.append(f'<li>{label}: {gate}; {item["elapsedSeconds"]:.1f} giây; VRAM cấp phát đỉnh {metadata["performance"]["peakVramMb"]:.0f} MB.</li>')
        blocks.append(f'<article><h2>{names[category]} — {sample}</h2><div class="images">{"".join(figures)}</div><ul>{"".join(stats)}</ul></article>')
    sheet.save(FOLDER/'comparison-all.jpg',quality=94)
    page='''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kiểm tra Thay trang phục</title>
<style>body{font:16px/1.6 system-ui;background:#f4f2ed;color:#252525;max-width:1450px;margin:auto;padding:28px}h1{font-size:30px}article{background:white;padding:20px;margin:24px 0;border-radius:12px}.images{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;height:380px;object-fit:contain}figcaption{font-size:14px}a{color:#174d84}.note{border-left:4px solid #a06b22;padding:12px 18px;background:#fff7e7}@media(max-width:850px){.images{grid-template-columns:repeat(2,1fr)}body{padding:16px}}</style>
<h1>Thay trang phục — kết quả triển khai và ảnh đối chiếu</h1>
<p>''' + str(summary['softwareChecks']) + ''' tệp kiểm tra phần mềm đạt. Bản đóng gói ngoại tuyến đã kiểm tra nạp độc lập. Dịch vụ và giao diện mới đã được kiểm tra trên máy.</p>
<p class="note">Chưa huấn luyện lại model. Đang chờ đường dẫn bộ ảnh ghép thật. Ba ca dưới đây dùng ảnh minh họa có sẵn, chưa đại diện cho ảnh sản phẩm thực tế. Không so trực tiếp điểm tổng trước/sau vì công thức chấm điểm đã đổi.</p>
<p>Đã bổ sung giữ tỷ lệ ảnh, vùng thay theo kiểu dáng, tách ảnh người mặc mẫu, chọn phương án theo điều kiện chất lượng và thông số riêng cho thay bằng mô tả. Xem <a href="../../../docs/TRYON-QUALITY.md">ghi chú triển khai và giới hạn</a>.</p>
<p>Quan sát các mẫu áo và váy vẫn thấy sai cổ, cổ tay, gấu hoặc chiều dài; một số kết quả vượt kiểm tra tự động vẫn chưa phù hợp để chấp nhận. Cần đối chiếu ảnh trước khi duyệt. Không có kết quả nào trong báo cáo này được tự đánh dấu đã được người dùng chấp nhận.</p>
''' + ''.join(blocks) + '<p><a href="implementation-summary.json">Số liệu và phiên bản mã nguồn từng lượt chạy</a></p></html>'
    (FOLDER/'review.html').write_text(page,encoding='utf-8')
    print(json.dumps({'checks':summary['softwareChecks'],'report':str(FOLDER/'review.html'),'comparison':str(FOLDER/'comparison-all.jpg')},ensure_ascii=False))


if __name__=='__main__':main()
