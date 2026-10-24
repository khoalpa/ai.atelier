# Cải thiện ảnh

Trong **Studio → Cải thiện ảnh**, chọn ảnh nguồn, cách cải thiện và mức độ. Chức năng dùng được với ảnh tải lên và ảnh mẫu. Trong kết quả chỉnh sửa, chọn một phương án rồi bấm **Cải thiện ảnh này**; ảnh mới từ mô tả cũng có nút này.

## Làm mịn & sửa da

Trong **Cách cải thiện**, nhóm **Làm mịn & sửa da** có ba công cụ:

- **Làm mịn da tự nhiên:** giảm độ sần nhẹ, giữ sắc da và vân da. Không dùng để xóa sẹo hoặc nốt ruồi.
- **Xóa khuyết điểm nhỏ:** tô sát vết bẩn, mụn, nốt ruồi hoặc từng đốm nhỏ. Công cụ lấp vùng đó bằng màu xung quanh và lấy chi tiết mịn từ vùng lân cận không được chọn. Chạy trên CPU, không cần model mới. Mức Nhẹ/Vừa/Mạnh điều chỉnh bán kính lấp; không trộn lại khuyết điểm gốc.
- **Sửa vùng da bằng AI:** dùng cho sẹo, vết thương hoặc vùng khó sửa. Tô cả vết và phần bóng đổ liên quan, chừa da xung quanh để tham chiếu. Dùng model SDXL Inpainting cục bộ; mức Nhẹ/Vừa/Mạnh điều chỉnh mức tái tạo. AI có thể thay đổi chi tiết bên trong vùng tô, cần xem lại kết quả.

Sửa da luôn cần vùng tô đỏ, kể cả khi gọi API với phạm vi toàn ảnh. Cọ xanh giữ mắt, môi, tóc, hình xăm hoặc dấu đặc trưng. Tính năng không tự phát hiện da hoặc khuyết điểm và không tự chọn cả khuôn mặt. Phần ngoài vùng sửa và vùng bảo vệ giữ nguyên pixel theo ảnh đã chuẩn hóa; kích thước và kênh trong suốt được giữ lại.

**Mức làm mịn** độc lập với mức sửa khuyết điểm: mặc định 35% cho làm mịn và 0% cho hai công cụ xóa/sửa. **Giữ vân da tự nhiên** bật sẵn. Khi xóa điểm, vân da được lấy từ vùng lân cận, không khôi phục chi tiết của khuyết điểm gốc. Việc chọn da mẫu thủ công và tự nhận diện da chưa có trong bản này.

**Xem thử vùng da** tự đặt cửa sổ tối đa 256 × 256 pixel tại vùng được chọn đầu tiên. Phần xử lý vẫn đọc đầy đủ vùng tô và ngữ cảnh, tránh cắt đôi vết sẹo ở mép cửa sổ thử. Khi có nhiều vùng, bản xem thử chỉ chạy các nhóm vùng giao với cửa sổ này; áp dụng sẽ xử lý tất cả. So sánh ở 100%, sau đó bấm **Áp dụng cho vùng da đã tô**. Kết quả toàn ảnh có nút **Chỉnh lại vùng và thiết lập**, khôi phục nguồn, vùng tô, vùng bảo vệ và các thiết lập; cũng dùng được khi mở kết quả từ Hoạt động. Nguồn phải còn trong danh sách ảnh và có cùng kích thước.

Xóa điểm nhỏ giới hạn 128 điểm mỗi lượt, mỗi thành phần không quá 256 px mỗi chiều và không có vùng lõi cách biên quá khoảng 32 px. Vùng quá rộng sẽ được yêu cầu chọn công cụ AI hoặc tô sát hơn. AI cần vùng da xung quanh để tham chiếu, không chấp nhận vùng tô chiếm trên 65% vùng ngữ cảnh. Cả ba công cụ dùng cùng cơ chế hủy, lưu nguyên tử và lịch sử của Cải thiện ảnh, không qua bộ tự động cải thiện nền.

Mở phiên có sửa da bằng `scripts/start-skin-retouch.ps1` (web 27862, AI 27863). Phiên này không dừng các phiên đang có. Nếu dùng ứng dụng chính, khởi động lại dịch vụ AI và tải lại trang để nạp mã mới. Model AI là thư mục `models/inpainting/stable-diffusion-xl-1.0-inpainting-0.1` đã có trong dự án; thiếu model thì nút chạy AI bị khóa, hai công cụ CPU vẫn dùng được. Không tải model trong lúc xử lý. Sửa da AI dùng cấu hình riêng, không áp dụng LoRA đang chọn cho công cụ khác.

