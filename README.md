# AI Atelier

AI Atelier là studio chỉnh sửa và tạo ảnh chạy hoàn toàn trên máy Windows. Ứng dụng kết hợp trình sửa ảnh thủ công, các workflow AI và hàng đợi tác vụ bền vững trong một giao diện web cục bộ. Ảnh, model và metadata vận hành không được gửi ra dịch vụ bên ngoài.

Phiên bản hiện tại: **3.0.0 — Kiến trúc mô-đun và tác vụ bền vững**.

## Bắt đầu nhanh

### Yêu cầu

- Windows và PowerShell.
- Node.js 24.15 trở lên.
- Python 3.10 cùng các thư viện AI cần thiết.
- Model đã được cài cục bộ cho những tính năng AI muốn sử dụng.
- GPU NVIDIA/CUDA được khuyến nghị cho các workflow sinh ảnh.

Nếu runtime không nằm ở vị trí mặc định, đặt `ATELIER_NODE` và `ATELIER_PYTHON` thành đường dẫn tương ứng trước khi khởi động.

### Khởi động

Mở PowerShell tại thư mục dự án rồi chạy:

```powershell
.\start-all.ps1
```

Hoặc nhấp đúp `open_app.bat`. Sau khi các dịch vụ sẵn sàng, mở [http://127.0.0.1:7860](http://127.0.0.1:7860).

Các lệnh hữu ích:

```powershell
# Chỉ chạy web/API cục bộ
.\start.ps1

# Chỉ chạy dịch vụ AI
.\start-ai.ps1

# Kiểm tra dịch vụ AI mà không khởi động lại
.\restart-ai.ps1 -CheckOnly
```

Nhật ký vận hành được ghi trong `workspace/logs`. Sau khi cập nhật mã, vào **Cài đặt và quản trị → Phiên bản & kết nối** để xem thành phần nào cần nạp lại.

## Tính năng chính

- **Chỉnh sửa thủ công:** cắt và bố cục ảnh, chỉnh màu, cọ và vùng chọn, ghép ảnh/logo/chữ, hoàn tác/làm lại, lưu phiên và xuất PNG/JPEG/WebP.
- **Tư thế & biểu cảm:** thay đổi nét mặt, hướng nhìn, góc đầu, tư thế, cử chỉ tay và tương tác giữa nhiều nhân vật.
- **Trang điểm AI:** áp dụng phong cách có sẵn hoặc tùy chỉnh, lấy màu từ ảnh tham chiếu, lưu phong cách cá nhân và so sánh nhiều phương án.
- **Cải thiện ảnh:** phóng lớn, khôi phục chi tiết, làm rõ khuôn mặt và xử lý ảnh chất lượng thấp.
- **Tạo ảnh mới:** sinh ảnh từ mô tả bằng model cục bộ và quản lý các phương án kết quả.
- **Mở rộng ảnh:** outpainting theo từng cạnh hoặc khung hình mới, kèm kiểm tra đường nối, chất liệu và vùng bảo vệ.
- **Xóa vật thể:** tạo hoặc tinh chỉnh mask, tái tạo nền và so sánh kết quả.
- **Thay trang phục:** dùng ảnh tham chiếu hoặc mô tả, hỗ trợ nhiều loại trang phục, bảo vệ danh tính và kiểm tra chất lượng tự động.
- **Tự động và hàng loạt:** xếp hàng nhiều ảnh, dừng/tiếp tục, duyệt từng kết quả và chạy lại có mục tiêu.
- **Quản trị cục bộ:** quản lý model, prompt, LoRA, benchmark, bản sao lưu và gói phát hành offline.

Kết quả AI luôn cần được người dùng duyệt. Các phép đo kỹ thuật giúp phát hiện lỗi nhưng không bảo đảm tuyệt đối về danh tính, bàn tay, chất liệu, chữ hoặc đường nối ảnh.

## Cách làm việc

1. Chọn ảnh từ **Thư viện** hoặc tải ảnh lên.
2. Chọn công cụ trong **Studio**.
3. Kiểm tra vùng tác động; dùng vùng bảo vệ cho các chi tiết phải giữ nguyên.
4. Tạo một hoặc nhiều phương án.
5. So sánh ở 100%, chọn kết quả chính hoặc chỉnh thiết lập và chạy lại.
6. Xuất ảnh hoặc chuyển kết quả sang một workflow khác.

Ảnh gốc được giữ riêng. Tác vụ đã hoàn tất, lịch sử chỉnh sửa và lựa chọn của người dùng được lưu trong `workspace`; đóng trang không làm mất kết quả đã được công bố.

## Kiến trúc

AI Atelier 3.0 tách giao diện, API, dịch vụ AI và lưu trữ thành các mô-đun độc lập:

| Khu vực | Vị trí | Vai trò |
| --- | --- | --- |
| Giao diện | `apps/web` | Giao diện Studio, trạng thái tính năng và stylesheet |
| API cục bộ | `apps/local-api` | Điều phối thư viện, tác vụ, model, prompt và quản trị |
| Dịch vụ AI | `services/ai` | Nạp model, khóa GPU, xử lý ảnh và thực thi tác vụ |
| Hợp đồng dùng chung | `packages/contracts` | Kiểu dữ liệu, loại tác vụ và trạng thái |
| Trình sửa ảnh | `packages/editor-core` | Mô hình tài liệu, vùng ảnh và xuất ảnh |
| Lưu trữ | `packages/storage` | Metadata SQLite, giao dịch, chuyển đổi và sao lưu |
| Runtime | `packages/runtime`, `scripts/runtime.ps1` | Phát hiện và cấu hình Node/Python |

`app/server.js` và `ai_service.py` là các điểm khởi động tương thích. Mã giao diện trong `app/public` được sinh từ `apps/web`; không chỉnh trực tiếp các tệp được sinh.

Chi tiết: [Kiến trúc 3.0](docs/ARCHITECTURE-3.0.md).

## Phát triển

Cài dependency Node theo lockfile, sau đó dùng các lệnh chuẩn:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm check
pnpm test
```

Sau khi sửa nguồn trong `apps/web`, chạy `pnpm build`. Sau khi thêm hoặc bớt nguồn Python, cập nhật manifest:

```powershell
node scripts/update-source-manifest.js
```

Chạy một nhóm kiểm thử cụ thể:

```powershell
node scripts/run-tests.js --label <ten-nhom>
```

Một số kiểm tra nền tảng:

```powershell
node tests/modular-runtime.test.js
.\.venv-sam2\Scripts\python.exe tests\modular-runtime.test.py
.\.venv-sam2\Scripts\python.exe scripts\validate-samples.py
```

Các kiểm thử có thể dùng AI giả lập hoặc ảnh mẫu. Chúng không thay thế việc nghiệm thu trực quan bằng model và ảnh thực tế.

## Dữ liệu và model

- `workspace/` chứa metadata, tác vụ, đầu ra, nhật ký, chẩn đoán và bản sao lưu của người dùng.
- `models/` và `weights/` chứa checkpoint cục bộ.
- `samples/` chứa danh mục ảnh demo và dữ liệu kiểm thử có hồ sơ nguồn.
- `vendor/` chứa mã bên thứ ba; tuân thủ giấy phép đi kèm khi phân phối.

Không đưa ảnh người dùng, model, môi trường Python, báo cáo chẩn đoán hoặc bản sao lưu vào Git. Mỗi model có thể có điều khoản sử dụng khác nhau; hãy kiểm tra giấy phép trước khi đóng gói hoặc dùng cho mục đích thương mại.

## Chuyển đổi và sao lưu metadata

AI Atelier 3.0 dùng SQLite cho metadata vận hành. Chỉ chuyển đổi khi cả web và AI đã dừng và không còn tác vụ đang chạy:

```powershell
node scripts/migrate-metadata.js --action status
node scripts/migrate-metadata.js --action migrate
```

Trước khi quay lại phiên bản cũ hơn 3.0, xuất metadata về JSON:

```powershell
node scripts/migrate-metadata.js --action export
```

Không chỉ đổi mã nguồn về 2.x khi SQLite còn đang hoạt động. Xem quy trình đầy đủ tại [Vận hành và hoàn nguyên 3.0](docs/OPERATIONS-3.0.md).

## Phát hành offline

```powershell
# Tạo gói mã và tài nguyên
.\build-offline-release.ps1

# Tạo gói có kèm model
.\build-offline-release.ps1 -IncludeModels

# Kiểm tra checksum và cấu trúc gói
.\verify-offline-release.ps1 -ReleasePath <thu-muc-goi>

# Thử cài và khởi động trong thư mục sạch
.\test-clean-install.ps1 -ReleasePath <thu-muc-goi>
```

`install-offline.ps1`, `update-offline.ps1` và `rollback-offline.ps1` lần lượt dùng để cài đặt, nâng cấp và hoàn nguyên mà không ghi đè dữ liệu người dùng. Gói runtime Python riêng được chuẩn bị bằng `scripts/prepare-runtime.ps1` và cài offline bằng `scripts/setup-runtime.ps1`.

## Cấu trúc repository

```text
ai.atelier/
├── app/                 # Điểm khởi động tương thích và dịch vụ ứng dụng
├── apps/                # Web và API theo kiến trúc mô-đun
├── docs/                # Kiến trúc, vận hành và tài liệu tính năng
├── models/, weights/    # Model và trọng số cục bộ
├── packages/            # Hợp đồng, lưu trữ, runtime và editor core
├── samples/             # Ảnh demo, catalog và bộ kiểm thử
├── scripts/             # Thiết lập, kiểm tra, benchmark và phát hành
├── services/ai/         # Dịch vụ và tác vụ AI
├── tests/               # Kiểm thử Node, Python và PowerShell
├── themes/              # Hệ thống giao diện dùng chung
├── vendor/              # Mã nguồn bên thứ ba
├── workflows/           # Định nghĩa workflow có phiên bản
└── workspace/           # Dữ liệu vận hành cục bộ, không commit
```

## Tài liệu

- [Kiến trúc 3.0](docs/ARCHITECTURE-3.0.md)
- [Vận hành, chuyển dữ liệu và hoàn nguyên](docs/OPERATIONS-3.0.md)
- [Hướng dẫn trình sửa ảnh thủ công](docs/MANUAL-EDITOR.md)
- [Khả năng và giới hạn của model](docs/MODEL-CAPABILITIES.md)
- [Chất lượng thay trang phục](docs/TRYON-QUALITY.md)
- [Chất lượng xóa vật thể](docs/OBJECT-REMOVAL-QUALITY.md)
- [Chất lượng tạo ảnh mới](docs/NEW-IMAGE-QUALITY.md)
- [Chất lượng nền và outpainting](docs/BACKGROUND-QUALITY-2.6.md)
- [Kết quả nghiệm thu 2.7](docs/ACCEPTANCE-FIXES-2.7.md)

Các tài liệu `SPRINT-*` ghi lại quá trình phát triển và quyết định lịch sử; README này là điểm bắt đầu dành cho trạng thái hiện tại của dự án.
