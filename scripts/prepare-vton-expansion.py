"""Create an honest intake inventory; never assign unknown people or rights."""
import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def prepare(destination):
    source = ROOT/'workspace/training/couple-tee-pilot'
    rows = [json.loads(s) for s in (source/'manifest.jsonl').read_text(encoding='utf-8').splitlines() if s.strip()]
    destination.mkdir(parents=True, exist_ok=False)
    intake=[]
    for row in rows:
        intake.append({'id':row['id'], 'productId':row['productId'], 'personId':None,
                       'sourcePersonImage':row['sourcePersonImage'], 'sourceSha256':row['sourceSha256'],
                       'preparedProductImage':str(source/row['productImage']),
                       'previousSplit':row['split'], 'eligibleForNewIndependentTest':False,
                       'category':row['category'], 'attributes':row['attributes'],
                       'provenance':row['provenance'],
                       'needs':['person ID supplied by the photo owner','capture quality review','usage metadata confirmation']})
    (destination/'existing-intake.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in intake),encoding='utf-8')
    plan={'state':'needs_new_real_data','existingPairs':len(rows),'existingProducts':len({r['productId'] for r in rows}),
          'newPairsReceived':0,'scope':['upper_body'],
          'initialCollectionTarget':{'train':80,'validation':20,'test':20},
          'note':'120 is a planning target, not a statistical guarantee. Existing validation has informed model selection.',
          'coverage':['short and long sleeves','round and high/collared necks','solid colors, stripes, text and logos',
                      'arms down, bent and raised','loose and fitted garments','long-to-short and short-to-long transfers'],
          'requiredSeparation':['productId','owner-supplied personId','image content'],
          'promotionRequires':['independent test data','visual garment structure and artwork review',
                               'no identity/outside-edit regression','baseline comparison with identical inputs and seeds']}
    (destination/'collection-plan.json').write_text(json.dumps(plan,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    (destination/'README.md').write_text('''# Bổ sung ảnh thật cho Thay trang phục

Chưa nhận bộ ảnh mới. `existing-intake.jsonl` liệt kê 30 cặp hiện có để bổ sung mã người mẫu do chủ ảnh cung cấp. Không xác định danh tính từ khuôn mặt, hậu tố male/female hoặc tên tệp. Không dùng lại 6 ảnh kiểm định cũ làm bộ thử độc lập.

Mốc thu thập ban đầu: 80 cặp học, 20 cặp chọn cấu hình, 20 cặp kiểm tra cuối; chỉ áo. Số lượng này là kế hoạch ban đầu, không bảo đảm chất lượng. Mỗi nhóm cần sản phẩm và người mẫu khác nhau; chụp cả tay dài, tay ngắn, sọc, chữ/logo và tư thế giơ/gập tay. Ảnh sản phẩm nên rõ mặt trước, đủ gấu/tay, ít phụ kiện và không dính cơ thể mannequin.

Giữ ảnh người gốc đủ độ phân giải; không phóng ảnh 384 × 512 đã chuẩn bị trước đây để thay thế ảnh gốc. Mỗi cặp phải là cùng sản phẩm thật. Điền mã người mẫu và thông tin nguồn/quyền sử dụng từ hồ sơ có thật; giá trị chưa biết giữ trống.

Tạo bộ mới theo `workspace/training/vton-paired/manifest.schema.json`, đặt ảnh trong thư mục bộ đó và khai báo manifest.jsonl. Gán nhóm train/validation/test theo cả sản phẩm và mã người mẫu, không chia ngẫu nhiên từng ảnh. Dùng bản danh mục lịch sử có mã người mẫu đã được chủ ảnh xác nhận để kiểm tra độc lập với các lượt trước.

Kiểm tra:

```powershell
.venv-sam2/Scripts/python.exe scripts/validate-vton-paired-dataset.py --dataset <thu-muc-bo-moi> --categories upper_body --minimum-train-per-category 80 --minimum-validation-per-category 20 --minimum-test-per-category 20 --seen-manifest <danh-muc-lich-su-da-xac-minh> --require-ready
```

Trình kiểm tra chặn trùng mã sản phẩm/người mẫu và nội dung ảnh giữa các nhóm, cũng như ảnh/sản phẩm/người mẫu đã dùng xuất hiện trong nhóm test mới. Thông tin lịch sử chưa có mã người mẫu sẽ chặn kết luận độc lập về người mẫu. Mặc định kiểm tra ba loại trang phục của bộ đầy đủ vẫn được giữ nguyên.
''',encoding='utf-8')
    print(json.dumps(plan,ensure_ascii=False))


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--destination',type=Path,default=ROOT/'workspace/training/vton-expansion-20261022')
    prepare(parser.parse_args().destination.resolve())
