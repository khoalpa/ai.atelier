# AI Atelier — Studio ảnh ngoại tuyến

Bản **3.0** tách giao diện, API và AI thành các mô-đun; thống nhất hàng đợi sinh ảnh
và dùng SQLite cho metadata vận hành. Xem [kiến trúc](docs/ARCHITECTURE-3.0.md) và
[khởi động, chuyển dữ liệu, hoàn nguyên](docs/OPERATIONS-3.0.md). Ảnh gốc và kết quả
đã lưu được giữ nguyên; các điểm khởi động hiện có vẫn hoạt động.

Bản 2.7 hoàn thiện năm ca còn lỗi của bộ nghiệm thu: giữ thân áo khi đổi tư thế, khung toàn thân thấy rõ tay, nối tóc và chất liệu nền khi mở rộng, cùng sửa vùng vải bị khóa nhầm khi thay áo. Bộ nghiệm thu nội bộ đạt 16/16 ca; ca thay áo khó có bước hoàn thiện thủ công. Xem [kết quả và bằng chứng 2.7](docs/ACCEPTANCE-FIXES-2.7.md). Các công cụ [chất lượng nền 2.6](docs/BACKGROUND-QUALITY-2.6.md) và [quản lý dịch vụ 2.5](docs/STABILITY-2.5.md) tiếp tục được sử dụng.


POC chạy local để tạo vùng chỉnh sửa trang phục và phụ kiện trên bộ ảnh trong `samples`.

## Chạy ứng dụng

Mở PowerShell tại thư mục dự án và chạy:

```powershell
.\start-all.ps1
```

Trình duyệt sẽ mở `http://127.0.0.1:7860`. Ứng dụng không cần Internet và không gửi ảnh ra ngoài máy.

Sau khi cập nhật, vào **Cài đặt và quản trị → Phiên bản & kết nối**. Ứng dụng cho biết web hoặc AI cần nạp lại; dùng **Khởi động lại AI** hoặc **Nạp lại giao diện** khi không còn tác vụ đang chạy. Công cụ dòng lệnh `restart-ai.ps1` vẫn được giữ cho vận hành; `-CheckOnly` chỉ kiểm tra, nhật ký nằm trong `workspace/logs`.

## Chỉnh sửa thủ công

Trong **Studio → Chỉnh sửa thủ công**, chỉnh bố cục/màu, chọn vùng và sửa bằng cọ, ghép ảnh/logo/chữ rồi xuất PNG/JPEG/WebP. Có hoàn tác/làm lại, lưu phiên tự động, mở lại phiên bản cũ, bộ màu dùng cho nhiều ảnh và chuyển ảnh đã chỉnh sang tác vụ AI. Ảnh gốc được giữ riêng; không cần model hoặc Internet. Có thể mở trình sửa từ Thư viện và phương án AI đã chọn. Xem [hướng dẫn đầy đủ](docs/MANUAL-EDITOR.md).

## Tư thế & biểu cảm

Trong **Studio → Tư thế & biểu cảm**, chọn ảnh → **Nhận diện nhân vật** → chọn người → thiết lập thay đổi → **1. Kiểm tra vùng tác động** → **Xem thử nhanh** hoặc **2. Tạo phương án**. Ba phạm vi đã được nối vào cùng luồng tạo ảnh, so sánh, chọn kết quả và lịch sử:

1. **Khuôn mặt & hướng nhìn:** cười nhẹ, cười rõ, nghiêm túc, ngạc nhiên, buồn, tức giận; chỉnh mức độ, hướng mắt, xoay/cúi/nghiêng đầu nhẹ. Mỗi lượt chỉnh một người. LivePortrait tạo biến đổi từ khuôn mặt nguồn; không chỉ phủ hiệu ứng lên ảnh.
2. **Tư thế, cử chỉ & hành động:** đứng tự nhiên, chống hông, khoanh tay, vẫy tay, chỉ hướng, ngón cái, dấu V, chạm tóc, tay lên ngực, đi/chạy/nhảy/ngồi, đọc sách, cầm cốc, giới thiệu sản phẩm. Có thể chọn đến bốn người, chỉnh từng khớp bằng kéo thả hoặc phím mũi tên (Shift để dịch nhiều hơn), lật tư thế và lưu khung xương vào **Tư thế của tôi**. Tư thế mẫu được căn theo vai/hông của ảnh đích.
3. **Tương tác nhiều nhân vật:** bắt tay, trao đồ vật, nhìn nhau và tạo dáng nhóm. Ba tương tác đầu cần đúng hai người; tạo dáng nhóm hỗ trợ 2–4 người. Bắt tay/trao vật có điểm tiếp xúc chung; khi chỉnh tay, hai cổ tay cần nằm gần nhau. **Theo ảnh tham chiếu** nhận ảnh trong thư viện hoặc ảnh tải lên, chọn nhân vật mẫu, rồi lấy tư thế và/hoặc biểu cảm. Đây là thay đổi ảnh tĩnh, không xuất hoạt ảnh/video.

**Mô tả thêm** nhận tiếng Việt. Nhấn **Đọc mô tả thành thiết lập**, kiểm tra lại phạm vi, tư thế và biểu cảm trước khi chạy. Đổi mô tả phải đọc lại. Mô tả đồ vật nên ngắn, ví dụ “cầm một cốc trắng”; chọn và nhập thông số trực tiếp vẫn hoạt động khi bộ đọc mô tả chưa sẵn sàng.

Vùng cam cho biết phạm vi được tái tạo; cọ xanh bảo vệ chi tiết và tùy chọn **Chỉ sửa trong vùng đỏ tôi đã tô** giới hạn thêm vùng tác động. Mặc định giữ nguyên mặt khi chỉ đổi tay/chân mà đầu không di chuyển. Mọi pixel ngoài vùng được phép, vùng bảo vệ, người chưa chọn, kích thước ảnh và alpha được giữ từ ảnh nguồn đã chuẩn hóa sRGB. Thay ảnh, khớp, ảnh mẫu hoặc vùng bảo vệ sẽ yêu cầu duyệt lại kế hoạch trước khi tạo.

Mỗi lượt có 1–4 phương án; xem nhanh tạo một bản. Biểu cảm dùng các mức biến đổi giảm dần; tư thế dùng các seed liên tiếp. Có **So sánh 100%**, tải PNG, chọn kết quả chính, **Chỉnh lại thiết lập** để khôi phục ảnh nguồn/khớp/tham chiếu/vùng bảo vệ, và **Đổi tư thế & biểu cảm tiếp** để tạo nhánh từ kết quả. Tư thế cá nhân nằm trong `workspace/character-presets.json`; ảnh và thiết lập nằm trong `workspace/outputs/character`. Hủy trước bước công bố không lưu phương án dở dang. Tiếp tục tác vụ chạy lại kế hoạch đã lưu từ đầu, không tiếp tục giữa các bước sinh ảnh.

**Điều khiển chi tiết:** mở **Tay & thiết lập riêng từng người** để chọn tay trái/phải/cả hai theo phía của nhân vật. Chọn người rồi bật thiết lập riêng để đặt tư thế, biểu cảm, mức độ, góc đầu và hướng nhìn cho người đó. Mỗi bàn tay có cử chỉ xòe/nắm/chỉ/dấu V/ngón cái/cầm vật, độ xòe, góc cổ tay và năm thanh co ngón. Điểm tiếp xúc đặt vị trí cổ tay bằng tọa độ trên ảnh; khung ngón tay xuất hiện trong bản xem trước. Tương tác bắt tay/trao vật vẫn dùng điểm chạm chung. Đây là điều kiện hướng dẫn tạo ảnh, không phải cam kết ngón tay chính xác tuyệt đối.

