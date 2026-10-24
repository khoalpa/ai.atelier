# Model theo chức năng

Ứng dụng chỉ hiển thị model tương thích trong bộ chọn của từng chức năng. Lựa chọn được lưu trong `workspace/config.json` tại `featureModels` và được áp dụng sau khi dịch vụ AI khởi động lại.

| Chức năng | Loại model tương thích | Mặc định |
|---|---|---|
| Xóa vật thể / Inpainting | `inpaint` | Stable Diffusion 3.5 Large |
| Thay trang phục | `tryon` | CatVTON |
| Chọn vùng bằng AI | `segmentation` | SAM 2.1 Tiny |
| Phát hiện người và pose | `pose` | YOLO11n Pose |
| Phát hiện / tinh chỉnh khuôn mặt | `detection` (ADetailer) | ADetailer |
| Phát hiện đối tượng theo mô tả | `detection` (YOLO-World) | YOLO-World |
| Tạo ảnh từ mô tả | `text-to-image` | FLUX Chroma1-HD |
| Giữ phong cách từ ảnh tham chiếu | `adapter` | IP-Adapter SDXL |
| Giữ chiều sâu / bố cục | `controlnet` | ControlNet Depth SDXL |

Model có checkpoint nhưng thiếu dependency vẫn có thể được chọn trước, song giao diện sẽ ghi rõ `chờ phụ thuộc` và runtime không nạp cho tới khi đủ tệp.
