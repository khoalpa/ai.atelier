# Sprint 5A — Selective retry CatVTON

## Mục tiêu

Chỉ chạy lại các ảnh lỗi của Sprint 4Z, thay vì tăng chi phí cho toàn bộ bộ dữ liệu. Mỗi ảnh được thử bằng ba seed ở 10 và 20 bước.

## Phát hiện suy biến nội vùng

Điểm mới đo phần lõi mask sau erosion, gồm:

- trung bình và phân vị 10 của độ lệch chuẩn cục bộ;
- tỷ lệ vùng gần như không có texture;
- chênh lệch texture giữa nửa trái và nửa phải;
- `coreTextureScore` tổng hợp.

Điểm chọn kết quả kết hợp quality, seam, anatomy, similarity reference, texture ở biên và texture trong lõi. Mọi kết quả được giữ lại để duyệt trực quan; điểm tự động không tự động phê duyệt nội dung.

## API

`POST /api/catvton-retry-matrix`

```json
{
  "sampleIds": ["characters/c002.png", "characters/c003.png"],
  "seed": 51001,
  "seedsPerSample": 3,
  "stepValues": [10, 20],
  "maxSide": 512
}
```

## So sánh với Sprint 4Z

- Sprint 4Z giải quyết phạm vi mask: không còn rò cạp quần hoặc sửa vùng bảo vệ.
- Sprint 5A giữ nguyên mask đó và chỉ xử lý biến thiên sinh ảnh bên trong vùng hợp lệ.
- Nếu không seed/steps nào sửa được `c002`, nguyên nhân còn lại được quy về chất lượng reference hoặc giới hạn CatVTON, không tiếp tục nới mask.

## Kết quả chạy 2026-10-13

- Hoàn tất `12/12` lượt cho `c002–c003`, mỗi ảnh có ba seed tại 10 và 20 bước.
- Bộ chọn tự động chọn `c002`: seed `51003`, 20 bước; similarity `0,6007`, seam `90,28`, anatomy `98,63`, core texture `82,71`.
- Bộ chọn tự động chọn `c003`: seed `51101`, 20 bước; similarity `0,6807`, seam `89,30`, anatomy `98,94`, core texture `84,67`.
- So với Sprint 4Z, `c002` giảm mảng trống phía thân phải nhưng vẫn không tái tạo đúng áo và xuất hiện dải tay áo tối. Kết quả chưa đạt.
- `c003` bị regression trực quan: xuất hiện mảng nâu lớn ở hai tay áo dù điểm texture tăng. Điều này chứng minh độ phong phú texture không đồng nghĩa với đúng màu/chất liệu.
- Không thay baseline Sprint 4Z bằng kết quả Sprint 5A. Không tiếp tục tăng seed hoặc steps với reference hiện tại.
- Báo cáo: `workspace/review/catvton-retry-matrix-20261013T154102880148Z.json`.

## Quyết định

Mask Sprint 4Z được giữ lại. Nhánh retry được giữ làm công cụ chẩn đoán nhưng không bật mặc định. Bước tiếp theo phải thay reference suy ra bằng ảnh sản phẩm sạch và bổ sung cổng nhất quán màu trước khi chạy lại.
