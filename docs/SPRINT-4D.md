# Sprint 4D — Hàng đợi bền vững và bộ chuẩn hồi quy

## Đã triển khai

- Ghi trạng thái tác vụ xuống `workspace/jobs/<job-id>.json` sau mỗi thay đổi giai đoạn.
- Với batch, lưu yêu cầu gốc và checkpoint gồm ảnh đã xử lý, kết quả, mục bị bỏ qua và lỗi.
- Khi dịch vụ khởi động lại, tác vụ đang chạy được chuyển thành `interrupted`; nút tiếp tục chỉ xử lý phần chưa hoàn tất.
- Hiển thị tiến độ theo seed cho tác vụ đơn và theo ảnh cho batch.
- Cho phép giới hạn mask sửa sinh ảnh theo `auto`, `collar`, `sleeves` hoặc `waist`.
- Hàng duyệt nhận ba nhãn lỗi: `seam`, `texture`, `anatomy`; các nhãn đi vào báo cáo hiệu chỉnh.
- Tạo `golden-baseline.json` từ ảnh đã chấp nhận, kèm SHA-256, chỉ số chất lượng và nhãn lỗi.

## Giới hạn có chủ đích

Checkpoint nằm giữa các ảnh, không nằm giữa một lượt suy luận GPU. Sau khi khởi động lại, ảnh đang chạy tại thời điểm dừng có thể phải chạy lại từ đầu, nhưng các ảnh đã checkpoint không bị lặp.

## Tiêu chí xác minh

- Trạng thái tác vụ còn tồn tại sau khi khởi động lại dịch vụ AI.
- Tác vụ dở được đánh dấu `interrupted` và `resumable` khi có tệp yêu cầu.
- Route tiếp tục từ chối job không có checkpoint.
- Bộ chuẩn chỉ lấy kết quả có trạng thái `approved` và tệp ảnh còn tồn tại.

## Kết quả xác minh

- Batch thử nghiệm gồm `characters/c001.png` và `characters/c002.png`, mỗi ảnh một seed ở 320 × 512.
- Checkpoint ghi nhận đủ hai ảnh và báo cáo không có lỗi.
- Sau khi chủ động chuyển trạng thái rồi khởi động lại AI, job được nạp thành `interrupted`, `resumable: true`.
- Lệnh tiếp tục hoàn tất `2/2` ảnh, `failed: 0`, không chạy lại ảnh đã checkpoint.
- Bộ chuẩn được tạo với một kết quả đã chấp nhận và checksum SHA-256.
- API tiếp tục từ chối đúng job không có tệp yêu cầu.

Tệp kiểm chứng chính: `workspace/outputs/batch_20261013T081725843721Z/batch-report.json`.