**Giữ trang phục:** ảnh tham chiếu của từng người có vùng ảnh hưởng riêng để giảm lẫn trang phục. Khi có `models/tryon/IDM-VTON/humanparsing/parsing_atr.onnx` và `onnxruntime`, bước giữ chi tiết nhận diện vải/giày, đối chiếu các đoạn tay/chân rồi hiệu chỉnh màu và bổ sung chi tiết vải trong vùng được phép. Không sao chép nền, mặt hoặc da từ vùng vải. Làm dịu màu sát đường ghép chạy cục bộ. Có thể tắt tùy chọn này để so sánh; số đo màu chỉ phản ánh vùng vải nhận diện được, không xác nhận toàn bộ trang phục đúng.

**Sửa tiếp và tạo lại:** nút **Tạo lại phương án này** tạo đúng một bản mới với thiết lập và mức biểu cảm của bản đã chọn; ảnh cũ và các phương án khác vẫn còn. **Chỉnh lại thiết lập** khôi phục cả điều khiển riêng và bàn tay. Trong **Sửa tiếp & áp dụng nhiều ảnh**, câu “giữ tư thế, hạ tay phải một chút” chỉ dời cổ tay/khuỷu tương ứng; thiết lập khác được giữ. Luôn kiểm tra lại vùng tác động sau khi sửa tiếp.

**Nhiều ảnh có duyệt:** chọn tối đa 12 ảnh, thêm với thiết lập hiện tại, ghép từng vai với đúng người trong từng ảnh rồi **Kiểm tra ảnh này** và đánh dấu đã duyệt. Khung xương được căn lại theo vai/hông ảnh đích. Vùng tô bảo vệ/giới hạn không được sao chép giữa ảnh khác kích thước; người không chọn vẫn được bảo vệ. Chỉ chạy khi mọi ảnh còn lại đã được duyệt. Danh sách chuẩn bị được lưu trong trình duyệt; khi bắt đầu chạy, yêu cầu đã duyệt và tiến độ được lưu vào Hoạt động trên máy. Tải lại trang có thể tiếp tục các ảnh còn thiếu tại Hoạt động. Có thể dừng sau ảnh hiện tại hoặc dùng Hủy của tác vụ đang chạy. Ảnh hoàn tất được giữ; lỗi dừng danh sách tại ảnh cần xem lại. Mỗi ảnh có tác vụ và lịch sử riêng.

**Giới hạn chất lượng:** vị trí các khớp chính được đo so với khung xương đích; phép đo này không xác nhận ngón tay, tiếp xúc đồ vật, danh tính, chất liệu áo hoặc đường nối nền. Cử chỉ nhỏ, bàn tay bị che, thay đổi tư thế lớn và người chồng lấn vẫn có thể sai hoặc tạo chi tiết thừa. Ảnh kết quả cần được duyệt; ưu tiên mức **Chi tiết**, chọn phương án khác hoặc giảm thay đổi khi chưa đạt. Hành động toàn thân cần nhìn thấy đầu gối/bàn chân; khuôn mặt cần đủ rõ, tối thiểu khoảng 48 px. Ảnh nghiêng mạnh và tranh cách điệu có thể nhận diện kém.

### Chuẩn bị bộ xử lý nhân vật trên máy khác

Máy hiện tại đã được chuẩn bị. Máy mới cần môi trường Python của dự án (`scripts/setup-ai.ps1`), MediaPipe Face Landmarker (`scripts/setup-makeup.ps1`) và các thành phần dùng chung trong `models/inpainting/stable-diffusion-xl-1.0-inpainting-0.1`: model index, VAE, hai text encoder FP16 và hai tokenizer. Có thể lấy từ model `diffusers/stable-diffusion-xl-1.0-inpainting-0.1` qua trình quản lý model của dự án hoặc sao chép bộ model đã có. Sau đó chạy:

```powershell
powershell -File scripts/setup-character.ps1
# Kiểm tra lại thư viện, model và checksum mà không tải qua mạng:
powershell -File scripts/setup-character.ps1 -Offline
```

Lần chuẩn bị đầu cần mạng; lúc chỉnh sửa chỉ dùng file và dịch vụ trên máy, không tự tải model. Bộ xử lý gồm SDXL base UNet bốn kênh, OpenPose SDXL ControlNet, hai IP-Adapter (người và mặt), LivePortrait; không dùng UNet inpainting chín kênh với ControlNet này. Phiên bản và SHA-256 từng file nằm trong `models/character/installation.json`; mã LivePortrait và giấy phép nằm trong `vendor/LivePortrait`. Tôn trọng giấy phép đi kèm từng model khi phân phối. Gói offline đã bao gồm mã tác vụ; dùng `build-offline-release.ps1 -IncludeModels` để kèm model. Môi trường Python và kho Ollama vẫn cần được chuẩn bị riêng.

Ollama `qwen3:4b` đọc mô tả (dùng cấu hình `ATELIER_MAKEUP_LLM_MODEL` hiện có). `llava:7b` tùy chọn mô tả trang phục cục bộ để hỗ trợ giữ màu; nếu thiếu, các tác vụ vẫn chạy bằng ảnh tham chiếu. Mô tả tự động có thể sai, được lưu cùng thiết lập và bộ nhớ đệm `workspace/character-cache`. Chỉ số ưu tiên diện mạo/trang phục là mức điều kiện sinh ảnh, không phải bảo đảm giữ nguyên mọi chi tiết bên trong vùng sửa.

Kiểm thử: `tests/character.test.py`, `tests/character.test.js`, `tests/character-batch.test.js`; thử nâng cấp bằng `scripts/verify-character-upgrade.py`, ma trận 30 nguồn cục bộ bằng `scripts/verify-character-matrix.py` (báo cáo ở `workspace/diagnostics/character-upgrade`). Bộ nguồn gồm ảnh người, ảnh tổng hợp và ảnh không có mặt để kiểm tra từ chối đầu vào.  kiểm tra model thật bằng `scripts/verify-character.py` khi ứng dụng đang chạy (thêm `--face-only` để chỉ thử mặt). Báo cáo JSON ở `workspace/diagnostics/character` lưu kết quả, thời gian, kiểm tra pixel ngoài vùng/người chưa chọn, hủy và chạy lại. Trên RTX A4500 Laptop, hai phương án khuôn mặt khoảng 4–6 giây; tư thế tùy độ phân giải và số bước. Bộ thử dùng ảnh mẫu, không thay thế việc duyệt chất lượng trên ảnh thực tế.

## Trang điểm AI

Trong **Studio → Trang điểm AI**, chọn ảnh → **Nhận diện khuôn mặt** → chọn một người → chọn phong cách hoặc nhập mô tả → **Xem thử khuôn mặt** → **Áp dụng · 2 phương án**. Có sáu phong cách: Tự nhiên, Công sở, Tông đào, Tiệc tối, Cổ điển, Nghệ thuật và một mục Tùy chỉnh. Có thể bật riêng môi, mí mắt, chân mày, má, nền da; chỉnh màu son/phấn/má, mức độ, kẻ mắt và chất son.

Mô tả tiếng Việt được đọc bằng model ngôn ngữ cục bộ. Sau khi nhấn **Đọc mô tả và cập nhật thiết lập**, hãy kiểm tra các vùng và màu được đề xuất. Đổi mô tả sẽ yêu cầu đọc lại. Phủ màu giữ ánh sáng và kết cấu gốc; AI dùng cho họa tiết và hiệu ứng phức tạp. Làm mịn nền da mặc định tắt. Cọ xanh giữ chính xác chi tiết cần bảo vệ; tự nhận diện dấu da nhỏ chỉ là hỗ trợ, không bảo đảm tìm đủ tàn nhang/nốt ruồi.

