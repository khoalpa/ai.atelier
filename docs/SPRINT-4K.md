# Sprint 4K — Chạy lại có mục tiêu

## Đã triển khai

- Chỉ đưa các ảnh mang trạng thái `retry` vào hàng chạy lại.
- Chọn chiến lược từ nhãn lỗi:
  - `collar`, `sleeves`, `waist` hoặc `seam`: sửa biên sinh ảnh tại vùng tương ứng.
  - `texture`: tăng số bước, guidance và ngưỡng giống ảnh tham chiếu.
  - `anatomy`: bật pose và tăng ngưỡng hình thể.
  - Không có nhãn: dùng cấu hình cân bằng.
- Mỗi ảnh được chạy độc lập để chiến lược của ảnh này không ảnh hưởng ảnh khác.
- Kết quả cũ không bị ghi đè. Ứng dụng lưu hàng so sánh tại `workspace/review/retry-comparisons.json`.
- Người dùng phải chọn **Chọn kết quả mới và chờ duyệt** trước khi đường dẫn kết quả mới được đưa vào trạng thái duyệt.
- Chọn kết quả mới không đồng nghĩa với chấp nhận; trạng thái trở về `pending`.

## Cách dùng

1. Trong phiên duyệt, đánh dấu ảnh cần sửa là `retry` và chọn nhãn lỗi.
2. Chọn đúng ảnh trang phục tham chiếu và loại trang phục.
3. Chọn **Chạy lại các ảnh được đánh dấu**.
4. Chọn **So sánh kết quả chạy lại**.
5. Giữ bản cũ hoặc đưa bản mới về hàng chờ duyệt.

## Nguyên tắc bảo toàn

Ảnh đã chấp nhận không được đưa vào hàng chạy lại. Kết quả mới không tự thay thế kết quả cũ và không tự chuyển sang `approved`.

Gói mã nguồn không kèm model có thể được tạo khi model ngoài dự án chưa được gắn; manifest sẽ liệt kê model thiếu. Gói `-IncludeModels` vẫn bị chặn nếu thiếu bất kỳ model nào.
