# Sprint 5D — Cổng hình học nội vùng

## Mục tiêu

Phát hiện các lỗi vẫn lọt qua cổng màu Sprint 5C: mảng nhòe lớn, bất cân xứng tay áo, vệt dọc giả và silhouette hòa vào nền.

## Phép đo

- Tỷ lệ thành phần phẳng liên thông lớn nhất trong lõi trang phục.
- Chênh lệch năng lượng cạnh giữa nửa trái và nửa phải.
- Tỷ lệ phản hồi black-hat dọc, dùng để bắt vệt nối hoặc vết xước dài.
- Tỷ lệ biên silhouette có gradient quá yếu.
- `geometryScore` tổng hợp.

Candidate chỉ qua cổng khi đồng thời đạt màu/chất liệu Sprint 5C và hình học Sprint 5D. Audit không tự động promotion; kết quả đạt chỉ mang trạng thái đủ điều kiện duyệt trực quan.

## Ngưỡng ban đầu

- Mảng phẳng liên thông tối đa `0,12` lõi mask.
- Bất cân xứng cạnh tối đa `0,30`; ngưỡng được siết sau khi candidate `c002` lỗi vẫn đạt `0,368`.
- Vệt dọc tối đa `0,055`.
- Biên yếu tối đa `0,72`.
- Điểm hình học tối thiểu `42`.

## API

- `POST /api/catvton-geometry-audit`: audit báo cáo retry có sẵn, không chạy GPU.
- Các lượt selective retry mới ghi cả `colorMaterial`, `geometry` và `promotionAllowed`.

## So sánh với Sprint 5C

- Sprint 5C loại sai màu và sai năng lượng chất liệu.
- Sprint 5D bổ sung cấu trúc không gian; màu đúng không còn đủ để che mảng nhòe hoặc tay áo bất đối xứng.

## Kết quả audit 2026-10-13

- Audit đủ 12 candidate Sprint 5A, không chạy lại GPU.
- Sprint 5C còn 2/6 candidate `c002` đủ điều kiện màu. Sprint 5D loại toàn bộ `c002`; candidate cuối cùng có bất cân xứng cạnh `0,368`, vượt ngưỡng hiệu chỉnh `0,30`.
- `c003` còn 3/6 candidate qua cổng kết hợp; lựa chọn seed `51103`, 20 bước có bất cân xứng `0,147` và không còn mảng nâu lớn.
- Tổng cộng chỉ 1/2 ảnh có candidate đủ điều kiện xem xét; `promotedCount=0`. `c003` vẫn còn viền/tay áo và chưa được duyệt nội dung.
- Báo cáo chính thức: `workspace/review/catvton-geometry-audit-20261013T162011480344Z.json`.
