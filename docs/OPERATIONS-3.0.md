# Vận hành và hoàn nguyên bản 3.0

## Khởi động và dựng giao diện

Cần Node.js 24.15 trở lên và môi trường AI Python 3.10 đã cài đủ thư viện/model.
Chạy `start-all.ps1`. Có thể đặt `ATELIER_NODE` và `ATELIER_PYTHON` thành đường dẫn
runtime của máy; các launcher không chứa đường dẫn tài khoản cá nhân.

Sau khi sửa `apps/web`, chạy `node scripts/build-web.js`. Sau khi thêm hoặc bớt
nguồn Python, chạy `node scripts/update-source-manifest.js`. Cài đặt hiển thị nhu
cầu khởi động lại khi mã nguồn khác phiên bản mà dịch vụ đang nạp.

## Chuyển đổi metadata

Chỉ thực hiện khi không còn tác vụ và đã dừng cả dịch vụ web lẫn AI.

```powershell
node scripts/migrate-metadata.js --action status
node scripts/migrate-metadata.js --action migrate
```

Công cụ giữ hai cổng dịch vụ trong thời gian chuyển đổi để ngăn khởi động cùng lúc.
Chạy lại trên kho đã kích hoạt không tạo bản dữ liệu thứ hai. Bản dự phòng các JSON
gốc và manifest SHA-256 nằm trong `workspace/backups/metadata-<thoi-diem>`.
Giữ cả bản sao lưu đầy đủ trong ứng dụng để bảo vệ ảnh và tệp dự án.

## Quay lại bản trước

1. Đợi công việc hoàn tất và dừng hai dịch vụ.
2. Chạy `node scripts/migrate-metadata.js --action export` bằng mã bản 3.0.
3. Khôi phục mã nguồn cũ từ bản sao lưu phát hành hoặc tag
   `baseline-2.7-before-refactor`, rồi khởi động lại.

Xuất ngược ghi dữ liệu hiện tại thành JSON trước khi tắt SQLite. Các JSON cũ của
bản ghi đã xóa được chuyển vào kho dự phòng để không xuất hiện trở lại. Cơ sở dữ
liệu cũ vẫn được giữ; chuyển đổi lại sau đó tạo kho mới từ JSON hiện tại.
`rollback-offline.ps1` tự thực hiện bước xuất khi quay về phiên bản trước 3.0.

Không chỉ đổi mã về 2.7 khi SQLite vẫn đang hoạt động: bản 2.7 không đọc kho mới.

## Gói phát hành và runtime

`build-offline-release.ps1` dựng giao diện rồi đóng gói mã, tài nguyên và manifest
checksum. `verify-offline-release.ps1` kiểm tra thành phần; `test-clean-install.ps1`
khởi động bản sao trong thư mục sạch, kiểm tra API/tài nguyên và import mô-đun AI.
Kiểm tra này dùng runtime đã có trên máy, không phải chứng nhận cài trên một máy
Windows chưa có Python/CUDA. Model chỉ được kèm khi dùng `-IncludeModels`.

`requirements-ai.lock` ghi phiên bản thư viện của môi trường AI đang dùng;
`requirements-ai-sources.lock` lưu thêm commit của hai thư viện cài từ Git.
`requirements-ai-audit.json` ghi các yêu cầu phụ thuộc chưa có metadata trong môi
trường cũ. Không xem snapshot này là bộ cài Python tự chứa đã được nghiệm thu.

`scripts/prepare-runtime.ps1` chuẩn bị wheel trên máy có mạng và lập checksum;
`scripts/setup-runtime.ps1` cài vào môi trường riêng từ bộ wheel, không tải mạng và
không ghi đè môi trường cũ. Công cụ phải dựng/cài đủ phụ thuộc thành công trước khi
phân phối bộ runtime đó. Bản phát hành mã hiện tại tiếp tục dùng môi trường AI đã
được kiểm thử trên máy này.

## Dữ liệu kiểm tra

Báo cáo nằm trong `workspace/diagnostics/refactor`. Thư mục này, model, ảnh người
dùng, môi trường Python và bản sao lưu không được đưa vào Git. Khi dọn các bản thử,
chỉ xóa thư mục báo cáo đã chọn; không đi theo các liên kết model/runtime bên trong.