Kết quả giữ nguyên kích thước, alpha, pixel ngoài vùng áp dụng và vùng bảo vệ trên ảnh nguồn chuẩn hóa sRGB. Mắt và khoang miệng được loại khỏi vùng chỉnh. AI vẫn có thể thay đổi chi tiết trong vùng được phép; không bảo đảm tuyệt đối danh tính chỉ bằng prompt. Mỗi lượt chọn một khuôn mặt, tối đa nhận diện tám người; ảnh nghiêng mạnh, che khuất, tranh cách điệu hoặc mặt quá nhỏ có thể không nhận diện đúng. Nhận diện vùng dựa trên các mốc khuôn mặt, không phân tách tự động kính, tóc phủ mặt hay hình xăm. Kiểm tra vùng đỏ trước khi chạy. Đổi khuôn mặt hoặc vùng trang điểm sẽ vẽ lại vùng đỏ, vùng bảo vệ vẫn được giữ.

Trang điểm đã tích hợp trong ứng dụng chính tại cổng 7860. Chuẩn bị máy khác bằng `scripts/setup-makeup.ps1` (cần mạng lúc tải); kiểm tra máy đã có phụ thuộc bằng `scripts/setup-makeup.ps1 -Offline`. Model MediaPipe Face Landmarker được ghim checksum; SDXL inpainting dùng model sửa da sẵn có. Bộ đọc mô tả mặc định `qwen3:4b` trong Ollama, có thể cấu hình bằng `ATELIER_MAKEUP_LLM_MODEL`. Bộ đọc mô tả được giải phóng sau mỗi lần đọc để dành bộ nhớ cho tạo ảnh. Toàn bộ ảnh, mô tả và xử lý nằm trên máy; không tự tải model khi trang điểm. Gói mã offline cần môi trường Python và kho model Ollama được chuẩn bị riêng.

Hai phương án có so sánh trước/sau ở 100%, tải PNG, chọn kết quả chính và **Chỉnh lại phong cách và vùng** từ kết quả hoặc Hoạt động. Lịch sử lưu phong cách, mô tả, prompt đã đọc, màu, vùng chọn và vùng bảo vệ. Kết quả xem thử là phần cắt khuôn mặt của cùng quy trình; chỉ lưu ảnh đầy đủ khi áp dụng. Các file được công bố cùng lúc sau khi cả hai phương án hoàn tất; hủy trước đó không công bố ảnh dở dang.

Kiểm thử: `tests/makeup.test.py`, `tests/makeup-plan.test.js`, `tests/makeup-ui.test.js`; kiểm tra API/model thật bằng `scripts/verify-makeup.py` và mô tả tiếng Việt bằng `scripts/verify-makeup-language.js`. Báo cáo nằm trong `workspace/diagnostics/makeup`. Thời gian tham khảo trên RTX A4500 Laptop: khoảng 1–2 giây cho hai bản phủ màu và 28–55 giây cho hai bản AI trong ảnh mẫu 745 × 1024; phụ thuộc kích thước khuôn mặt và trạng thái model.

### Trang điểm theo ảnh tham chiếu và phong cách cá nhân

Trong bảng Trang điểm AI, mở **Trang điểm theo ảnh tham chiếu**, chọn ảnh từ thư viện hoặc **Tải ảnh tham chiếu**. Tải ảnh tham chiếu giữ nguyên ảnh nhân vật đang chỉnh. Nhấn **Nhận diện mặt tham chiếu**, chọn một người nếu ảnh có nhiều mặt, rồi **Lấy gợi ý từ khuôn mặt này**. Thiết lập màu môi, mí mắt, má và chân mày sẽ được điền vào bảng; nền da được bỏ chọn và làm mịn vẫn tắt. Có thể thay màu chân mày và chỉnh **độ đậm từng vùng** từ 0–100%; mức 0 giữ nguyên vùng đó.

Gợi ý lấy từ màu quan sát được trên các vùng khuôn mặt, không phục hồi chính xác màu mỹ phẩm dưới ánh sáng khác. Độ đậm và kẻ mắt được ước lượng theo tương phản; chất son mặc định Mịn nhẹ để người dùng tự chọn lại. Vùng không đủ điểm ảnh được bỏ chọn. Hãy dùng ảnh mặt rõ, chính diện hoặc nghiêng nhẹ; ảnh toàn thân có mặt nhỏ, kính/tóc che mặt và ánh sáng màu có thể cho gợi ý không phù hợp. Ảnh tham chiếu cung cấp màu và tùy chọn; hình dáng và vùng trang điểm luôn lấy từ ảnh nhân vật.

Có thể nhập tiếp “Giữ màu son, giảm phấn mắt, má hồng nhẹ hơn” rồi nhấn **Đọc mô tả và cập nhật thiết lập**. Bộ đọc dùng các thiết lập hiện tại làm điểm bắt đầu; giảm riêng từng vùng không đổi mức độ chung. Kiểm tra các thiết lập sau khi đọc rồi dùng luồng xem thử hai phương án, so sánh và áp dụng như trước.

Trong **Phong cách của tôi**, đặt tên và chọn **Lưu thành phong cách mới**. Chọn một phong cách rồi **Áp dụng phong cách đã lưu**, hoặc đổi tên/thiết lập và **Cập nhật phong cách đã chọn**. Thư viện lưu bền vững trong `workspace/makeup-styles.json`, tối đa 100 phong cách. Chỉ màu, mô tả, prompt và tùy chọn trang điểm được lưu; ảnh, khuôn mặt, tọa độ và mask không đi theo phong cách. Đổi ảnh đích phải nhận diện lại mặt. Vùng bảo vệ trên ảnh đích vẫn được giữ khi nạp phong cách.

Không cần model mới. Kiểm thử bổ sung: `tests/makeup-reference.test.py`, `tests/makeup-library.test.js`; kiểm tra dịch vụ thật bằng `scripts/verify-makeup-reference.py`. Báo cáo ở `workspace/diagnostics/makeup-reference`; ảnh thử gồm chân dung gốc và phần chân dung cắt từ các ảnh mẫu toàn thân. Các trường hợp này kiểm tra vận hành và pixel được bảo vệ, không đại diện cho mọi điều kiện chụp.

### Thử và so sánh nhiều phong cách

Sau khi nhận diện mặt và chỉnh vùng đỏ/vùng bảo vệ, mở **Thử và so sánh nhiều phong cách**, chọn 2–4 mục rồi nhấn **Tạo bảng so sánh**. Có thể kết hợp phong cách có sẵn, **Thiết lập hiện tại · kể cả ảnh tham chiếu**, và phong cách đã lưu. Nếu vừa lưu một phong cách, nhấn **Làm mới danh sách phong cách** để đưa vào bảng. Mô tả trong thiết lập hiện tại cần được đọc trước khi so sánh.

Mỗi mục tạo một bản xem thử từ cùng ảnh gốc, cùng khuôn mặt và cùng hai vùng chọn. Phóng to **100%/200%**, cuộn hoặc kéo ảnh sẽ đồng bộ vị trí ở mọi ô; **Xem ảnh gốc ở mọi ô** giúp đối chiếu màu và chi tiết. Nhấn **Chọn phong cách này** để khôi phục đúng màu, mô tả, mức độ, vùng đỏ và vùng bảo vệ; sau đó **Áp dụng · 2 phương án** để tạo ảnh đầy đủ. Bản xem thử khớp phần cắt của phương án đầu tiên khi giữ nguyên các thiết lập.

Các phong cách chạy lần lượt và có tiến độ riêng. Nếu một mục lỗi, các mục còn lại vẫn tiếp tục. **Dừng so sánh** giữ những bản đã hoàn tất; có thể mở lại từ **Hoạt động**. Ảnh gốc không bị ghi đè. Bảng so sánh lưu bản chụp thiết lập tại lúc bắt đầu, nên thay đổi thư viện sau đó không đổi kết quả cũ. Tính năng dùng model sẵn có và xử lý trên máy.

Kiểm thử: `tests/makeup-comparison.test.py`, `tests/makeup-comparison-ui.test.js`. Kiểm tra dịch vụ và AI thật bằng `scripts/verify-makeup-comparison.py`; báo cáo nằm trong `workspace/diagnostics/makeup-comparison`.

## Cải thiện ảnh

