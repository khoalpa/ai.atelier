# AI Themes

AI Themes là hệ thống giao diện dùng chung cho các dự án trong `D:/project`. Nguồn chuẩn nằm tại `ai.atelier/themes`; bản sao trong dự án khác là bản đã ghim phiên bản để ứng dụng có thể chạy độc lập và hoàn toàn cục bộ.

Phiên bản hiện tại: **1.0.0**.

## Thành phần

| Thuộc tính | Giá trị hỗ trợ | Nguồn |
| --- | --- | --- |
| Theme | `neutral`, `atelier`, `paper` | `palettes/` |
| Chế độ | `system`, `light`, `dark` | Runtime và thuộc tính HTML |
| Phong cách | `minimal`, `soft`, `editorial` | `styles/` |
| Mật độ | `comfortable`, `compact` | `density/` |

`project.json` chọn cấu hình mặc định. `tokens.json` là nguồn token màu; component chỉ nên dùng các biến ngữ nghĩa `--ui-*`. Không ánh xạ màu nội dung ảnh, video, phụ đề hoặc màu nhận diện nghiệp vụ vào theme.

## Tích hợp vào web

Sao chép `dist/theme.css` và `dist/theme.js` vào thư mục tài nguyên của ứng dụng. Nạp JavaScript trong `<head>` trước nội dung để khôi phục lựa chọn trước lần vẽ đầu tiên, rồi nạp CSS sau stylesheet của ứng dụng.

```html
<html
  data-theme="neutral"
  data-mode="system"
  data-style="minimal"
  data-density="comfortable"
  data-theme-app="my-project"
>
  <head>
    <script src="/ai-theme.js"></script>
    <link rel="stylesheet" href="/ai-theme.css">
  </head>
  <body class="ui-scope">
    <button class="ui-button ui-primary">Lưu</button>
  </body>
</html>
```

Các lớp component chính gồm `.ui-button`, `.ui-primary`, `.ui-input`, `.ui-select`, `.ui-textarea`, `.ui-card`, `.ui-table`, `.ui-feedback`, `.ui-tabs` và `.ui-actions`.

Ứng dụng vẫn chịu trách nhiệm cho logic bàn phím và trạng thái ARIA của tab. Font mặc định là font hệ thống có hỗ trợ tiếng Việt; phong cách Editorial dùng serif cho tiêu đề.

## Hành vi runtime

- Web hiển thị nút **Giao diện** ở góc phải dưới và lưu lựa chọn riêng cho từng ứng dụng trong trình duyệt.
- Chế độ `system` tự cập nhật khi giao diện hệ điều hành thay đổi.
- Streamlit hiển thị nhóm **Giao diện** trong thanh bên và lưu theo phiên.
- Windows/Gradio nhận cấu hình mặc định hoặc các biến `AI_THEME`, `AI_THEME_MODE`, `AI_THEME_STYLE`, `AI_THEME_DENSITY`.
- Android dùng bảng màu Neutral sáng/tối theo hệ thống; Telegram giữ bộ chọn chế độ hiện có.

## Phát triển

Chạy từ thư mục gốc AI Atelier:

```powershell
.\.venv-ai\Scripts\python.exe themes\tools\build.py
.\.venv-ai\Scripts\python.exe themes\tools\verify.py
node themes\tools\theme.test.js
```

`build.py` sinh CSS từ token. `verify.py` kiểm tra cấu trúc, token và đầu ra; kết quả được ghi tại `verification/results.json`. Trang xem thử nằm tại `preview/index.html`, ảnh tham chiếu tại `verification/preview.png`.

## Triển khai sang dự án khác

```powershell
.\.venv-ai\Scripts\python.exe themes\tools\deploy.py
```

Công cụ triển khai đồng bộ theme và tài nguyên runtime, cập nhật các điểm nạp đã biết, lưu bản sao trong `.theme-backups/` và ghi checksum vào manifest tại `themes/deployment/`. Tệp có nội dung giống nhau được bỏ qua khi chạy lại.

Hoàn tác bằng manifest tương ứng:

```powershell
.\.venv-ai\Scripts\python.exe themes\tools\deploy.py --rollback themes\deployment\TIMESTAMP.json
```

Hoàn tác sẽ dừng nếu tệp đã được chỉnh tiếp sau lần triển khai để không ghi đè thay đổi mới. Manifest tổng hợp của đợt đầu nằm tại `deployment/initial-rollout.json`. Các gói đã build và tiến trình đang chạy cần được tạo lại hoặc khởi động lại để nhận theme mới.

## Bộ chuyển đổi theo nền tảng

| Dự án | Điểm tích hợp |
| --- | --- |
| `ai.atelier` | Web, token ngữ nghĩa và ánh xạ palette cũ |
| `ai.studio` | Web, ánh xạ biến và danh sách tài nguyên máy chủ |
| `watermarks-remover` | Web, ánh xạ biến và route tài nguyên |
| `ai.slide`, `ai.story` | Studio và cửa sổ Audio/Video Streamlit |
| `ai.player` | QSS; giữ bố cục, thay palette cửa sổ chính |
| `ai.meeting`, `ai.player.android` | Resource màu giữ ID cũ và `values-night` |
| `ai.telegram.android` | Material 3 `ColorScheme`, giữ bộ chọn sáng/tối |
| `VieNeu-TTS` | Gradio CPU/CUDA/XPU và giao diện streaming FastAPI |
| `sd.webui` | Extension `ai-shared-themes`, không sửa mã upstream |

CSS web cung cấp đầy đủ component. Adapter native chỉ ánh xạ những khả năng nền tảng hỗ trợ; Android hiện chưa có bộ chọn ba phong cách và hai mật độ. Khi thêm màn hình mới, ưu tiên token ngữ nghĩa thay vì mở rộng lớp tương thích màu cũ.

## Cấu trúc thư mục

```text
themes/
├── density/       # Mật độ comfortable và compact
├── deployment/    # Manifest triển khai và hoàn tác
├── palettes/      # Bảng màu neutral, atelier và paper
├── preview/       # Trang xem thử
├── runtime/       # Runtime JavaScript/Python và component CSS
├── styles/        # Minimal, soft và editorial
├── tokens/        # Foundation và semantic token
├── tools/         # Build, deploy, audit và verify
├── verification/  # Kết quả và ảnh kiểm tra
├── project.json   # Cấu hình mặc định
└── tokens.json    # Nguồn token màu
```
