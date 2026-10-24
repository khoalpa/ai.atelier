# Chỉnh sửa thủ công

Trong Studio, chọn **Chỉnh sửa thủ công** ở thanh tác vụ. Có thể mở từ một phương án AI đã chọn, một ảnh trong Thư viện hoặc mục hoàn thiện Ảnh mới. **Mở ảnh** nhận PNG, JPEG và WebP trên máy. Các thao tác chạy cục bộ, không cần Internet. Nhận diện chủ thể tự động dùng model BiRefNet có trên máy; các công cụ thủ công không cần model.

Ảnh nguồn được sao chép riêng. Với ảnh đang chọn trong Studio, trình sửa mở lại phiên gần nhất nếu đã có. Dùng **Mở ảnh** để bắt đầu phiên mới hoặc **Lưu và xuất ảnh → Phiên đã lưu** để mở một phiên khác.

## Giai đoạn 1 — Bố cục, màu và lưu phiên

- Cắt tự do hoặc theo các tỷ lệ 1:1, 4:5, 2:3, 3:2, 16:9, 9:16; kéo khung rồi bấm **Áp dụng khung cắt**.
- Xoay trái/phải 90°, lật ngang/dọc, cân thẳng từ −45° đến 45°. Góc trống sau xoay giữ trong suốt; có thể cắt lại.
- Đổi kích thước theo pixel, có khóa tỷ lệ. Ảnh xem trước và ảnh xuất dùng chung phép biến đổi. Phần đã cắt không xuất hiện lại khi xoay tiếp.
- Độ sáng, tương phản, vùng sáng/tối, độ bão hòa và ấm/lạnh. Các thanh màu áp dụng cho ảnh nền và lớp ghép.
- Hoàn tác/làm lại; xem ảnh trước chỉnh sửa trong cùng khung hiện tại; vừa khung và xem 100% thực.
- Tự lưu sau khi dừng chỉnh khoảng một giây. **Lưu phiên bản** ghi lại ngay. Đóng cửa sổ chỉnh sửa sẽ chờ lưu hoàn tất.
- Phiên đã lưu giữ ảnh gốc, thông số màu, nét cọ, phép biến đổi và lớp ghép. Hoàn tác/làm lại dùng trong phiên đang mở; sau khi tải lại trang, dùng số **Phiên bản cũ → Khôi phục bản này** để quay về trạng thái đã lưu. Việc khôi phục tạo phiên bản mới.
- Khi hai cửa sổ cùng sửa một phiên, bản ghi cũ bị từ chối. **Lưu thành phiên mới** giữ bản chỉnh hiện tại dưới một phiên riêng.

## Giai đoạn 2 — Vùng chọn và cọ

Chọn vùng chữ nhật, ellipse, đa giác hoặc vẽ tự do. Có vùng mới, cộng vùng, trừ vùng và làm mềm mép. Với đa giác, nhấp các đỉnh rồi nhấn Enter. Vùng chọn giới hạn các nét cọ tiếp theo. Để chỉnh màu riêng vùng đó, dùng **Màu → Thêm lớp điều chỉnh từ vùng chọn**; thanh màu toàn ảnh vẫn tác động lên toàn bộ ảnh. Bỏ vùng chọn cho phép sửa toàn ảnh.

Cọ có kích thước, độ mềm, độ đậm và vòng chỉ phạm vi. Các công cụ gồm tô màu, xóa thành trong suốt, sao chép điểm mẫu, vá từ điểm mẫu, khôi phục từ ảnh gốc của phiên, làm sáng/tối, làm mờ/nét cục bộ.

**Sao chép/Vá:** bấm **Chọn điểm mẫu** rồi nhấp lên ảnh, hoặc giữ Alt và nhấp. Kéo cọ ở vùng cần sửa. Vá từ mẫu điều chỉnh màu mẫu theo vùng đích; đây là công cụ sửa cục bộ, cần xem lại vùng có hoa văn, tóc hoặc đường biên. **Khôi phục** lấy pixel từ ảnh gốc của phiên; thanh màu và các lớp ghép vẫn được giữ. Cọ sửa ảnh tác động lên nền; vùng che lớp nằm trong công cụ Lớp.

## Giai đoạn 3 — Lớp ghép và xuất ảnh

- Thêm ảnh/logo hoặc chữ; chọn lớp, kéo để di chuyển, nhập vị trí/kích thước/góc xoay, thay thứ tự, ẩn/hiện và điều chỉnh độ hiện.
- Lớp chữ có nội dung nhiều dòng, cỡ chữ, màu và chữ đậm. Chữ nằm trong kích thước lớp; tăng chiều cao nếu thêm dòng.
- Bật **Tô vùng che trên lớp** để che mềm một phần lớp. Hoàn tác để bỏ nét vừa che hoặc **Bỏ vùng che của lớp** để hiện lại toàn bộ lớp.
- Lưu bộ màu và áp dụng các thanh màu hiện tại cho tối đa 12 ảnh tải lên. Tác vụ nhiều ảnh chỉ áp dụng màu; không sao chép khung cắt, nét cọ hoặc lớp ghép. Mỗi ảnh có phiên và PNG riêng. Dừng sau ảnh hiện tại; lỗi dừng ở ảnh gặp lỗi, các ảnh hoàn tất vẫn được giữ.
- Xuất PNG, JPEG hoặc WebP. PNG/WebP giữ alpha; JPEG ghép nền trắng. Có thanh chất lượng cho JPEG/WebP. Ảnh đã xuất xuất hiện trong Thư viện.
- **Dùng ảnh này trong Studio** xuất một PNG, tạo ảnh nguồn mới và chuyển đến tác vụ AI đã chọn. Vùng chọn, kết quả nhận diện và khung xương cũ không được áp vào ảnh mới; nhận diện/chọn lại trước khi chạy AI.