Trong **Studio → Cải thiện ảnh**, chọn **Cải thiện nhẹ** hoặc **Phóng lớn AI 2×**; có mức Nhẹ/Cân bằng/Mạnh và cấu hình cho sản phẩm, người mẫu, ảnh tổng thể. Xử lý toàn ảnh hoặc vùng đã tô, loại vùng bảo vệ; xem thử một vùng trước khi chạy toàn ảnh. Kết quả có so sánh trước–sau ở 100%, lưu PNG, chọn kết quả chính và chỉnh sửa tiếp. Bản gốc luôn được giữ lại. Model Real-ESRGAN 2× chạy offline và đã có trên máy.

Cải thiện ảnh đã tích hợp trong ứng dụng chính tại cổng 7860. Xem [hướng dẫn và kiểm chứng Cải thiện ảnh](docs/IMAGE-ENHANCEMENT.md).

## Tự động cải thiện chất lượng

Trong **Cài đặt → Tự động cải thiện chất lượng**, chọn **Tắt**, **Chỉ ghi nhận và đánh giá** (mặc định) hoặc **Tự động cải thiện**. Bộ kiểm tra chạy nền sau khi bốn loại tác vụ hoàn tất; có phản hồi Hài lòng/Cần sửa, so sánh trước–sau và lịch sử cấu hình. Chế độ tự động thử tăng chi tiết nhẹ trên CPU, tối đa một phương án mỗi tác vụ, giữ nguyên ảnh ban đầu và vùng bảo vệ. Cấu hình hoàn thiện chỉ được học khi đủ phản hồi và kiểm chứng trên các nhóm ảnh mới; có thể khôi phục mặc định. Bản đầu chưa tự sửa lỗi nội dung bằng AI hoặc huấn luyện lại model. Xem [hướng dẫn và kiểm chứng](docs/AUTO-QUALITY.md).

## Ảnh mới

Tạo hai bố cục với seed ngẫu nhiên, chọn một phương án rồi phóng lớn giữ bố cục hoặc tinh chỉnh AI nhẹ trên model hỗ trợ. Có tỷ lệ dọc/ngang, độ phân giải AI đến 1024 px tương đương và cấu hình riêng theo model. Mô tả được kiểm tra trước khi nạp model, không cắt ngầm; ô Điều cần tránh trống được giữ nguyên. Kết quả lưu cả ảnh, thông số, nguồn hoàn thiện và thời gian gồm nạp model.

Xem [hướng dẫn Ảnh mới và bộ đối chiếu chất lượng](docs/NEW-IMAGE-QUALITY.md). Mở phiên riêng bằng `scripts/start-new-image-upgrade.ps1`, hoặc dùng ứng dụng chính sau khi dịch vụ được khởi động lại.

## Mở rộng ảnh · Outpainting

Mở rộng ảnh đã tích hợp trong ứng dụng chính tại cổng 7860. Các [trình mở phiên nâng cấp cũ](docs/archive/LEGACY-UPGRADE-LAUNCHERS.md) chỉ dành cho tái hiện kiểm chứng lịch sử.

Trong **Studio**, chọn **Mở rộng ảnh**, tải hoặc chọn ảnh nguồn, rồi chọn tỷ lệ **1:1**, **4:5**, **3:2**, **16:9** hoặc nhập kích thước riêng. Khung mới phải chứa trọn ảnh nguồn. Kéo ảnh trong bản xem trước hoặc nhập vị trí để đặt bố cục; giao diện hiển thị phần mở rộng của cả bốn cạnh. Ảnh JPEG được chuẩn hóa chiều theo EXIF.

Chọn chất lượng **Nhanh**, **Cân bằng** hoặc **Chi tiết**; số phương án 1, 2 hoặc 4 được chọn riêng. Với FLUX Fill, ba mức dùng lần lượt 24/36/50 bước và ngân sách 640/768/1024 px; model khác dùng 20/28/30 bước. Nhanh bật sửa đường nối, Cân bằng thêm chi tiết chung, Chi tiết thêm phục hồi riêng vải. Thay thông số thủ công chuyển sang **Tùy chỉnh**. Nút **Áp dụng chất lượng chi tiết** không tự tăng số phương án hay thay chế độ giữ nguồn.

**Chọn bố cục trước khi hoàn thiện** bật mặc định. Ứng dụng tạo các bố cục, sau đó người dùng bấm **Hoàn thiện ảnh này** trên phương án muốn giữ. Lượt hoàn thiện dùng đúng bố cục đã lưu và seed đã chọn, không tạo lại bố cục. Có thể mở lại bố cục từ **Hoạt động**. Nếu ảnh nguồn hoặc khung đã thay đổi, ứng dụng yêu cầu tạo bố cục mới. Bỏ chọn tùy chọn này để hoàn thiện mọi phương án trong một lượt.

**Giữ nguyên ảnh gốc** bật mặc định và bảo toàn từng pixel nguồn. Khi tắt, chỉ dải mép được phép hòa trộn; vùng lõi và vùng bảo vệ vẫn giữ nguyên. **Hoàn thiện ảnh gốc** là lựa chọn riêng, mặc định tắt và không thể bật cùng giữ nguyên nguồn: nó tăng nhẹ chi tiết sáng trên vải (giới hạn 6/255), giảm nhiễu nền, không sinh lại toàn bộ ảnh hay khuôn mặt. Mặt, tóc, da, tay, vùng bảo vệ thủ công và nhãn không chắc chắn được bảo vệ theo kết quả nhận diện.

Quy trình hoàn thiện: sửa đường nối → tăng chi tiết nền → phục hồi vải → hoàn thiện theo chất liệu. Nền và vải có mask riêng; bật phục hồi vải vẫn giữ lượt chi tiết nền. Các ô chồng lấn phủ cả phần mở rộng xa ảnh gốc và đọc cùng một ảnh đầu vào của từng lượt. Ô chứa gần như toàn vùng mới giữ một dải ngữ cảnh từ bố cục. Vùng nhận diện không đủ tin cậy được bỏ qua kèm cảnh báo. Đường nối nền đọc màu tham chiếu từ nguồn nhưng chỉ ghi vào vùng được phép sửa, kể cả khi bật giữ nguyên ảnh gốc.

Sau mỗi lượt, hệ thống đối chiếu với bản trước về vùng được phép sửa, vùng bảo vệ, chênh lệch hai bên đường nối, biến động cấu trúc/màu và mức chi tiết. Khi phát hiện hồi quy, hệ thống giữ bản trước và ghi lý do trong metadata. Đây là kiểm tra kỹ thuật, không chấm thẩm mỹ hay xác nhận đúng giải phẫu và hoa văn. Dùng **Xem đường nối ở 100%** ở màn so sánh hoặc danh sách kết quả để kiểm tra thực tế; có thể bật/tắt viền ảnh nguồn.

**Độ phân giải AI** là ngân sách pixel tương đương khung vuông. Hệ thống chọn khung chữ nhật là bội số 64, giữ tỷ lệ bằng đệm thay vì kéo giãn ảnh. PNG vẫn đúng kích thước đầu ra đã chọn. Giới hạn mặc định là 16.777.216 pixel, mỗi chiều tối đa 8192 px; có thể đặt `ATELIER_OUTPAINT_MAX_PIXELS` khi khởi động cả web và AI.

Mô tả của người dùng và điều cần tránh được truyền vào mọi lượt sinh ảnh. FLUX chuyển điều cần tránh thành hướng dẫn trong prompt; model hỗ trợ negative prompt nhận riêng trường đó. Hệ thống kiểm tra giới hạn văn bản cho cả các lượt hoàn thiện trước khi tạo bố cục, không âm thầm cắt mô tả. Prompt nằm trong nhóm `outpaint.*` của `workspace/prompts.json`. Hướng dẫn nền bám vào cảnh hiện có, không mặc định bầu trời hay mặt biển.

