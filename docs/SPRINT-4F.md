# Sprint 4F — Benchmark hiệu năng và phát hành offline

## Đã triển khai

- Đo `durationSeconds` và `peakVramMb` cho từng ảnh.
- Tổng hợp thời gian, VRAM và năm chỉ số chất lượng trong báo cáo benchmark.
- Tạo dashboard JSON/HTML và cấu hình đề xuất theo `upper_body`, `lower_body`, `overall`.
- Nút kiểm tra model, tên GPU, tổng VRAM và dung lượng đĩa trống.
- Sao lưu review, mask và trạng thái job; loại request chứa ảnh base64 và không sao chép thư mục output.
- Script đóng gói offline kiểm tra đủ SAM2, YOLO Pose, CatVTON và SD3.5 trước khi tạo bản phát hành.
- Tùy chọn `-IncludeModels` tạo gói tự chứa; mặc định tạo gói mã nguồn nhỏ và manifest đường dẫn model.

## Benchmark chuẩn

- Trang phục tham chiếu: `samples/characters/c003.png`.
- 23 ảnh, 2 seed, 35 bước, 960 px, pose, crop từng người, render hai tầng.
- Một retry, sửa biên nhanh và sửa sinh ảnh khi cần.
- Ngưỡng: tổng 75, giống mẫu 0,55, biên 65, hình thể 90.
- Job dùng checkpoint và có thể tiếp tục sau khi gián đoạn.

## Đầu ra

- `workspace/review/quality-dashboard.json`
- `workspace/review/quality-dashboard.html`
- `workspace/backups/backup-*/backup-manifest.json`
- `workspace/releases/ai-image-offline-1.3.0-*/release-manifest.json`

## Kết quả benchmark ngày 13/10/2026

- Hoàn tất: 23/23 ảnh; lỗi: 0; bỏ qua: 0.
- Tổng thời gian GPU: 739,088 giây; trung bình: 32,134 giây/ảnh.
- VRAM đỉnh: 3.735,5 MB trên NVIDIA RTX A4500 Laptop GPU 16 GB.
- Điểm tổng trung bình: 91,7552.
- Độ giống mẫu trung bình: 0,6611.
- Điểm biên trung bình: 83,7066.
- Điểm hình thể trung bình: 99,5172.
- Điểm liên tục hoa văn trung bình: 86,4958.
- Báo cáo: `workspace/outputs/batch_20261013T083935922740Z/batch-report.json`.

## Kiểm tra phát hành

- Model: đầy đủ.
- Dung lượng trống khi kiểm tra: 276,25 GB.
- Sao lưu: `workspace/backups/backup-2026-10-13T08-39-49-563Z`.
- Gói mã nguồn offline cuối cùng: `workspace/releases/ai-image-offline-1.3.0-20261013-154052`.

Baseline chính thức vẫn cần người dùng duyệt ảnh benchmark. Hệ thống không tự đánh dấu 23 kết quả là được chấp nhận chỉ dựa trên điểm máy.
