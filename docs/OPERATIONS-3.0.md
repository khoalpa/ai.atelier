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

## Thư viện ảnh mẫu v2

Danh mục `samples/catalog.json` quyết định ảnh nào được hiển thị; tên thư mục
không còn quyết định vai trò ảnh. Bộ demo có 64 ảnh: 32 ảnh mới tạo bằng ChatGPT,
16 ảnh tải từ Wikimedia Commons và 16 ảnh tái sử dụng từ bộ VTON tổng hợp đã có
hồ sơ nguồn. Nút **Nguồn ảnh** trong Thư viện mở thông tin tác giả, giấy phép và
nguồn gốc. Ảnh từ Commons được giữ nguyên tệp gốc; giấy phép khác nhau theo ảnh.

| Vị trí | Nội dung |
| --- | --- |
| `samples/demo/` | 48 ảnh mới, chia theo người, khuôn mặt, trang phục, bối cảnh và vật thể |
| `samples/testing/regression-v1/` | Ảnh hồi quy cũ, storyboard và các bộ benchmark |
| `samples/testing/cases/` | 24 ca kiểm thử có nguồn, mask, ảnh tham chiếu và tiêu chí |
| `samples/datasets/synthetic-paired-vton/v1/` | Bộ tổng hợp 90 cặp, chia 72 train và 18 validation theo sản phẩm |
| `samples/previews/demo/` | 64 ảnh thu nhỏ cho giao diện |
| `samples/licenses/` | Hồ sơ nguồn, giấy phép và trang ghi công |
| `workspace/sample-archive/v1/` | Ảnh cũ đã loại khỏi demo nhưng còn dùng để mở lịch sử |

16 ảnh demo tái sử dụng trỏ tới tệp trong dataset để tránh nhân đôi dữ liệu.
Các ảnh này nằm trong phần train; demo không phải tập đánh giá độc lập. Các ca
kiểm thử ghi rõ `qualityReview: not-run` cho tới khi có đánh giá kết quả AI;
kiểm tra tính hợp lệ đầu vào không thay thế nghiệm thu chất lượng.

`samples/aliases.json` duy trì toàn bộ 417 mã ảnh cũ, gồm 12 tệp trang phục trùng
nội dung đã gộp. Mã nguồn Node và Python đều phân giải qua danh mục, kể cả khi ảnh
đã chuyển vào kho lưu trữ. Không sửa mã ảnh trong SQLite hoặc xóa kho lưu trữ khi
lịch sử còn tham chiếu tới nó. Ảnh không rõ nguồn gốc không nằm trong gói demo.

Chạy kiểm tra dữ liệu bằng:

```powershell
.venv-sam2/Scripts/python.exe scripts/validate-samples.py
```

Kết quả kiểm tra, nhật ký chuyển đổi và xử lý trực tiếp nằm trong
`workspace/diagnostics/samples-v2/`. Bộ mô tả tạo ảnh được lưu tại
`scripts/samples-v2-prompts.json`; danh sách tải và nguồn giấy phép tại
`scripts/samples-v2-downloads.json`.

Gói phát hành mặc định chỉ chứa 64 ảnh demo. Dùng
`build-offline-release.ps1 -IncludeSampleTests` để kèm các bộ kiểm thử có hồ sơ
cho phép phân phối. `scripts/install-samples.ps1` gộp danh mục khi cài/nâng cấp,
giữ lại ảnh và mã tham chiếu hiện có; từ chối ghi đè nếu cùng mã có nội dung khác.

Bản sao lưu trước chuyển đổi được chỉ ra trong
`workspace/diagnostics/samples-v2/backup.json`, gồm 423 tệp gốc và bản chụp SQLite.
Để khôi phục riêng bố cục cũ: dừng hai dịch vụ, giữ lại thư mục `samples` hiện tại
và `workspace/sample-archive` trong một bản sao lưu mới, rồi chép thư mục `samples`
từ bản sao lưu đã kiểm tra về dự án. Bố cục cũ không có `catalog.json`, nên bộ phân
giải tự dùng đường dẫn cũ. Chỉ làm bước này nếu đã kiểm tra các công việc mới có
tham chiếu tới ảnh v2; cần giữ các ảnh mới đó tại đúng đường dẫn để mở lại chúng.
Không phục hồi SQLite cũ chỉ để đổi bố cục ảnh, vì sẽ mất các công việc phát sinh.