Ước tính thời gian dựa trên trung vị tối đa 5 tác vụ đã hoàn tất có cùng model và độ phân giải. Khi chưa có lịch sử phù hợp, giao diện báo chưa đủ dữ liệu. Nạp model, nội dung ảnh và tác vụ GPU khác có thể làm thời gian thực tế khác ước tính. FLUX lưu biểu diễn văn bản trong bộ nhớ CPU trong phạm vi một tác vụ để tái sử dụng giữa các ô và phương án. Chuyển từng lớp qua CPU vẫn là mặc định trên GPU dưới 32 GB; `ATELIER_FLUX_OFFLOAD=group` là tùy chọn thử nghiệm chuyển theo nhóm, chưa được bật mặc định.

Kết quả và các ảnh trung gian được lưu dưới `workspace/outputs/outpaint_*`, gồm ảnh nguồn trong khung, bố cục, mask, ảnh sau từng lượt và metadata về kiểm tra chất lượng. Người dùng có thể so sánh, chọn kết quả chính, tải PNG, rồi dùng kết quả để chỉnh sửa tiếp. Hủy và chạy lại dùng chung màn **Hoạt động**; phương án hoàn tất trước khi hủy vẫn mở được. API giữ chế độ `complete` mặc định để tương thích, đồng thời nhận `runMode: layout` hoặc `runMode: refine` với `refineFrom: {directory, seed}`. Các cờ hoàn thiện qua API vẫn mặc định tắt nếu không gửi.

Kiểm thử hồi quy chính: `tests/outpaint.test.py`, `tests/outpaint-quality.test.py`, `tests/outpaint-materials.test.py`, `tests/outpaint-background-seam.test.py`, `tests/outpaint-ui.test.js` và `tests/outpaint-workflow.test.js`. Bộ kiểm chứng ảnh thật dùng `scripts/benchmark-outpaint.py`: 16 ca cố định gồm nền studio, nội thất, chân dung và vải, mỗi nhóm mở bốn hướng. Mặc định chạy 4 ca đại diện với seed 42; tăng `--limit 16` và `--seeds` để mở rộng. Báo cáo HTML và JSON nằm tại `workspace/diagnostics/outpaint-quality`. Sai lệch với phần ảnh đối chiếu bị cắt chỉ phục vụ phân tích; cảnh ngoài khung có thể có nhiều cách tiếp nối hợp lý.

Đo vận hành FLUX bằng `scripts/benchmark-outpaint-memory.py --mode both`: hai tiến trình mới dùng cùng ảnh và seed để kiểm tra chuyển bộ nhớ theo lớp/nhóm, cache văn bản và bảo toàn nguồn. Lượt này dùng 4 bước, không phải phép đánh giá chất lượng ảnh; thời gian cần đo lại khi GPU rảnh trước khi chọn chế độ mặc định mới.

## Cấu hình prompt dùng chung

Trong **Cài đặt**, chọn **Quản lý và chỉnh sửa tất cả JSON cấu hình**, hoặc mở **Chỉnh sửa đầy đủ JSON** trong màn Prompt. Trình chỉnh sửa hỗ trợ cả 7 tệp: `workspace/prompts.json`, `workspace/config.json`, `models/registry.json`, `models/inpaint-candidates.json`, `models/external-sources.json`, `themes/tokens.json` và `themes/project.json`. Chọn một nhóm hoặc toàn bộ tài liệu; chế độ biểu mẫu cho phép sửa giá trị, đổi kiểu, đổi tên, thêm/xóa trường và phần tử; chế độ JSON cho phép sửa trực tiếp cấu trúc. Có tìm trường, nhập/xuất toàn bộ tệp, kiểm tra thay đổi và giữ bản nháp trong phiên trình duyệt.

Lưu chỉ áp dụng khi dữ liệu hợp lệ và tệp chưa thay đổi từ cửa sổ khác. Mỗi lần ghi tạo bản sao tại `workspace/backups/json-config/<id>/`; có thể chọn bản sao để khôi phục, đồng thời sao lưu trạng thái trước khôi phục. Tệp lịch sử, kết quả chạy và cấu hình nội bộ của các model không được mở qua API sửa cấu hình này. Thay đổi prompt cần tải lại các cửa sổ đang mở; đường dẫn/model AI có thể cần khởi động lại dịch vụ; hai tệp theme là nguồn và cần build/áp dụng theme để cập nhật CSS đã sinh.

Tất cả nội dung prompt/negative prompt tích hợp được lưu tại `workspace/prompts.json`. Giao diện, dịch vụ web và dịch vụ AI cùng đọc tệp này. Các nhóm `components`, `templates`, `tasks`, `processingModes`, `presets`, `library`, `promptAssist` và `ui` chứa thành phần ghép, mẫu có biến, nguồn theo tác vụ, chế độ xử lý, preset, thư viện, hướng dẫn LLM và gợi ý trên giao diện. `defaults` giữ nội dung gốc cho chức năng khôi phục; `legacyLibrary` hỗ trợ nhận diện dữ liệu cũ.

Chỉnh preset, hướng dẫn phần thay thế và thư viện trong màn **Prompt** sẽ lưu JSON, không sửa mã nguồn. Mỗi lần lưu tạo bản sao trong `workspace/backups/prompts/` rồi thay tệp nguyên tử. Dịch vụ AI đọc lại nội dung khi tệp thay đổi; tải lại trang để cập nhật những cửa sổ đã mở. Lưu thư viện từ cửa sổ cũ sẽ báo lỗi nếu thư viện chung đã thay đổi.

Trong màn **Prompt**, chọn **Xuất toàn bộ JSON** để tải `ai-atelier-prompts.json`, bao gồm toàn bộ prompt/negative prompt, thành phần, template, tác vụ, preset, chế độ xử lý, thư viện, hướng dẫn trợ lý AI, giá trị giao diện và giá trị gốc để khôi phục. Có thể nhập lại tệp này hoặc bản `workspace/prompts.json` qua **Chọn tệp nhập**. Tệp JSON UTF-8 tối đa 2 MB được kiểm tra phiên bản, cấu trúc, tham chiếu và biến template; bản nhập phải giữ các ID hiện có mà ứng dụng đang sử dụng.

Sau khi xem số lượng các nhóm dữ liệu, bấm **Áp dụng tệp nhập** để thay thế cấu hình đã lưu. Tệp lỗi và thao tác hủy không thay đổi dữ liệu. Bản trước được sao lưu tự động; nếu cấu hình thay đổi sau bước xem trước, ứng dụng yêu cầu chọn lại tệp để tránh ghi đè thay đổi mới. Các giá trị đã nhập áp dụng ngay trong màn Prompt và Studio; lịch sử chuyển dữ liệu từ trình duyệt được giữ theo máy hiện tại.

`runtimePresets` lưu preset tạo ảnh, chất lượng try-on/inpaint, profile mặc định theo kiến trúc và profile riêng theo model; `outfitTypes` lưu danh mục đối tượng cùng từ khóa nhận diện; `uiPlaceholders` lưu gợi ý cho các ô nhập. Profile riêng được đọc từ `runtimePresets.modelInpaintProfiles` theo ID model, thay cho trường `removalProfile` trong registry. `tasks` liên kết các bước outpainting và tác vụ thay trang phục theo mô tả với `components`/`templates`; cả hai prompt kiểm tra FLUX cũng lấy từ catalog. Tệp nhập phải có đầy đủ các nhóm này. Dịch vụ AI cần khởi động lại sau lần nâng cấp mã nguồn này; những lần sửa nội dung JSON sau đó được đọc lại tự động.

Lần mở trang đầu tiên sau nâng cấp sẽ nhập thư viện/preset còn trong bộ nhớ trình duyệt. Dữ liệu cũ chỉ được gỡ sau khi máy chủ xác nhận lưu thành công. Các bản chỉnh sửa xung đột được giữ thành mục riêng trong thư viện. Hai tệp chế độ xử lý cũ đã được chuyển vào `workspace/backups/prompts/legacy/`. Prompt nhập cho từng lần chạy và lịch sử kết quả vẫn nằm trong dữ liệu của lần chạy đó.

