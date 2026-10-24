# Sprint 4G — Duyệt benchmark và xác minh phát hành

## Đã triển khai

- Hàng duyệt 23 cặp ảnh trước–sau từ benchmark mới nhất.
- Sáu nhãn lỗi: biên, hoa văn, hình thể, cổ áo, tay áo và eo.
- Baseline tiếp tục chỉ nhận ảnh do người dùng đánh dấu `approved`.
- Hiệu chỉnh trọng số xếp hạng seed từ nhãn duyệt; trọng số được chuẩn hóa và lưu tại `workspace/review/score-weights.json`.
- Benchmark tiếp theo tự đọc trọng số đã hiệu chỉnh.
- Danh sách backup và khôi phục có xác nhận; tự tạo `pre-restore-*` trước khi ghi đè.
- Manifest phát hành chứa checksum SHA-256 và kích thước từng tệp.
- Script `verify-offline-release.ps1` kiểm tra checksum và các thành phần bắt buộc trên máy offline.

## Nguyên tắc

Hệ thống không tự phê duyệt ảnh từ điểm máy. Nếu chưa có đủ nhãn người dùng, trọng số giữ gần cấu hình mặc định và báo cáo số mẫu thực tế.

## Benchmark mở rộng

Sử dụng cùng ảnh tham chiếu `samples/characters/c003.png` để tạo đường cơ sở kỹ thuật cho `lower_body` và `overall`. Đây là phép so sánh pipeline; trước khi dùng làm chuẩn nội dung nên thay bằng ảnh tham chiếu chuyên biệt cho từng loại trang phục.

## Kết quả

| Loại | Ảnh | Điểm tổng | Giống mẫu | Biên | Hình thể | Hoa văn | Giây/ảnh | VRAM đỉnh |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Thân trên | 23 | 91,7552 | 0,6611 | 83,7066 | 99,5172 | 86,4958 | 32,134 | 3.735,5 MB |
| Thân dưới | 23 | 93,5159 | 0,7580 | 81,9767 | 99,6846 | 86,5845 | 35,836 | 3.735,5 MB |
| Toàn thân | 23 | 93,2393 | 0,7518 | 81,6919 | 99,2702 | 86,2702 | 35,870 | 3.735,5 MB |

Cả ba benchmark hoàn tất 23/23 ảnh, không lỗi và không bỏ qua. Báo cáo mở rộng:

- `workspace/outputs/batch_20261013T085908506707Z/batch-report.json`
- `workspace/outputs/batch_20261013T091320579886Z/batch-report.json`

Gói offline `1.4.0` cuối cùng được lưu dưới `workspace/releases/ai-image-offline-1.4.0-*` và đã xác minh 484 tệp bằng SHA-256.
