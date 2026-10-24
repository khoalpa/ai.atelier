# Sprint 5E — Reference readiness và benchmark preflight

## Mục tiêu

Biến các cổng reference đã xây dựng thành điều kiện vận hành bắt buộc. Không cho benchmark chạy khi loại trang phục hiện tại chưa có reference sản phẩm hợp lệ.

## Readiness

Mỗi loại `upper_body`, `lower_body`, `overall` được kiểm tra:

- profile đã qua `validation.accepted`;
- đường dẫn reference tồn tại và là tệp;
- SHA-256 thực tế khớp manifest;
- profile không còn yêu cầu reference chuyên biệt.

Giao diện hiển thị kích thước, coverage, độ nét, checksum rút gọn và từng blocker. Nút benchmark bị vô hiệu hóa theo loại đang chọn nếu reference chưa sẵn sàng.

## Preflight phía máy chủ

`POST /api/benchmark` kiểm tra lại readiness độc lập với giao diện. Nếu không đạt, máy chủ trả HTTP 409 và không chuyển yêu cầu sang dịch vụ AI. Điều này ngăn việc bỏ qua cổng bằng cách gọi API trực tiếp.

Khi preflight đạt, máy chủ tự đọc reference đã kích hoạt và đưa vào request benchmark; người dùng không phải chọn lại tệp upload.

## Kiểm chứng 2026-10-13

- Readiness hiện báo `0/3`, đúng với registry: `upper_body` là `experimental-rejected`, hai loại còn lại là `provisional`.
- Yêu cầu benchmark `upper_body` trả HTTP `409` cùng ba blocker và không khởi tạo job GPU.

## API

- `GET /api/reference-readiness`: trạng thái ba reference và danh sách blocker.
- `POST /api/benchmark`: benchmark có preflight bắt buộc.

## So sánh với Sprint 5D

- Sprint 5D quyết định candidate nào đủ chất lượng hình học.
- Sprint 5E quyết định hệ thống có đủ dữ liệu đầu vào để bắt đầu benchmark hay chưa.
- Hiện cả ba loại chưa sẵn sàng, nên benchmark chính thức phải bị chặn mà không tiêu tốn GPU.