Kiểm tra phần này bằng `node tests/prompt-store.test.js`, `node tests/prompt-catalog-api.test.js`, `node tests/prompt-catalog-browser.test.js` và `.venv-ai/Scripts/python.exe tests/prompt-catalog.test.py`. Bộ đối chiếu Python kiểm tra 486 trường hợp theo nội dung tại thời điểm chuyển đổi; nếu chủ động đổi prompt trong JSON, cần cập nhật kỳ vọng tương ứng.

## Tái tạo phần cơ thể mới lộ ra

Trong **Thay trang phục**, tùy chọn **Tái tạo phần cơ thể mới lộ ra** được bật mặc định cho cả ảnh đơn và xử lý hàng loạt. Khi đổi áo dài tay sang áo ngắn tay, hoặc quần dài sang trang phục ngắn hơn, ứng dụng bổ sung vùng quần áo cũ vào mask để CatVTON có thể sinh cả trang phục mới và vùng da mới lộ ra. Chọn đúng loại **Áo**, **Quần / váy** hoặc **Toàn bộ trang phục** để giới hạn phạm vi xử lý.

Khuôn mặt, tóc, bàn tay và vùng bảo vệ thủ công được giữ lại. Tắt tùy chọn nếu chỉ muốn xử lý trong mask đã vẽ. Cơ thể bên dưới quần áo được AI ước lượng; kết quả có thể còn sót vải cũ và cần xem lại. Mỗi lượt lưu vùng bổ sung trong `body_reconstruction_mask.png` và thông tin `bodyReconstruction` trong metadata.

**Sửa phần tay mới lộ ra (thử nghiệm)** thêm một lượt inpainting cục bộ bằng model EpicRealism đã có trên máy. Mặc định tính năng này tắt. Chọn **Tái tạo tay trần, xóa tay áo cũ** chỉ khi trang phục mới không có tay; chế độ tự động chỉ nhận các mẫu hai dây rõ ràng. Lượt sửa giữ da tay nhìn thấy trong ảnh gốc, mặt và vùng bảo vệ; nếu kiểm tra độ phủ da không đạt thì giữ lại ảnh trước sửa. Thông tin lượt thử được ghi trong `bodyRepair`. Đây chưa phải bảo đảm đúng giải phẫu, và kiểm tra màu da có thể không chính xác dưới ánh sáng có màu.

## Trợ lý LLM viết mô tả

Các trường **Ghi chú**, **Mô tả vùng sau khi xóa**, **Mô tả ảnh** và **Điều cần tránh** có nút **Gợi ý bằng AI**. Trợ lý tạo một bản nháp để người dùng kiểm tra, chỉnh sửa hoặc hoàn tác; nội dung không tự động chạy pipeline ảnh.

Với **Mô tả ảnh** và **Điều cần tránh**, người dùng còn có thể **Tối ưu** nội dung đang nhập hoặc **Kiểm tra** cặp prompt/negative prompt. Trợ lý chỉ ra chi tiết trùng lặp, mâu thuẫn hoặc còn thiếu, hiển thị điểm rõ ràng của prompt và luôn yêu cầu xác nhận trước khi thay thế nội dung.

Mặc định ứng dụng kết nối Ollama cục bộ tại `http://127.0.0.1:11434` và dùng model vision `llava:7b`. Có thể đổi địa chỉ hoặc model trước khi chạy ứng dụng:

```powershell
$env:ATELIER_LLM_URL = 'http://127.0.0.1:11434'
$env:ATELIER_LLM_MODEL = 'llava:7b'
.\start-all.ps1
```

Hai gợi ý trong **Chỉnh sửa ảnh** gửi ảnh nguồn và mask tới Ollama trên máy. Hai gợi ý trong **Tạo ảnh từ mô tả** chỉ gửi nội dung văn bản. Nếu Ollama chưa sẵn sàng, người dùng vẫn có thể nhập nội dung và sử dụng các chức năng ảnh theo cách thủ công.

## Phân vùng tự động SAM 2

Nếu muốn chạy từng dịch vụ để chẩn đoán, mở terminal thứ hai và chạy:

```powershell
.\start-ai.ps1
```

Trong giao diện, chọn **Điểm AI**, nhấp vào vật thể cần chọn rồi nhấn **Tạo mask tự động**. Giữ `Shift` khi nhấp để thêm điểm loại trừ.

## Xóa vật thể

1. Trong Studio, chọn **Xóa vật thể** và preset phù hợp. **Tùy chỉnh** dùng chế độ **Bối cảnh / Môi trường**.
2. Tô vật thể hoặc chọn bằng AI. YOLO-World tạo vùng theo đường viền qua SAM. Tô thêm bóng đổ, phản chiếu hoặc dây nối nếu cần xóa; dùng vùng bảo vệ cho chi tiết cần giữ.
3. Mô tả nền hoặc bề mặt cần phục hồi, ví dụ “Xóa chiếc cốc, nối tiếp mặt bàn gỗ sáng và vân ngang”. Với preset Tùy chỉnh, có thể nhập tên vật thể tiếng Anh để kiểm tra phần còn sót.
4. Chọn model, chất lượng và số phương án rồi nhấn **Tạo kết quả**. Xem lại nền và đường biên trước khi chọn kết quả chính.

Chế độ Bối cảnh / Môi trường cắt vùng xử lý từ ảnh gốc trước khi thay đổi kích thước. Các vùng cách xa nhau được xử lý riêng. Bên trong vật thể được thay hoàn toàn; chỉ dải xung quanh được hòa trộn. Ngoài vùng ghép và bên trong vùng bảo vệ giữ nguyên pixel. **Làm mềm biên ghép** đặt độ rộng dải này, tối đa bằng **Mở rộng mask tạo ảnh**.

Thông số áp dụng theo model; giá trị strength nhập thủ công được giữ nguyên. FLUX Fill dùng guidance mặc định 30, cho phép đến 50 và không dùng negative prompt. Trường **Điều cần tránh** bị vô hiệu hóa khi chọn model không hỗ trợ. Chế độ chất lượng cao cho vật thể mặc định tạo 2 phương án; có thể chọn 4.

“Không còn phát hiện vật thể” chỉ xuất hiện khi bộ nhận diện đã thấy vật thể trong ảnh gốc và không còn thấy trong kết quả. Thiếu bộ nhận diện hoặc không nhận diện được ảnh gốc thì kết quả được ghi là cần kiểm tra trực quan. Thay đổi màu lớn không được coi là bằng chứng xóa sạch. Tự thử lại có giới hạn khi phát hiện vật thể còn sót hoặc ảnh gần như chưa đổi; prompt và thông số đã xác nhận được giữ nguyên, chỉ đổi seed.

Kết quả, mask xóa, mask tạo ảnh, vùng ghép, vùng bảo vệ, tọa độ crop và thông số thực chạy được lưu trong `workspace/outputs`. Ảnh xuất giữ kích thước gốc. Xem [ghi chú kỹ thuật và cách chạy benchmark](docs/OBJECT-REMOVAL-QUALITY.md).

## Thay trang phục bằng ảnh tham chiếu

1. Chọn ảnh nhân vật và tạo mask đỏ cho vùng trang phục cũ.
2. Dùng mask xanh để bảo vệ mặt, tóc, tay hoặc chi tiết cần giữ.
3. Mở **Thay trang phục · CatVTON** và chọn ảnh quần áo tham chiếu.
4. Chọn áo, quần/váy hoặc trang phục toàn thân rồi chạy.
5. So sánh các seed và chọn một phương án làm `selected.png`.

CatVTON trong dự án chỉ được dùng cho POC phi thương mại theo CC BY-NC-SA 4.0.

## Thay trang phục bằng mô tả

Trong **Thay trang phục**, chọn **Cách thay trang phục → Theo mô tả**. Chọn model Inpainting sẵn sàng, nhập kiểu dáng, màu sắc, chất liệu và chi tiết mong muốn; không cần tải ảnh mẫu. Ví dụ: “Áo sơ mi trắng, vải linen, tay ngắn, cổ mở”.