Kiểm chứng: `tests/skin-retouch.test.py` kiểm tra khuyết điểm nhỏ, nhiều vùng, bảo vệ, alpha, sắc da, giữ vân da, khớp bản xem thử, giới hạn đầu vào và hủy. `scripts/verify-skin-retouch.py` chạy qua HTTP với nốt ruồi trên ảnh mẫu, làm mịn má và một vết sẹo **mô phỏng** thêm vào bản sao ảnh để kiểm tra AI; không dùng dữ liệu này làm phản hồi học. Báo cáo nằm trong `workspace/diagnostics/skin-retouch/live-verification.json`. Kết quả thử ban đầu: CPU khoảng 0,4 giây, AI khoảng 79 giây gồm lần nạp đầu và 19 giây cho lượt sau trên máy hiện tại. Đây là kiểm tra một ảnh mẫu và dữ liệu tổng hợp, chưa chứng minh chất lượng trên mọi dạng sẹo hoặc sắc da.

## Làm rõ viền da

Chọn **Cải thiện ảnh → Làm rõ viền da**. Tô một dải dọc đường tiếp giáp da và nền, phủ nhẹ sang cả hai phía. Phạm vi luôn là vùng tô, trừ phần bảo vệ màu xanh. Công cụ chạy trên CPU, không cần thêm model hoặc truy cập mạng.

- **Độ rõ đường biên:** Nhẹ / Vừa / Mạnh, mặc định Nhẹ.
- **Bề rộng mỗi phía:** 3–48 pixel nguồn, mặc định 16; chỉ chỉnh phần nằm trong dải quanh đường biên và trong vùng tô.
- **Độ mềm của viền:** mặc định 50%; tăng để giữ chuyển tiếp dịu hơn, giảm để đường biên rõ hơn.
- **Khử lem màu nền:** mặc định 30%; giảm thành phần màu nền trên phía da. Đặt 0 để tắt.
- **Giữ đường nét cơ thể:** luôn bật. Không dịch chuyển pixel, đổi kích thước hoặc sinh lại hình dạng cơ thể. Phép tăng độ rõ giữ mốc giữa vùng chuyển tiếp thay vì dời đường biên.

Hai phía được ước lượng theo màu, **không phải nhận diện da tự động**. Khi màu nền gần màu da hoặc nhận diện chưa đúng, bấm **Chọn điểm Da**, nhấp sâu vào phía da; bấm **Chọn điểm Nền**, nhấp sâu vào nền gần đoạn cần sửa. Điểm hiển thị kèm nhãn trên ảnh. Chọn thiếu một điểm sẽ khóa nút xử lý; bấm **Xóa hai điểm** để trở về tự động. Không lấy điểm ngay trên vùng đang nhòe. Nếu tự động không phân biệt đủ chắc phía da, phần khử lem được bỏ qua và có thông báo trong cửa sổ so sánh; phần làm rõ vẫn hoạt động.

**Xem thử và nhận diện viền** xử lý với cùng ngữ cảnh như toàn ảnh rồi hiển thị cửa sổ tối đa 256 × 256 pixel tại đường biên. Bật **Hiện đường biên nhận diện (màu vàng)** trong cửa sổ so sánh để kiểm tra. Lớp vàng chỉ là hướng dẫn, không nằm trong ảnh kết quả. Cần kiểm tra đoạn vai/tay, độ mềm, lem màu và viền sáng/tối trước khi áp dụng. Với nền phức tạp, nên sửa từng đoạn ngắn và chọn lại hai điểm gần đoạn đó.

Kết quả lưu ảnh trước/sau, vùng tô, vùng bảo vệ, dải xử lý, lớp đường biên và các thông số cùng hai điểm tham chiếu. **Chỉnh lại vùng và thiết lập** khôi phục đầy đủ để điều chỉnh; cũng dùng được khi mở kết quả từ Hoạt động. Pixel ngoài dải xử lý hoặc ngoài vùng cho phép giữ nguyên theo nguồn đã chuẩn hóa; alpha được giữ lại. Vùng quá lớn (hơn 4.194.304 pixel cho một vùng phân tích kể cả ngữ cảnh), vùng không cắt qua đường biên, hoặc hai màu quá gần nhau sẽ báo lỗi và không lưu kết quả giả.

