# Sprint 4L — Duyệt theo loại và xác minh SD3.5

## Đã triển khai

- Quyết định duyệt dùng khóa `category:sampleId`; ba loại trang phục không còn dùng chung trạng thái.
- Tiến độ nghiệm thu là ma trận 69 trường hợp: 23 ảnh × `upper_body`, `lower_body`, `overall`.
- Dữ liệu schema v1 được sao lưu rồi chuyển vào `legacyItems`; không tự gán quyết định cũ cho bất kỳ loại nào.
- Hàng duyệt mở benchmark mới nhất đúng với loại trang phục đang chọn.
- Hàng chạy lại chỉ lấy các mục `retry` thuộc loại đang chọn.
- Nghiệm thu nội dung yêu cầu 23 ảnh được chấp nhận trong từng loại.
- Có lựa chọn xác nhận trọng số mặc định khi cả 69 trường hợp đều được chấp nhận và không có nhãn lỗi.
- Nếu có nhãn lỗi, hệ thống vẫn bắt buộc dùng hiệu chỉnh và A/B.

## Tệp di chuyển

Khi đọc trạng thái v1 lần đầu, ứng dụng tạo `workspace/review/review-state-v1-backup-*.json`. Bản ghi cũ được giữ trong `legacyItems` để truy vết nhưng không được tính vào nghiệm thu v2.

## Điều kiện còn lại

- Lưu tham chiếu chuyên biệt cho `lower_body` và `overall`.
- Duyệt 69 trường hợp theo đúng loại.
- Xử lý ảnh `retry`, khóa trọng số, tạo golden baseline và đóng băng Release Candidate.

## Smoke test SD3.5

- Model: `models/stable-diffusion-3.5-large`.
- GPU: CUDA.
- Ảnh: `characters/c001.png`, mask tự động `upper_body`.
- Cấu hình: 4 bước, cạnh dài 512, seed 42001.
- Thời gian: 65,39 giây.
- Mask score: 0,8359375.
- Sai khác ngoài mask: 0,000032958.
- Kết luận: tải model và suy luận đạt; còn artifact tại mép dưới mask cần tối ưu chất lượng.