Danh sách **Loại trang phục** dùng chung danh mục với **Đối tượng cần xóa**, gồm trang phục, áo, quần/váy, kính, mũ, trang sức, túi, giày, ma-nơ-canh và tùy chỉnh. CatVTON dùng ảnh mẫu cho ba loại trang phục chính; chọn các loại khác sẽ chuyển sang mô tả.

Tô vùng cần thay và đánh dấu vùng bảo vệ, hoặc chọn **Tạo mask theo loại**. Áo, quần/váy và toàn thân dùng bộ chọn vùng trang phục; phụ kiện dùng bộ phát hiện vật thể. Ma-nơ-canh và tùy chỉnh cần tô vùng thủ công. Kiểm tra prompt trong hộp xác nhận trước khi tạo, sau đó xem, chọn kết quả cuối hoặc chỉnh sửa tiếp.

Chế độ mô tả hỗ trợ chạy hàng loạt tối đa 12 ảnh với các loại có thể chọn vùng tự động. Mỗi ảnh có vùng xử lý và seed riêng; vùng bảo vệ thủ công của ảnh hiện tại không bị sao chép sang ảnh khác. Ma-nơ-canh và tùy chỉnh chạy từng ảnh sau khi tô vùng. Không áp dụng tiêu chí giống ảnh mẫu trong chế độ này; cần xem lại chất lượng các phương án.

## Tự động và chạy hàng loạt

Trong bảng **Thay trang phục · CatVTON**:

1. Chọn **Tách nền trang phục** nếu dùng ảnh sản phẩm nền đơn giản.
2. Chọn **Tạo mask theo loại** để xem và chỉnh mask tự động, hoặc bật **Tự tạo mask khi chạy**.
3. Chọn phạm vi ảnh rồi nhấn **Chạy hàng loạt và tự chọn**.

Mỗi ảnh được chấm điểm, tự chọn seed tốt nhất thành `selected.png`; báo cáo chung được lưu dưới dạng `batch-report.json` trong `workspace/outputs`.

## Ảnh nhiều nhân vật và kiểm tra hồi quy

- Chọn **Phát hiện nhân vật trong ảnh**, sau đó chọn đúng nhân vật trước khi tạo mask.
- Chọn **Kiểm tra hồi quy 23 ảnh** để rà phát hiện người, độ tin cậy mask và danh sách ảnh cần chỉnh tay.
- Điểm chất lượng gồm độ ổn định khuôn mặt/nền/biên và độ giống màu–hoa văn với trang phục tham chiếu.

## Hàng đợi duyệt và crop từng người

- Chọn **Phát hiện nhân vật**, sau đó chọn công cụ **Chọn người** và nhấp lên khung trên ảnh.
- Bật **Crop từng người rồi ghép lại** để xử lý cảnh nhiều người hoặc landscape.
- Đặt ngưỡng tin cậy và bật **Chỉ chạy ảnh vượt ngưỡng** để batch tự bỏ qua trường hợp rủi ro.
- Trong kết quả audit, nhấn **Mở để duyệt** để chuyển thẳng đến ảnh cần sửa.

## Duyệt và bàn giao kết quả

- Gán mỗi ảnh vào một trong bốn trạng thái: chờ duyệt, chấp nhận, chạy lại hoặc loại bỏ.
- Dùng thanh trượt trong hộp kết quả để so sánh ảnh trước–sau.
- Lọc hàng đợi theo trạng thái và tiếp tục duyệt sau khi khởi động lại.
- Chọn **Xuất manifest đã duyệt** để tạo danh sách bàn giao chỉ gồm kết quả được chấp nhận.

## Pose chính xác cao

- Bật **Pose chính xác cao cho ảnh cần duyệt** trước khi phát hiện người hoặc chạy audit.
- Giao diện hiển thị 17 keypoint; mặt và cổ tay được loại khỏi mask chỉnh sửa.
- Chế độ pose dùng checkpoint local và không tải dữ liệu khi vận hành.
- Chỉ nên bật pose cho hàng đợi cần duyệt để giữ tốc độ của batch thông thường.

## Chuẩn hóa trang phục và cổng chất lượng

- Ứng dụng tự chọn quy trình cho ảnh sản phẩm hoặc ảnh người mẫu.
- Bật **Lọc seed nhanh rồi render chất lượng cao** khi tạo từ hai seed trở lên.
- Cấu hình điểm tổng và độ giống mẫu tối thiểu trước khi chạy batch.
- Kết quả không đạt cổng chất lượng vẫn được lưu để chẩn đoán nhưng không được đưa vào hàng duyệt chính thức.

## Sửa lỗi biên và tự chạy lại

- Điểm chất lượng nay tách riêng độ sạch của đường biên, tính hợp lý hình thể và độ liên tục hoa văn.
- Bật **Sửa lỗi đường may/biên cục bộ** để thử phục hồi một dải hẹp quanh cổ, tay áo và eo; bản sửa chỉ được nhận nếu tốt hơn và không làm giảm đáng kể độ giống mẫu hoặc hình thể.
- Đặt điểm biên, điểm hình thể tối thiểu và số lần tự chạy lại. Số lần chạy lại được giới hạn từ 0 đến 3.
- Nếu chưa đạt cổng chất lượng, ứng dụng thử seed tiếp theo với chất lượng render cao hơn rồi vẫn giữ trạng thái cần duyệt nếu không có phương án đạt chuẩn.

## Sửa sinh ảnh có mục tiêu và hiệu chỉnh

- Khi sửa nhanh bị từ chối và điểm biên vẫn dưới ngưỡng, SD3.5 chỉ xử lý dải lỗi hẹp quanh đường may; mặt, dáng người và vùng ngoài mask được bảo vệ.
- Bản sửa sinh ảnh cũng phải tăng điểm biên mà không làm giảm đáng kể độ giống mẫu hoặc điểm hình thể.
- Nút hủy dừng tác vụ tại ranh giới an toàn giữa các seed hoặc ảnh; lượt GPU đang chạy sẽ kết thúc trước khi dừng.
- Nút hiệu chỉnh đọc các kết quả đã được duyệt, lưu báo cáo `workspace/review/quality-calibration.json` và đề xuất ngưỡng theo nhóm được chấp nhận.

## Hàng đợi bền vững và bộ chuẩn

- Tiến độ hiện tại được hiển thị theo ảnh hoặc seed và lưu trong `workspace/jobs`.
- Batch lưu checkpoint sau mỗi ảnh; tác vụ bị gián đoạn có thể tiếp tục mà không chạy lại các ảnh đã hoàn tất.
- Có thể giới hạn sửa sinh ảnh ở cổ áo, hai tay áo hoặc vùng eo.
- Khi duyệt, có thể gắn nhãn lỗi biên, sai hoa văn hoặc sai hình thể.
- Nút **Tạo bộ ảnh chuẩn hồi quy** ghi checksum, chỉ số và nhãn của các kết quả được chấp nhận vào `workspace/review/golden-baseline.json`.

## So sánh phiên bản và benchmark

- So sánh kết quả mới nhất với baseline và cảnh báo khi điểm tổng, độ giống mẫu, biên, hình thể hoặc hoa văn giảm quá ngưỡng.
- Báo cáo JSON và HTML được lưu trong `workspace/review`; HTML hiển thị ảnh trước–sau và độ lệch từng chỉ số.
- Bảng quản lý hàng đợi hiển thị job đang chạy, gián đoạn, đã hủy hoặc hoàn tất; job gián đoạn có thể tiếp tục trực tiếp.
- Dọn checkpoint dùng bước xem trước và xác nhận, chỉ xóa dữ liệu job cũ, không xóa ảnh hay báo cáo.
- Benchmark 23 ảnh dùng cấu hình cố định: hai seed, 35 bước, pose, render hai tầng và cổng chất lượng chuẩn.