Mở phiên có công cụ bằng `scripts/start-skin-edge.ps1` (web 27864, AI 27865), hoặc khởi động lại dịch vụ AI chính và tải lại trang. Các phiên đang chạy được giữ nguyên.

Kiểm chứng: `tests/skin-edge.test.py` có 13 bài kiểm tra độ rộng chuyển tiếp, vị trí giữa biên, viền sáng/tối, biên cong, nhiều sắc da, tham số, mask, alpha, xem thử và hủy. `tests/enhancement-ui.test.js` kiểm tra thêm thao tác hai điểm và chặn phiên dịch vụ cũ. Đã chạy trực tiếp trên bản sao ảnh vai người dùng cung cấp (1062 × 1040), cả tự động, hai điểm và xem thử; khoảng 0,6–0,9 giây mỗi lượt trên máy hiện tại. Bản xem thử khớp chính xác với phần tương ứng của kết quả toàn ảnh; ngoài vùng tô và ngoài dải xử lý có sai khác pixel bằng 0. Báo cáo ở `workspace/diagnostics/skin-edge/live-verification.json`. Kiểm tra số học và ảnh mẫu không bảo đảm phục hồi chính xác mọi biên bị mất nét; chưa có tái tạo biên bằng AI.

## Cách xử lý

- **Cải thiện nhẹ:** giảm nhiễu và tăng chi tiết độ sáng trên CPU, giữ kích thước. Không cần model mới.
- **Phóng lớn AI 2×:** dùng RealESRGAN_x2plus cục bộ, tăng gấp đôi chiều rộng và chiều cao. Kết quả AI được hòa với bản nội suy theo mức Nhẹ/Cân bằng/Mạnh, giới hạn thay đổi và hạn chế lệch màu.
- **Ảnh sản phẩm:** giảm mức xử lý và ưu tiên giữ thành phần màu.
- **Ảnh người mẫu:** giảm mức xử lý trên toàn ảnh. Cấu hình này không tự nhận diện da hoặc bảo vệ khuôn mặt. Dùng cọ bảo vệ để giữ các chi tiết cần thiết.
- **Ảnh tổng thể:** cho phép tăng chi tiết và điều chỉnh màu nhiều hơn hai cấu hình trên.

Mặc định là cải thiện nhẹ, ảnh sản phẩm, mức Nhẹ. Không dùng model phục hồi khuôn mặt riêng; AI phóng lớn vẫn có thể suy diễn chi tiết nhỏ. Cần xem lại mắt, chữ, logo và hoa văn.

## Phạm vi và xem thử

Chọn **Toàn ảnh, trừ vùng bảo vệ** hoặc **Chỉ vùng đã tô đỏ**. Vùng xanh luôn được loại khỏi xử lý. Khi giữ kích thước, pixel ngoài vùng sửa được giữ chính xác theo ảnh nguồn đã chuẩn hóa chiều EXIF và màu sRGB. Khi phóng lớn 2×, các vùng này dùng nội suy Lanczos; không thể giữ nguyên số pixel của ảnh gốc khi kích thước thay đổi. Biên chỉ được làm mềm vào phía bên trong vùng sửa.

**Xem thử một vùng** xử lý tối đa 256 × 256 pixel nguồn. Có thể đặt vị trí ngang/dọc từ 0 đến 100%. Hệ thống đọc thêm ngữ cảnh quanh vùng thử; bản xem thử được đánh dấu riêng và không thay thế ảnh toàn kích thước. Có thể xem thử ngay cả khi đầu ra toàn ảnh vượt giới hạn. Vùng thử nằm hoàn toàn ngoài vùng sửa sẽ báo lỗi rõ ràng.

Giới hạn ảnh nguồn và đầu ra: 16.777.216 pixel, tối đa 8192 pixel mỗi chiều. Không tự hạ kích thước hoặc chuyển sang nội suy khi AI không sẵn sàng. Ảnh đầu vào được chuẩn hóa EXIF và hồ sơ màu; đầu ra là PNG 8 bit. Kênh trong suốt được giữ lại, nội suy khi phóng lớn. Hồ sơ màu không đọc được hoặc định dạng độ sâu chưa hỗ trợ sẽ báo lỗi.

## Kết quả và lịch sử

Thanh trước–sau trong Studio hỗ trợ so sánh nhanh. **So sánh ở 100%** mở hai ảnh đồng bộ tại kích thước thật, có thanh kéo và thanh cuộn. Với AI 2×, ảnh trước được nội suy lên cùng kích thước để đối chiếu.

