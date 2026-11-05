# Sprint 2B — Offline accessory removal

## Đã triển khai

- Stable Diffusion 3.5 Large inpainting chạy local với CPU offload.
- Mask được mở rộng và làm mềm biên theo tham số.
- Sinh 1–4 phương án bằng seed liên tiếp.
- Ghép kết quả vào ảnh gốc để giữ vùng ngoài mask.
- Lưu PNG kết quả, mask sau mở rộng và metadata tái tạo.
- Giao diện xem đồng thời các phương án.

## Luồng sử dụng

Tạo mask bằng SAM 2 hoặc cọ thủ công, xóa khỏi mask mọi vùng cần bảo vệ, rồi chạy inpainting. Prompt nên mô tả phần cần xuất hiện sau khi phụ kiện biến mất, không mô tả lại toàn bộ ảnh.

## Cấu hình mặc định

- Kích thước làm việc tối đa: 768 px.
- 20 bước inference.
- Strength: 0.85.
- Guidance scale: 4.5.
- Crop quanh mask: 64 px để ưu tiên chi tiết phụ kiện nhỏ.
- Mở rộng mask: 8 px.
- Làm mềm biên: 6 px.

Smoke test dùng 4 bước và 512 px để xác nhận pipeline; kiểm thử chất lượng cần dùng cấu hình mặc định.
