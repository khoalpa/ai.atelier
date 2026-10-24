# Sprint 5H — Chuỗi bằng chứng qualification và benchmark

## Mục tiêu

Không cho benchmark hoặc nghiệm thu phát hành sử dụng reference khác với ảnh đã qua kiểm định và qualification.

## Cổng đã triển khai

- Qualification luôn chạy đúng ba ca chuẩn `c001–c003`; request không thể thay hoặc lặp ca dễ hơn.
- Checksum ảnh phải khớp kết quả kiểm định trước khi qualification bắt đầu.
- Báo cáo qualification lưu checksum reference, checksum kiểm định và danh sách ca chuẩn.
- Readiness đọc và xác minh nội dung báo cáo qualification, không chỉ tin cờ `status` trong profile.
- Benchmark luôn nạp lại reference đã qualification từ đĩa và ghi provenance vào `batch-report.json`; ảnh gửi kèm request không thể ghi đè.
- Nghiệm thu chỉ nhận benchmark gồm 23 sample duy nhất và có provenance khớp reference/qualification hiện hành.
- Báo cáo nghiệm thu schema 3 tổng hợp blocker reference, benchmark và số ảnh người dùng đã duyệt.

## Trạng thái dữ liệu ngày 14/10/2026

- `0/3` reference sản phẩm đạt qualification.
- `0/69` kết quả được người dùng chấp nhận.
- Ba benchmark cũ đạt ngưỡng số học nhưng không có provenance Sprint 5H, nên không còn được tính là technical pass cho bản phát hành mới.

Các blocker trên cần dữ liệu sản phẩm thật và quyết định duyệt của người dùng; không được tự động giả lập hoặc tự chấp nhận.
