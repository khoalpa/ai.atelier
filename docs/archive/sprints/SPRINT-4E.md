# Sprint 4E — Hồi quy hình ảnh và vận hành hàng đợi

## Đã triển khai

- So sánh kết quả mới nhất của từng ảnh với `golden-baseline.json`.
- Ngưỡng cảnh báo: điểm tổng giảm trên 3; độ giống mẫu giảm trên 0,03; điểm biên hoặc hoa văn giảm trên 5; điểm hình thể giảm trên 3.
- Xuất `regression-comparison.json` và `regression-report.html` với ảnh trước–sau, delta và cảnh báo.
- API và giao diện liệt kê toàn bộ job; hỗ trợ tiếp tục job `interrupted` có checkpoint.
- Dọn request/checkpoint của job `completed` hoặc `cancelled` quá hạn. Luồng luôn xem trước và xác nhận; không đụng tới ảnh đầu ra hoặc báo cáo.
- Endpoint benchmark chạy toàn bộ 23 ảnh với cấu hình cố định: 2 seed, 35 bước, 960 px, hai tầng, pose, một retry và các ngưỡng chất lượng chuẩn.

## Cách dùng

1. Duyệt các kết quả tốt và tạo bộ ảnh chuẩn.
2. Sau khi thay đổi model hoặc pipeline, tạo kết quả mới rồi chọn **So sánh với bộ ảnh chuẩn**.
3. Mở `/reports/regression-report.html` để xem báo cáo trực quan.
4. Chỉ chạy benchmark 23 ảnh khi đã chọn ảnh trang phục và có đủ thời gian GPU.

## Lưu ý

Baseline cũ không có `selectedMetrics` được báo là `missing-metrics`, không được tính nhầm thành đạt. Benchmark là thao tác chủ động vì có chi phí xử lý lớn và có thể kéo dài nhiều giờ tùy GPU.
