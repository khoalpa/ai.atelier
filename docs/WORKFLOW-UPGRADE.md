# Hoàn thiện quy trình sáng tạo — bản 2.4

Đây là báo cáo của mốc 2.4. Vận hành và nghiệm thu hiện tại: [bản 2.5](STABILITY-2.5.md).

Đã triển khai cả ba giai đoạn và kích hoạt dịch vụ AI mới trên ứng dụng đang mở. Luồng nhận diện chủ thể, thay nền, xuất ảnh và mở lại phiên đã được kiểm tra trực tiếp.

## Giai đoạn 1 — Thư viện và dữ liệu

- Thư viện tìm trên toàn bộ dữ liệu, có phân trang, tìm không dấu, album, yêu thích và tên hiển thị. Không còn trần 200 kết quả hoặc 100 phiên làm ảnh cũ biến mất.
- Dự án ảnh gom ảnh nguồn, nhánh AI và phiên thủ công liên quan. Mở kết quả thủ công giữ lớp và đúng phiên bản; nếu phiên đã sửa tiếp, bản xuất cũ được mở thành bản sao độc lập.
- Dữ liệu có dấu hiệu kiểm thử được tách khỏi danh sách mặc định. Các tệp trung gian như mask và pose không được trình bày như kết quả bàn giao.
- Sao lưu có ba phạm vi: cấu hình/bộ mẫu, phiên/lịch sử, toàn bộ ảnh và dữ liệu. Bản đầy đủ gồm ảnh nguồn, mẫu, kết quả, lớp, phiên bản, vùng chọn, hàng đợi và đánh giá; model AI và gói phát hành không nằm trong bản sao này.
- Kiểm tra toàn vẹn trước khi phục hồi; giữ các tệp mới, tạo bản dự phòng có thể khôi phục và tự hoàn nguyên khi ghi lỗi. SQLite được sao chép bằng giao dịch ngay cả khi đang mở. Lưu và đóng các phiên chỉnh sửa trước khi sao lưu/khôi phục để có mốc nhất quán.
- Số bản sao lưu trong Hệ thống chỉ tính bản có cấu trúc phục hồi. Trạng thái chạy được trên máy và mức sẵn sàng của ảnh tham chiếu được hiển thị riêng. Dọn dữ liệu trình duyệt gồm cả bố cục và danh sách tư thế cũ.

## Giai đoạn 2 — Chỉnh sửa và duyệt

- Tìm phiên, lưu trữ/đưa trở lại, lịch sử phiên có ảnh xem trước.
- Vùng chọn có tên dùng được ở cả Studio và trình sửa thủ công, giữ mép mềm. Khi chuyển ảnh thủ công sang Studio, vùng đi theo phép biến đổi ảnh; khi ảnh nguồn thay đổi cần chọn/kiểm tra lại.
- Lớp điều chỉnh màu riêng vùng, nhân đôi, khóa và căn lớp theo khung hiện tại.
- Hoạt động lưu lô chỉnh màu, xuất ảnh và tư thế trên máy. Dừng sau ảnh hiện tại; tải lại trang rồi tiếp tục phần còn thiếu; ảnh hoàn tất không bị tạo lại. Một cửa sổ chỉ chạy một lô; phiên khác không thể nhận cùng lô đang chạy.
- Duyệt ảnh chung cho mọi công cụ, có nhãn lỗi và xuất ảnh được chấp nhận; phản hồi đồng bộ hai chiều với phần hoàn thiện chi tiết. Kiểm chuẩn trang phục nằm trong mục mở rộng. Model và Prompt được ẩn khỏi thanh chính ở chế độ Đơn giản, vẫn truy cập được trong Cài đặt.

## Giai đoạn 3 — Bàn giao ảnh

- Mẫu xuất kích thước, PNG/JPEG/WebP, chất lượng, tên tệp, logo/vị trí/độ hiện. Mỗi lô tối đa 12 ảnh × 4 mẫu; giữ toàn ảnh hoặc cắt đầy khung. Có liên kết tải từng ảnh và tiến độ trong Hoạt động.
- Chủ thể/nền: BiRefNet cục bộ hoặc vùng chọn thủ công, cọ thêm/bớt, sửa mép, nền trong suốt/màu/ảnh, bóng đổ. Model không bảo đảm mọi sợi tóc hay chi tiết bị che đều đúng; cần xem ảnh trước khi bàn giao.
- Gói phát hành ngoại tuyến 2.4 bao gồm các mô-đun mới và công cụ sao lưu SQLite. Gói mã không chứa model, môi trường Python hoặc kho Ollama; có tùy chọn kèm model khi đóng gói.