## Phân tích hiệu năng và phát hành offline

- Mỗi lượt tạo ảnh ghi thời gian xử lý và VRAM đỉnh; báo cáo batch tổng hợp tổng thời gian, trung bình và VRAM cao nhất.
- Dashboard tổng hợp điểm chất lượng của benchmark mới nhất và đề xuất cấu hình riêng cho áo, quần/váy và trang phục toàn thân.
- Kiểm tra hệ thống xác nhận model, GPU, VRAM và dung lượng đĩa trống.
- Sao lưu giữ cấu hình, mask, hàng duyệt và trạng thái job nhưng không nhân đôi ảnh đầu ra dung lượng lớn.
- Chạy `build-offline-release.ps1`; thêm `-IncludeModels` nếu cần gói tự chứa model.

## Duyệt benchmark và khôi phục

- Hàng duyệt benchmark hiển thị ảnh gốc và kết quả cạnh nhau, kèm nhãn lỗi biên, hoa văn, hình thể, cổ áo, tay áo và eo.
- Chỉ trạng thái do người dùng chọn mới được đưa vào baseline chính thức.
- Trọng số xếp hạng seed được hiệu chỉnh từ tần suất nhãn lỗi và tự dùng trong benchmark tiếp theo.
- Khôi phục backup luôn tạo một bản an toàn của trạng thái hiện tại trước khi ghi đè.
- Gói phát hành chứa checksum SHA-256 cho từng tệp; dùng `verify-offline-release.ps1` để kiểm tra trên máy offline sạch.

## Khởi chạy nhanh và nghiệm thu

- Nhấp đúp `open_app.bat` để khởi động dịch vụ AI, web và mở trình duyệt. Nếu dịch vụ đã chạy, script chỉ mở lại giao diện.
- Hàng duyệt gợi ý vùng cổ, tay hoặc eo cần xem kỹ nhưng không tự quyết định trạng thái ảnh.
- So sánh A/B cho biết thay đổi điểm khi dùng trọng số mặc định và trọng số hiệu chỉnh.
- Kiểm tra nghiệm thu tách riêng `technicalPassed` và `contentReady`; đủ điểm máy không thay thế việc duyệt đủ 23 ảnh.
- Dùng `test-clean-install.ps1 -ReleasePath <thư mục>` để sao chép gói sang thư mục tạm sạch, kiểm tra checksum và cú pháp.

## Cài đặt, cập nhật và rollback

- `install-offline.ps1` cài gói vào thư mục được chọn, ghi đường dẫn model vào `workspace/config.json` và có thể tạo shortcut Desktop.
- `update-offline.ps1` sao lưu phiên bản mã nguồn hiện tại rồi cập nhật mà không ghi đè `workspace`, model hoặc môi trường Python.
- `rollback-offline.ps1` phục hồi mã nguồn từ `workspace/version-backups` và vẫn giữ nguyên dữ liệu người dùng.
- Trọng số hiệu chỉnh chỉ được dùng sau khi có tối thiểu 5 ảnh đã duyệt, 3 ảnh có nhãn lỗi và A/B cải thiện ít nhất 0,1 điểm.
- Có thể lưu ảnh trang phục đang chọn làm ảnh tham chiếu riêng cho từng loại trang phục.

## Phiên duyệt có hướng dẫn

- Nút **Duyệt 23 kết quả benchmark** mở từng cặp ảnh và tự tiếp tục từ ảnh chưa duyệt đầu tiên.
- Dùng `A`, `R`, `X` để chấp nhận, chạy lại hoặc loại bỏ; dùng phím mũi tên để chuyển ảnh.
- Nút **Kiểm tra tiến độ duyệt** tổng hợp các điều kiện còn thiếu trước nghiệm thu.
- Nghiệm thu nội dung chỉ đạt khi đủ 23 ảnh được người dùng chấp nhận và đủ tham chiếu chuyên biệt cho ba loại trang phục.

## Chạy lại có mục tiêu

- Ảnh được đánh dấu `retry` được chạy lại theo nhãn lỗi; ảnh đã chấp nhận không bị xử lý lại.
- Kết quả cũ và mới được giữ song song để người dùng so sánh.
- Chọn kết quả mới chỉ đưa ảnh về trạng thái chờ duyệt, không tự chấp nhận.
- Danh sách đầy đủ các việc còn lại xem tại `docs/PROJECT-COMPLETION.md`.

## LoRA SD3.5

- LoRA được quản lý offline qua `models/lora/registry.json`; ứng dụng không tự tải từ Internet.
- Chỉ tệp `.safetensors` có SHA-256 đúng và base model SD3.5 mới được bật.
- Có thể chọn tối đa hai adapter, đặt weight và chạy A/B cùng seed.
- Kết quả LoRA luôn ghi adapter/checksum trong metadata và phải được duyệt trước khi đưa vào baseline.

## Quản lý model

- Giao diện quản lý đọc `models/registry.json`, kiểm tra đường dẫn, dung lượng và tệp bắt buộc.
- Có thể đăng ký đường dẫn model, kích hoạt cấu hình, xuất manifest và cách ly model không hoạt động.
- Thay model nền yêu cầu khởi động lại ứng dụng; model đang hoạt động không thể bị cách ly.
- Lịch sử registry được lưu trong `workspace/model-registry-history` để truy vết và rollback thủ công.

## Kiểm thử nhanh

### FLUX trên GPU 16 GB

- FLUX.1 Fill dev dùng cho chỉnh sửa vùng ảnh, với BF16 và chuyển từng lớp qua CPU để giảm VRAM.
- FLUX.2 klein 4B dùng cho tạo ảnh từ mô tả, với BF16, CPU offload, 4 bước và guidance 1. Negative prompt không được áp dụng cho model này.
- Cài klein bằng `.\.venv-sam2\Scripts\python.exe scripts/install-flux-klein.py`, hoặc tải từ thư viện model. Trình cài ghim revision, kiểm tra SHA-256 trọng số với nguồn và lưu `installation.json` trước khi cho phép chọn model.
- Môi trường đã kiểm tra: PyTorch 2.11.0+cu128, Diffusers 0.37.1, Transformers 5.5.4. Suy luận chỉ đọc tệp cục bộ.
- Các phiên bản thư viện phụ trợ được lưu trong `scripts/requirements-flux.txt`; dùng môi trường PyTorch CUDA hiện có của dự án.
- Chạy `.\.venv-sam2\Scripts\python.exe scripts/verify-flux.py fill` hoặc thay `fill` bằng `klein` để kiểm tra GPU. Ảnh và số đo được lưu trong `workspace/review/flux-validation`. Đây là kiểm thử vận hành, chưa thay thế đánh giá chất lượng ảnh.
- klein 4B dùng Apache-2.0; Fill dev dùng giấy phép FLUX.1-dev Non-Commercial. Các model FLUX.1 schnell/dev khác chưa được thêm vào luồng tạo ảnh.

### Kiểm tra cấu trúc dự án

```powershell
& 'C:\Users\lpak\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' .\tests\server.test.js
```

## Cấu trúc

- `app`: máy chủ local và giao diện mask.
- `models`: vị trí checkpoint offline ở các sprint sau.
- `samples`: ảnh mẫu đầu vào.
- `workspace/masks`: mask và metadata đã lưu.
- `workflows`: workflow thay trang phục/inpainting ở các sprint sau.
- `docs`: phạm vi và tiêu chí sprint.

Chi tiết xem `docs/SPRINT-1.md`.


Khi sửa đường nối trên trang phục, các ô chồng lấp dùng chi tiết từ một ô thay vì lấy trung bình các hoa văn lệch nhau. Sau hòa màu, hệ thống giữ chi tiết tần số cao của vải gốc trong dải mép và tận dụng chi tiết có sẵn ở phần mở rộng. Cách này hạn chế mất hoa văn khi ghép; vùng sinh mới thiếu hoa văn từ đầu vẫn cần được tạo lại.
