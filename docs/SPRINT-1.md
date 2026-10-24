# Sprint 1 — Offline Mask POC

## Mục tiêu

Tạo vùng chỉnh sửa (`editable mask`) và vùng bảo vệ (`protected mask`) cho ảnh nhân vật. Đây là đầu vào chung cho hai workflow tiếp theo: thay trang phục và xóa phụ kiện.

## Phạm vi đã triển khai

- Đọc tự động toàn bộ ảnh trong `samples`.
- Vẽ thêm hoặc xóa vùng mask bằng cọ.
- Điều chỉnh kích thước cọ và độ mờ lớp phủ.
- Hoàn tác tối đa 20 thao tác.
- Gắn nhãn áo, quần/váy, toàn thân, phụ kiện hoặc giày.
- Lưu hai mask nhị phân ở đúng độ phân giải ảnh gốc.
- Lưu metadata JSON để tái tạo và đánh giá ca thử.
- Chỉ lắng nghe tại `127.0.0.1`; không gọi dịch vụ bên ngoài.

## Đầu ra

Mỗi lần lưu tạo một thư mục trong `workspace/masks`:

```text
<run-id>/
├── editable_mask.png
├── protected_mask.png
└── metadata.json
```

Màu trắng trong `editable_mask.png` là vùng mô hình được phép thay đổi. `protected_mask.png` là mask đảo, dùng để bảo vệ phần còn lại.

## Sprint 2A

- API phân vùng tự động bằng SAM 2.1.
- Điểm dương chọn vật thể và điểm âm loại trừ vùng.
- Mask AI được nạp trực tiếp vào trình sửa thủ công.

## Chưa triển khai

- Sinh hoặc thay trang phục.
- Xóa phụ kiện bằng inpainting.
- Xử lý hàng loạt.

Các phần này sẽ dùng lại API và định dạng mask đã có, không cần thay đổi giao diện dữ liệu.

