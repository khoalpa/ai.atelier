# Sprint 4N — Giao diện quản lý model

## Đã triển khai

- Registry thống nhất tại `models/registry.json` cho SD3.5, CatVTON, VAE, SAM2 và pose.
- Quét đường dẫn, dung lượng và các tệp bắt buộc; hiển thị lý do khi model chưa sẵn sàng.
- Đăng ký model nội bộ hoặc đường dẫn ngoài dự án mà không tự tải Internet.
- Kích hoạt model bằng cách cập nhật `workspace/config.json`; thay model nền yêu cầu khởi động lại.
- Xuất manifest triển khai tại `workspace/review/model-manifest.json`.
- Mỗi thay đổi registry tạo snapshot trong `workspace/model-registry-history`.
- Model nội bộ không hoạt động có thể được chuyển vào `models/quarantine` và khôi phục.
- Không cho cách ly model đang được cấu hình hoạt động hoặc model nằm ngoài thư mục `models`.
- Giao diện hiển thị trạng thái, dung lượng, đường dẫn, giấy phép và thao tác tương ứng.

## Nguyên tắc an toàn

- Không ghi đè model cùng ID.
- Không tự xóa model; cách ly dùng thao tác di chuyển có thể phục hồi.
- Không chuyển model ngoài dự án vào vùng cách ly.
- Không áp dụng thay đổi model nền giữa một lượt suy luận.
- Registry và cấu hình người dùng được bảo toàn khi cập nhật ứng dụng.

## Giới hạn

Việc đăng ký đường dẫn chỉ xác nhận sự tồn tại và các tệp bắt buộc được khai báo. Model mới vẫn cần smoke test và benchmark tương ứng trước khi dùng cho Release Candidate.
