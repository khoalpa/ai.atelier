"""Assemble verified evidence without conflating software readiness and model quality."""
import html
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'workspace/diagnostics/real-vton-20261022'
FIXED=ROOT/'workspace/diagnostics/real-vton-fixed-v3-20261022'
MASKS=ROOT/'workspace/diagnostics/upper-mask-regression-20261022'


def read(path,default=None):
    return json.loads(path.read_text(encoding='utf-8')) if path.is_file() else default


def main():
    runs=[]
    model_review=read(BASE/'visual-review.json',{})
    fixed_review=read(FIXED/'visual-review.json',{})
    for root,labels in [(BASE,['base-auto-1024','adapted-auto-1024','idm-vton-auto-1024','base-reviewed-1024']),
                       (FIXED,['base-auto-1024'])]:
        for label in labels:
            records=[read(p) for p in (root/'results'/label).glob('*/result.json')]
            complete=[r for r in records if r['status']=='completed']
            errors=[r for r in records if r['status']=='failed']
            review=fixed_review if root==FIXED else model_review
            reviewed={r['case'] for r in review.get('runs',{}).get(label,{}).get('cases',[])}
            maes=[r['metrics']['pairedEditMAE'] for r in complete if r['metrics']['pairedEditMAE'] is not None]
            runs.append({'root':str(root.relative_to(ROOT)),'run':label,'completed':len(complete),
                         'expected':6 if root==FIXED or label=='base-reviewed-1024' else 12,
                         'visuallyReviewed':sum(r['case'] in reviewed for r in complete),
                         'failed':len(errors),'pairedMAE':sum(maes)/len(maes) if maes else None,
                         'outsideChangedPixels':sum(r['metrics']['outsideMaskChangedPixels'] for r in complete),
                         'protectedChangedPixels':sum(r['metrics']['protectedChangedPixels'] for r in complete)})
    masks=read(MASKS/'report.json')['records']
    tests=read(BASE/'tests.json',[])
    package=(BASE/'package-test.log').read_text(encoding='utf-8',errors='replace')
    evidence={'experimentsCompleted':all(r['completed']==r['expected'] and not r['failed'] for r in runs),
              'runs':runs,'maskImages':len(masks),
              'meanMaskCoverageBefore':sum(r['before']['coverage'] for r in masks)/len(masks),
              'meanMaskCoverageAfter':sum(r['after']['coverage'] for r in masks)/len(masks),
              'testsPassed':sum(r['exitCode']==0 for r in tests),'testsFailed':sum(r['exitCode']!=0 for r in tests),
              'packagePassed':'OK: offline package verifies' in package,
              'integrity':read(BASE/'integrity.json'), 'service':read(BASE/'service-smoke.json'),
              'modelReview':model_review, 'correctedMaskOutputReview':fixed_review,
              'visualReviewCompleted':all(r['visuallyReviewed']==r['expected'] for r in runs)
                 and model_review.get('status')=='completed' and fixed_review.get('status')=='completed',
              'expandedTrainingStatus':'needs_new_real_data_and_owner_supplied_person_ids',
              'independentTestSet':False}
    (BASE/'completion-summary.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    count=sum(r['completed'] for r in runs)
    page='''<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kết quả nâng chất lượng Thay trang phục</title>
<style>body{font:17px/1.6 system-ui;color:#182536;background:#f4f6fa;max-width:1080px;margin:auto;padding:28px}article{background:white;padding:24px;margin:20px 0;border-radius:15px}h1{line-height:1.2}h2{font-size:23px}a{color:#1261a0}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:10px;border-bottom:1px solid #d5dce7}.note{color:#536273}img{max-width:100%}.stat{font-size:29px;font-weight:650}</style>
<h1>Kết quả nâng chất lượng “Thay trang phục”</h1><p>Sửa phần chọn vùng áo, kiểm tra ảnh thật và đối chiếu mô hình ở khung 768 × 1024.</p>'''
    if evidence['service'] and not evidence['service'].get('applied'):
        page+='<article><h2>Cần nạp bản sửa vào dịch vụ AI</h2><p>Mã nguồn đã được cập nhật và kiểm tra. Dịch vụ đang mở còn dùng phiên bản cũ; cần khởi động lại dịch vụ AI để nạp bản sửa, rồi tạo lại vùng chọn tự động cho ảnh.</p><p class="note">Thao tác khởi động lại đã bị kiểm tra phê duyệt tự động chặn với lý do “blocked by policy”.</p></article>'
    page+=f'<article><h2>Vùng thay áo đầy đủ hơn</h2><p class="stat">{evidence["meanMaskCoverageBefore"]*100:.2f}% → {evidence["meanMaskCoverageAfter"]*100:.2f}%</p>'
    page+='<p>Độ bao phủ vùng áo đối chứng trung bình trên 30 ảnh. Đã sửa gấu áo bị cắt ngang hông, tay áo giơ cao bị bỏ sót và việc gộp thêm một phần quần từ phương án phân vùng khác.</p><p class="note">Vùng đối chứng được duyệt từ SAM, chưa phải nhãn phân vùng chuẩn. Chỉ số này không chứng nhận ảnh sinh đúng sản phẩm. Tóc, da, phụ kiện và vùng sát gấu vẫn cần kiểm tra.</p><a href="../upper-mask-regression-20261022/review.html">Xem 30 ảnh trước và sau</a></article>'
    examples=[('tee-f0d99941c8-female-transfer','Gấu áo được thay đầy đủ hơn','Dải áo trắng cũ đã hết; sọc và vùng cẳng tay vẫn chưa đạt.'),
              ('tee-0bce8642a3-male-transfer','Ca khó vẫn cần cải thiện','Gấu tốt hơn, nhưng cổ áo cũ và phần cánh tay lộ ra vẫn lỗi.')]
    for case_id,title,note in examples:
        page+='<article><h2>'+title+'</h2><div style="display:flex;gap:12px;flex-wrap:wrap">'
        for path,label in [(f'inputs/{case_id}/garment.png','Sản phẩm'),
                           (f'results/base-auto-1024/{case_id}/final.png','Vùng chọn cũ'),
                           (f'../real-vton-fixed-v3-20261022/results/base-auto-1024/{case_id}/final.png','Vùng chọn đã sửa')]:
            page+='<figure style="flex:1;min-width:180px;margin:0"><a href="'+path+'" target="_blank"><img style="width:100%;height:340px;object-fit:contain" src="'+path+'"></a><figcaption>'+label+'</figcaption></figure>'
        page+='</div><p>'+note+'</p><p class="note">Cùng CatVTON gốc, ảnh nguồn, seed và 30 bước; chỉ đổi vùng chọn.</p></article>'
    page+=f'<article><h2>So sánh mô hình và ảnh đối chứng</h2><p>Đã hoàn tất {count}/48 ảnh đầu ra. Cùng ảnh nguồn, mẫu áo, seed và 30 bước trong mỗi phép so sánh.</p><table><tr><th>Phép thử</th><th>Hoàn tất</th><th>Sai số màu tái tạo</th></tr>'
    labels=['CatVTON gốc, vùng cũ','CatVTON tinh chỉnh, vùng cũ','IDM-VTON, vùng cũ','CatVTON gốc, vùng đã duyệt','CatVTON gốc, vùng đã sửa']
    for label,row in zip(labels,runs):
        value=f'{row["pairedMAE"]:.3f}' if row['pairedMAE'] is not None else 'Không áp dụng'
        page+=f'<tr><td>{label}</td><td>{row["completed"]}/{row["expected"]}</td><td>{value}</td></tr>'
    page+='</table><p class="note">Sai số màu thấp hơn chưa đồng nghĩa với sọc, chữ/logo, cổ hoặc tay áo chính xác. Bộ ảnh này đã dùng để chọn thí nghiệm; chưa phải kiểm tra độc lập.</p><p><a href="review.html">Xem từng mô hình, ảnh thô và ảnh sau ghép</a> · <a href="../real-vton-fixed-v3-20261022/review.html">Xem ảnh dùng vùng tự động đã sửa</a></p></article>'
    page+='<article><h2>Quyết định sử dụng</h2><p>Giữ mô hình đang cài. Kết quả mô hình thử nghiệm còn lỗi cấu trúc hoặc họa tiết và chưa có bộ kiểm tra độc lập mới.</p>'
    if evidence['service']:
        page+='<p>Trạng thái áp dụng phần mềm: '+html.escape(evidence['service'].get('status','chưa xác minh'))+'.</p>'
    page+=f'<p>{evidence["testsPassed"]} bộ kiểm tra phần mềm đạt; {evidence["testsFailed"]} bộ lỗi. Kiểm tra đóng gói: '+('đạt' if evidence['packagePassed'] else 'đang chờ')+'.</p></article>'
    page+='<article><h2>Phần cần dữ liệu mới</h2><p>Đã chuẩn bị tiếp nhận 120 cặp ảnh thật cho lượt mở rộng: 80 học, 20 chọn cấu hình và 20 kiểm tra cuối. Đây là mốc thu thập ban đầu, không phải bảo đảm chất lượng. Chưa nhận thư mục mới hoặc mã người mẫu từ chủ ảnh.</p><p>Hệ thống kiểm tra trùng sản phẩm, người mẫu và nội dung ảnh, kể cả với các thí nghiệm trước. Không dùng lại sáu ảnh kiểm định cũ để tuyên bố có bộ thử độc lập.</p><a href="../../training/vton-expansion-20261022/README.md">Hướng dẫn chuẩn bị dữ liệu</a></article></html>'
    (BASE/'index.html').write_text(page,encoding='utf-8')
    print(json.dumps({'images':count,'experimentsCompleted':evidence['experimentsCompleted'],
                      'testsPassed':evidence['testsPassed'],'packagePassed':evidence['packagePassed']},ensure_ascii=False))


if __name__=='__main__':main()
