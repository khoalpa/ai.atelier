# Sprint 5C — Cổng nhất quán màu và chất liệu

## Mục tiêu

Ngăn candidate có nhiều chi tiết giả hoặc mảng màu sai được chọn chỉ vì điểm texture/biên cao. Trường hợp mục tiêu là regression màu nâu trên tay áo `c003` của Sprint 5A.

## Phép đo

- Tách foreground của reference từ màu nền biên.
- So sánh palette trong không gian Lab, không yêu cầu ảnh được căn chỉnh theo pixel.
- Đo khoảng cách màu có trọng số và tỷ lệ pixel ngoài palette reference.
- So sánh năng lượng Laplacian để phát hiện chất liệu quá nhòe hoặc quá gắt.
- Chỉ candidate đạt cả cổng màu và chất liệu mới có `promotionAllowed=true`.

## Ngưỡng ban đầu

- Khoảng cách màu tối đa `32`.
- Tỷ lệ màu ngoại lai tối đa `0,22`.
- Điểm chất liệu tối thiểu `35`.

## API

- `POST /api/catvton-color-audit`: chấm lại báo cáo retry hiện có, không chạy GPU.
- Các lượt `/api/catvton-retry-matrix` mới tích hợp trực tiếp `colorMaterialScore` với trọng số `0,18`.

## So sánh với Sprint 5B

- Sprint 5B bảo đảm reference đầu vào là ảnh sản phẩm sạch.
- Sprint 5C bảo đảm đầu ra không lệch quá xa màu và năng lượng chất liệu của reference đó.
- Hai cổng độc lập: reference đạt chuẩn không đồng nghĩa mọi ảnh sinh đều được phép promotion.

## Kết quả audit 2026-10-13

- Audit đủ 12 candidate Sprint 5A mà không chạy lại GPU.
- Candidate gây regression đã được máy chọn trước đây (`c003`, seed `51101`, 20 bước) bị loại: tỷ lệ màu ngoại lai `0,249`, vượt ngưỡng `0,22`.
- Cổng chọn lại `c003` seed `51103`, 20 bước: khoảng cách màu `12,36`, tỷ lệ ngoại lai `0,026`, điểm màu/chất liệu `75,23`. Mảng nâu lớn biến mất nhưng ảnh vẫn còn viền và biến dạng tay áo.
- Với `c002`, chỉ 2/6 candidate đạt cổng; lựa chọn tốt nhất theo cổng là seed `51002`, 10 bước. Ảnh vẫn nhòe nội vùng và chưa đúng kiểu áo.
- Audit chỉ đánh dấu `promotionEligible`; `promoted` luôn là `false` cho đến khi có duyệt trực quan. Không thay baseline.
- Báo cáo chính thức: `workspace/review/catvton-color-audit-20261013T161507456127Z.json`; có 2 nhóm đủ điều kiện xem xét và `promotedCount=0`.