## Phím tắt và giới hạn

H: di chuyển; C: bố cục; S: vùng chọn; B: cọ; V: lớp. Ctrl+Z: hoàn tác; Ctrl+Shift+Z hoặc Ctrl+Y: làm lại; Ctrl+S: lưu. Giữ Ctrl và cuộn chuột để thu phóng. Phím công cụ không kích hoạt khi đang nhập chữ.

Tối đa 16.777.216 pixel, 8192 px mỗi chiều, 24 lớp, 500 nét sửa nền, 128 nét che mỗi lớp, 32 thành phần vùng chọn, 100 bộ màu. Nét quá dài cần chia thành nhiều nét ngắn. Lịch sử trong bộ nhớ giới hạn 80 thao tác và dung lượng; các phiên bản đã lưu vẫn ở trên đĩa. Ảnh động không được nhận. Ảnh được chuẩn hóa hướng EXIF và sRGB, xử lý ở RGBA 8 bit.

Phần xem trước và xuất dùng cùng bộ xử lý OffscreenCanvas trong Web Worker. Các lớp nằm trong không gian ảnh nguồn và được biến đổi cùng khung ảnh; đây là bộ ghép ảnh trên khung cố định, chưa có mở rộng vô hạn, biến dạng cơ thể, đường cong màu hay chế độ hòa trộn nâng cao.

## Lưu trữ và kiểm chứng

- `workspace/manual/assets`: ảnh gốc/lớp đã chuẩn hóa, đặt tên theo SHA-256.
- `workspace/manual/projects` và `workspace/manual/versions`: phiên hiện tại và các phiên bản bất biến. Ghi tệp nguyên tử, kiểm tra số phiên bản khi cập nhật.
- `workspace/manual/presets.json`: các bộ màu.
- `workspace/outputs/manual/<mã>/result.*` và `metadata.json`: ảnh xuất và liên kết đến phiên đã dùng để xuất.
- Sao lưu ứng dụng bao gồm dữ liệu chỉnh thủ công. Mục đặt lại có phạm vi riêng cho các phiên này; thao tác đặt lại vẫn dùng cơ chế lưu trữ an toàn hiện có.

Kiểm thử nền tảng: `node --test tests/manual-core.test.js tests/manual-store.test.js`. Bộ kiểm thử trình duyệt `tests/manual-browser.html` dùng các ảnh fixture được chuẩn bị trong `workspace/diagnostics/manual-editor` để kiểm tra pixel thật qua worker. Báo cáo lần kiểm chứng nằm cùng thư mục chẩn đoán. Các phép đo xác nhận hành vi trên dữ liệu kiểm thử, không thay thế việc xem chất lượng vá ảnh trên từng ảnh thực tế.


## Hoàn thiện quy trình trong bản 2.4

- **Phiên và lịch sử:** tìm phiên theo tên, phân trang, xem hình của các phiên bản; lưu trữ và đưa phiên trở lại. Mở kết quả từ Thư viện giữ đầy đủ lớp. Nếu đã có bản mới hơn, chỉnh lại kết quả cũ tạo bản sao của đúng phiên bản đã xuất.
- **Lớp:** nhân đôi, khóa, căn theo khung hiện tại và thêm lớp màu theo vùng. Lớp màu tác động lên nội dung nằm dưới lớp, giữ alpha; các thanh màu toàn ảnh được áp dụng sau cùng.
- **Vùng dùng chung:** đặt tên và lưu tại Chọn vùng; Studio có mục Vùng chọn dùng chung để nạp làm vùng sửa hoặc bảo vệ. Vùng gắn với nội dung ảnh nguồn. Khi chuyển ảnh thủ công sang Studio, vùng được chuyển theo phép cắt/xoay/đổi kích thước hiện tại. Đổi tư thế bằng AI cần kiểm tra và chọn lại vùng.
- **Chủ thể và nền:** nhận diện tự động hoặc lấy vùng chọn làm chủ thể, sửa bằng cọ giữ/bỏ, chỉnh mép, nền trong suốt/màu/ảnh và bóng. Chất lượng tóc, chi tiết mảnh và phần bị che cần xem lại. Không có chế độ tách chủ thể riêng từng người tự động.
- **Xuất theo mẫu:** chọn 1–4 mẫu cho tối đa 12 ảnh/phiên, đặt kích thước, giữ toàn ảnh hoặc cắt đầy khung, PNG/JPEG/WebP, tên tệp và logo. Tổng tối đa 48 ảnh mỗi lô; JPEG ghép nền trắng. Mỗi tệp có liên kết tải riêng.
- **Hoạt động:** lô chỉnh màu, xuất ảnh và tư thế được lưu trên máy. Giữ trang mở khi chạy lô; đóng trang dừng phần chưa bắt đầu. Khi kết nối bị gián đoạn, chờ khoảng 30 giây rồi tiếp tục. Các ảnh hoàn tất được giữ nguyên, chỉ chạy phần còn thiếu. Tác vụ AI đã hoàn tất được nhận lại theo mã cũ.

Ảnh tối đa 16 triệu pixel, mỗi chiều không quá 8192 px; 24 lớp, 500 nét sửa ảnh và 128 nét sửa mặt nạ chủ thể. Phiên lưu giữ dữ liệu chỉnh sửa; tệp PNG/JPEG/WebP là ảnh đã ghép.