## Kiểm chứng ngày 24/10/2026

- 101/101 bài JavaScript: dữ liệu, quyền truy cập cục bộ, lưu phiên, hàng đợi, khôi phục sau lỗi, SQLite đang mở và các luồng cũ.
- 33/33 kiểm tra điểm ảnh trên trình duyệt: vùng chọn vector/raster, màu theo vùng, alpha, chủ thể/nền/bóng, logo, xuất ảnh và ảnh 16 triệu pixel.
- 10 bài kiểm tra chất lượng Python, một bài kiểm tra tách chủ thể/đường dẫn/alpha và một bài kiểm tra handler nhận diện chủ thể.
- BiRefNet thật xử lý ảnh 1024 × 768; lưu mặt nạ thành công trong khoảng 42 giây ở lần nạp đầu.
- Giao diện: nhân đôi/căn/khóa lớp; lịch sử có hình; lưu trữ/phục hồi phiên; vùng chọn đi hai chiều; xuất WebP 320 × 320 và PNG 1080 × 1080; dừng tại 1/2 ảnh, tải lại trang, tiếp tục đúng ảnh còn thiếu; duyệt và tìm lại ảnh đã chấp nhận; chế độ Đơn giản; mở bản xuất cũ còn đầy đủ lớp.
- Bản sao lưu đầy đủ: `backup-2026-10-23T19-22-13-105Z-d611ce`, 5.566 tệp, 4.139.177.075 byte; đã đối chiếu checksum.
- Đã sửa trường hợp danh sách phiên tải chậm làm ghi đè lựa chọn vừa chọn; có kiểm thử hồi quy riêng.
- Công cụ khởi động lại AI đạt 10/10 kiểm tra; lần khởi động thực tế đã thành công, dịch vụ mới báo `manualCutoutVersion: 1` và chạy trên GPU.
- Kiểm tra trực tiếp nút **Nhận diện chủ thể** trên bản sao ảnh 1024 × 768: xuất PNG giữ nền trong suốt và mép mềm, đổi nền màu/thêm bóng, xuất ảnh nền màu và mở lại phiên giữ đầy đủ thiết lập. Ảnh gốc và phiên minh họa trước đó được giữ nguyên.
- Chi tiết kiểm chứng nằm trong `workspace/diagnostics/workflow-upgrade`.

## Kích hoạt và giới hạn

Dịch vụ web và AI đã nạp bản mới tại cổng 7860/7861. Nhận diện chủ thể đã hoạt động qua giao diện chính; không còn bước kích hoạt chờ thực hiện cho đợt nâng cấp này. Phiên **Minh họa · Nhận diện chủ thể tự động** lưu kết quả kiểm tra cùng các lớp và thiết lập nền.

Khi cập nhật mã AI trong những lần sau, đợi mọi thao tác AI hoàn tất rồi mở PowerShell tại thư mục dự án và chạy:

```powershell
.\restart-ai.ps1
```

Công cụ kiểm tra tác vụ/lô ảnh và đúng tiến trình của dự án trước khi dừng, kiểm tra CUDA, lưu nhật ký riêng trong `workspace/logs`, rồi đợi dịch vụ mới báo đã có công cụ nhận diện chủ thể. `-CheckOnly` chỉ đọc trạng thái; `-WhatIf` xem thao tác dự kiến. Với cổng riêng, truyền `-AiPort` và `-WebPort`. Sau khi thành công, mở bản sao ảnh trong **Chỉnh sửa thủ công → Chủ thể & nền → Nhận diện chủ thể**, xem mép tóc/tay rồi xuất ảnh để kiểm tra trọn luồng.

Từ bản 2.5, hàng đợi chạy trên dịch vụ, có thể đóng giao diện và xem lại tại Hoạt động; xem quy tắc phục hồi trong báo cáo 2.5. Đây là chỉnh ảnh tĩnh, không xuất video; ảnh tối đa 16 triệu pixel, 8192 px mỗi chiều và 24 lớp. Kết quả kiểm thử kỹ thuật không thay thế duyệt nội dung, danh tính, bàn tay hoặc chất lượng trang phục.

Bản dự phòng mã nguồn trước khi nâng cấp: `workspace/backups/workflow-upgrade-20261024-012907`.