Kết quả lưu trong `workspace/outputs/enhance/<mã-lượt>/`, gồm ảnh nguồn, ảnh đối chiếu, ảnh kết quả, mask và metadata. Có thể chọn kết quả chính, tải PNG và dùng để chỉnh sửa tiếp. Ảnh gốc không bị ghi đè. Mở lại kết quả hoặc bản xem thử bằng **Hoạt động → Xem ảnh cải thiện**.

Hủy được kiểm tra trước/sau xử lý và giữa các ô AI. Chỉ công bố thư mục kết quả sau khi lưu hoàn chỉnh và kiểm tra hủy; tác vụ đã hủy không tạo kết quả trong Thư viện. Yêu cầu và tiến độ dùng cùng hệ thống tác vụ hiện có. Khi chạy lại một tác vụ gián đoạn, quá trình bắt đầu lại từ đầu.

Tác vụ `enhance` có cờ `enhancementApplied` và nằm ngoài danh sách của bộ tự động hoàn thiện nền. Không tạo vòng lặp cải thiện hoặc đưa phản hồi kiểm thử vào dữ liệu học.

## Khởi động và model

Mở phiên nâng cấp riêng:

```powershell
powershell -File scripts/start-enhancement-upgrade.ps1
```

Mặc định web ở `http://127.0.0.1:27860`, AI ở cổng 27861. Trình mở không dừng các phiên khác. Ứng dụng chính dùng cùng mã sau khi khởi động lại cả web và dịch vụ AI.

Model đã được cài tại `models/enhancement/RealESRGAN_x2plus.pth`. Trên máy khác, chuẩn bị model khi có Internet bằng `scripts/setup-enhancement.ps1`, hoặc sao chép từ gói offline có model. Quá trình cải thiện ảnh không truy cập mạng. Thiếu hoặc sai checksum model thì AI 2× báo lỗi; cải thiện nhẹ vẫn dùng được.

Tích hợp dùng kiến trúc RRDBNet từ BasicSR với giấy phép kèm theo trong `vendor/enhance/LICENSE.txt`. Bản suy luận chỉ dùng PyTorch đang có, không yêu cầu cài BasicSR hoặc sửa phiên bản thư viện. AI chia ô 256 px, chồng lấn 32 px và đọc thêm ngữ cảnh 32 px; ghép trọng số trên CPU để tránh giữ toàn ảnh đầu ra trong GPU.

## Kiểm chứng

```powershell
.venv-sam2/Scripts/python.exe tests/image-enhancement.test.py
node tests/enhancement-ui.test.js
.venv-sam2/Scripts/python.exe scripts/verify-enhancement.py
.venv-sam2/Scripts/python.exe scripts/verify-enhancement-live.py
```

14 bài kiểm thử xử lý kiểm tra mask, bảo vệ ở 1×/2×, alpha, EXIF, tham số, giới hạn pixel, vùng xem thử, kích thước trả về sai, hủy trước xử lý/trong khi lưu và chống xử lý lặp. Kiểm thử giao diện kiểm tra điều kiện chạy, ngân sách xem thử, payload và lịch sử nhánh. Các kiểm thử hồi quy liên quan đến Studio, kết quả, outpainting, ảnh mới và chất lượng nền cũng đã chạy đạt.

Bộ kiểm chứng ảnh thật gồm bốn nhóm: người mẫu, vải, sản phẩm và nội thất; mỗi nhóm chạy cải thiện nhẹ và AI 2× trên bản thu nhỏ. Cả tám lượt giữ nguyên tệp nguồn và vùng bảo vệ. Đối chiếu chia ô với xử lý một ô trên ảnh vải có sai khác trung bình 0,623/255; đây là kiểm tra số học, không chứng minh mọi ảnh không có đường nối.

Kiểm chứng qua HTTP trên RTX A4500 Laptop GPU: ảnh 581 × 1024 lên 1162 × 2048 mất khoảng 9,7 giây; xem thử AI 512 × 512 khoảng 3 giây. Thời gian phụ thuộc kích thước, phần cứng và tải máy. Đã kiểm tra chọn kết quả, đọc lại tác vụ, hủy tác vụ AI và từ chối đường dẫn nguồn không hợp lệ.

Báo cáo nằm trong `workspace/diagnostics/image-enhancement/verification.json`, `tile-comparison.json` và `live-verification.json`. Các chỉ số bảo toàn không thay thế việc duyệt chất lượng thẩm mỹ. Bản đầu chưa có 4×, xử lý hàng loạt hoặc phục hồi khuôn mặt riêng.
