# Tái cấu trúc AI Atelier

Mốc nguồn trước chuyển đổi: Git tag `baseline-2.7-before-refactor`.

## Các mốc triển khai

- [x] Lưu mã nguồn hiện tại trong Git; dữ liệu người dùng và model nằm ngoài Git.
- [x] A: Chạy kiểm thử nền trong bản sao dữ liệu riêng.
- [x] B: Tách API, giao diện và phụ thuộc AI thành mô-đun.
- [x] C: Thống nhất hợp đồng tác vụ, hàng đợi và phục hồi.
- [x] D: Chuyển metadata qua kho lưu trữ có phiên bản, kiểm tra và hoàn nguyên.
- [x] E: Chuẩn hóa đường dẫn runtime, gói mã offline, giao diện và nghiệm thu.

## Điều kiện bảo toàn

Giữ ảnh gốc, vùng bảo vệ, alpha, phiên bản chỉnh sửa, lịch sử lựa chọn và kết quả
đã hoàn tất. Trạng thái chưa xác nhận không được tự động gửi lại để tạo ảnh trùng.
Mọi chuyển dữ liệu phải có bản dự phòng và kiểm tra trước khi công bố.

## Kiểm thử

`node scripts/run-tests.js --label baseline` tạo bản sao nguồn và cấu hình riêng,
ghi kết quả từng tệp vào `workspace/diagnostics/refactor/baseline`. Bộ kiểm thử
không nhận hàng đợi hay lịch sử tác vụ thật. Model và ảnh mẫu được dùng làm đầu vào.

## Kết quả ngày 24/10/2026

- Hồi quy bản mới: **155/155 tệp kiểm thử đạt**, báo cáo
  `workspace/diagnostics/refactor/final-v3/results.json`. Sau các chỉnh sửa chốt,
  19 tệp liên quan và kiểm thử tích hợp mô-đun/khởi động lại được chạy bổ sung.
- Bản sao gói phát hành khởi động được trong thư mục sạch: **63 kiểm tra API/tài
  nguyên**, kiểm tra checksum và import đầy đủ dịch vụ AI.
- Sao lưu đầy đủ trước chuyển đổi: **5.917 tệp**, khoảng **4,25 GB**; đã xác minh
  checksum. Bản sao: `workspace/backups/backup-2026-10-24T13-24-55-307Z-53fbd0`.
- Chuyển **602 bản ghi** sang SQLite; đối chiếu nội dung từng bản ghi sau khi khởi
  động lại đều khớp. Dữ liệu cũ gồm 281 tác vụ, 6 hàng đợi, 1.314 mục thư viện và
  16 ca nghiệm thu được giữ nguyên.
- Lượt GPU thật: `refactor-v3-live-klein`, FLUX.2 klein 4B, 256 × 256, bốn bước;
  hoàn tất và kiểm tra gửi trùng không thay đổi kết quả. Báo cáo
  `workspace/diagnostics/refactor/live-gpu.json`. Lượt kiểm tra này thêm một tác vụ
  và một hàng đợi vào dữ liệu; các số trên là số trước kiểm tra.
- Giao diện Studio, Thư viện và Hoạt động được kiểm tra trực tiếp; không ghi nhận
  lỗi JavaScript trong các lượt kiểm tra đó. Dịch vụ AI, web và bộ kiểm tra chất
  lượng nền đều hoạt động sau chuyển đổi.

Kiến trúc và quy trình hoàn nguyên nằm trong [ARCHITECTURE-3.0.md](ARCHITECTURE-3.0.md)
và [OPERATIONS-3.0.md](OPERATIONS-3.0.md). Gói mã dùng runtime/model hiện có; việc
cài lại toàn bộ Python/CUDA trên máy trắng chưa được chứng nhận. Snapshot phụ thuộc
của môi trường cũ và các mục thiếu metadata đã được ghi riêng, không che giấu bằng
một kết quả kiểm thử cài đặt giả định.
