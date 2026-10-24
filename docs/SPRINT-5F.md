# Sprint 5F — Smoke qualification cho reference sản phẩm

## Kết quả

- Thêm `POST /qualify-product-reference` ở AI service và proxy `POST /api/qualify-reference` ở web service.
- Mỗi reference đã qua kiểm định phải chạy cùng seed trên `c001–c003` trước khi được dùng cho benchmark.
- Qualification kết hợp cổng mask, độ giống reference, màu/chất liệu, hình học nội vùng, đường may và bảo toàn giải phẫu.
- Chỉ profile có trạng thái `qualified`, đúng checksum và `specializedReferenceRequired=false` mới có trạng thái ready.
- Báo cáo bất biến được lưu tại `workspace/review/reference-qualification-<category>-<timestamp>.json`.
- Nút qualification và trạng thái blocker đã được đưa lên giao diện quản lý reference.

## Tiêu chí đạt

Cả ba ca phải đồng thời đạt:

- mask được chấp nhận;
- similarity với reference tối thiểu `0.60`;
- seam tối thiểu `80`;
- anatomy tối thiểu `95`;
- cổng màu/chất liệu và hình học cùng đạt.

Nếu một ca không đạt, profile chuyển sang `failed-smoke`, không được benchmark và không thay baseline.

## So với Sprint 5E

Sprint 5E chỉ xác minh nguồn gốc, tệp và checksum. Sprint 5F bổ sung bằng chứng suy luận thực tế; vì vậy một ảnh sản phẩm hợp lệ về định dạng vẫn chưa được kích hoạt nếu làm giảm chất lượng trên bộ smoke.

## Bước tiếp theo

Nhập ba ảnh sản phẩm thật tương ứng `upper_body`, `lower_body`, `overall`, chạy qualification và chỉ mở benchmark 23 ảnh cho nhóm đạt.
