# Sprint 4H — Nghiệm thu và khởi chạy một chạm

## Đã triển khai

- `open_app.bat` khởi chạy dự án bằng một lần nhấp đúp.
- `start-all.ps1` phát hiện dịch vụ đang chạy để tránh tạo tiến trình trùng.
- Hàng duyệt gợi ý `collar`, `sleeves`, `waist` hoặc `auto` dựa trên loại trang phục, nhãn cũ và chỉ số lỗi.
- Báo cáo A/B so sánh điểm theo trọng số mặc định và trọng số hiệu chỉnh.
- Báo cáo nghiệm thu kiểm tra đủ 23 ảnh, không lỗi, điểm tổng ≥ 90, giống mẫu ≥ 0,60, biên ≥ 80, hình thể ≥ 95 và VRAM ≤ 8 GB.
- Kết quả nghiệm thu tách `technicalPassed` với `contentReady`; cần 23 ảnh được người dùng chấp nhận để đạt hoàn toàn.
- Hồ sơ tham chiếu đánh dấu `lower_body` và `overall` là provisional cho tới khi có ảnh chuyên biệt.
- `test-clean-install.ps1` xác minh gói trong thư mục tạm sạch rồi tự dọn thư mục thử.

## Tệp đầu ra

- `workspace/review/weight-ab-report.json`
- `workspace/review/release-acceptance.json`
- `workspace/review/reference-profiles.json`
- `open_app.bat`

## Giới hạn còn lại

Việc duyệt 23 ảnh là thao tác đánh giá trực quan của người dùng. Hệ thống không tự chuyển ảnh sang `approved`, nên trạng thái nội dung có thể vẫn là `technical-pass-review-pending` dù toàn bộ kiểm tra kỹ thuật đạt.

## Kết quả xác minh

- Kiểm tra kỹ thuật: đạt cho cả `upper_body`, `lower_body`, `overall`.
- Trạng thái phát hành: `technical-pass-review-pending`.
- Ảnh được người dùng chấp nhận: 1/23.
- A/B trọng số: 23 ảnh; delta trung bình 0 vì mẫu duyệt hiện chưa có nhãn lỗi làm thay đổi trọng số.
- Gợi ý vùng cần xem: 17 ảnh `auto`, 6 ảnh `collar` trong benchmark mới nhất.
- Gói offline cuối cùng được lưu dưới `workspace/releases/ai-image-offline-1.5.0-*`.
- Checksum: đạt, 488 tệp.
- Kiểm tra trong thư mục tạm sạch: đạt, sau đó thư mục thử đã được dọn.
