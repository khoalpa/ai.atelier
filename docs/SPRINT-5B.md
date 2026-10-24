# Sprint 5B — Nhập và kiểm định reference sản phẩm

## Mục tiêu

Không cho ảnh tham chiếu chưa kiểm định trở thành reference đang hoạt động. Đây là thay đổi ở đầu vào sau khi Sprint 5A chứng minh tăng seed/steps không sửa được reference nhiễm.

## Cổng kiểm định

- PNG, JPEG hoặc WebP; tối đa 20 MB.
- Kích thước tối thiểu 256 × 256.
- Không phát hiện người hoặc pose.
- Coverage sản phẩm từ `0,08` đến `0,85`.
- Độ lệch chuẩn nền tối đa `35`.
- Tỷ lệ sản phẩm chạm mép tối đa `0,08`.
- Độ nét Laplacian trong vùng sản phẩm tối thiểu `25`.

Manifest lưu SHA-256, kích thước, coverage, nền, độ nét và ba màu chủ đạo. Chỉ profile có `validation.accepted=true` mới được resolver AI sử dụng. Ảnh không đạt trả HTTP 422 và không ghi đè reference hiện tại.

## API

- `POST /api/validate-reference`: kiểm định nhưng không lưu.
- `POST /api/reference-profile`: kiểm định bắt buộc, sau đó mới lưu và kích hoạt.

## So sánh với Sprint 5A

- Sprint 5A thử khắc phục lỗi bằng nhiều seed và steps nhưng vẫn thất bại hoặc regression.
- Sprint 5B chặn nguyên nhân từ đầu vào, giữ nguyên mask Sprint 4Z và không tiêu tốn GPU cho reference không hợp lệ.
- Chưa có ảnh sản phẩm chuyên biệt trong thư mục mẫu, vì vậy reference hiện tại vẫn mang trạng thái `experimental-rejected`.

## Kiểm chứng 2026-10-13

- Kiểm thử âm bằng `characters/c003.png`: bị từ chối do phát hiện một người và tỷ lệ foreground chạm mép `0,4775`.
- Kiểm thử dương bằng ảnh sản phẩm tổng hợp trong bộ nhớ: được chấp nhận; không phát hiện người, nền có độ lệch chuẩn `0`, coverage `0,2311`, edge touch `0`, sharpness `1105,31`.
- Route qua web `/api/validate-reference` cũng chấp nhận fixture nền sạch; không ghi hoặc kích hoạt reference trong các kiểm thử này.
- Profile `upper_body` vẫn là `experimental-rejected`, đúng với trạng thái trước Sprint 5B.
