# Lộ trình tái cấu trúc UI/UX

Tài liệu này theo dõi quá trình chuyển AI Atelier từ giao diện kỹ thuật nhiều bảng điều khiển sang một công cụ sáng tạo lấy Canvas làm trung tâm. Việc tái cấu trúc không thay đổi API hoặc pipeline AI hiện có.

## Đã hoàn thành

- [x] Rút gọn điều hướng chính còn Studio, Thư viện, Duyệt và Hoạt động.
- [x] Đưa Model, Chất lượng, Backup và Hệ thống vào khu vực Cài đặt và quản trị.
- [x] Chuyển Studio sang bố cục Canvas-first trên desktop.
- [x] Thêm ba điểm vào tác vụ: Xóa vật thể, Thay trang phục và Ảnh mới.
- [x] Giữ thiết lập kỹ thuật trong nhóm Thiết lập nâng cao.
- [x] Tạo Thư viện ảnh có tìm kiếm và hành động mở ảnh trong Studio.
- [x] Tạo màn hình Duyệt và Hoạt động độc lập với Studio.
- [x] Bổ sung command bar cố định, hiển thị dữ liệu còn thiếu và hành động tiếp theo.
- [x] Thiết lập design tokens cho màu sắc, khoảng cách, bề mặt và bo góc.
- [x] Đồng bộ theme tối toàn ứng dụng bằng token primitive, semantic và component.
- [x] Tách CSS theo cascade layer: nền tảng, màn hình, component và responsive.
- [x] Loại bỏ màu hard-code khỏi component/view và bỏ toàn bộ `!important`.
- [x] Thiết kế lại responsive với điều hướng dưới, Canvas ưu tiên trước và thuộc tính theo sau.
- [x] Giữ tương thích với ID điều khiển, API và trạng thái tác vụ hiện có.

## Cần hoàn thành

### Ưu tiên P0 - Hoàn thiện luồng chính

- [x] Đưa kết quả tạo ảnh vào filmstrip dưới Canvas thay cho dialog ở các tác vụ thường dùng.
- [x] Cho phép so sánh Trước/Sau trực tiếp trong Studio.
- [x] Đồng bộ trạng thái nút trong command bar khi tác vụ đang chạy và hoàn tất.
- [x] Tự mở kết quả mới nhất và cung cấp hành động Chọn, Chạy lại, Duyệt.
- [x] Chuẩn hóa trạng thái trống, tải dữ liệu, lỗi và phục hồi cho bốn khu vực chính.

### Ưu tiên P1 - Thuộc tính theo ngữ cảnh

- [x] Chỉ hiển thị cài đặt liên quan đến công cụ hoặc tác vụ đang chọn.
- [x] Tách chế độ Đơn giản và Chuyên gia.
- [x] Ẩn seed, steps, guidance, LoRA và thông số pipeline trong chế độ Đơn giản.
- [x] Thêm preset theo mục tiêu: Nhanh, Cân bằng và Chi tiết.
- [x] Giảm số accordion lồng nhau và chuẩn hóa nội dung trợ giúp.

### Ưu tiên P1 - Duyệt và bàn giao

- [x] Xây màn hình duyệt ba vùng: danh sách, so sánh và quyết định.
- [x] Giữ thanh Chấp nhận, Chạy lại, Loại bỏ cố định khi duyệt.
- [x] Hiển thị rõ phím tắt A, R và X trên các nút tương ứng.
- [x] Tách điều kiện nghiệm thu và hiệu chỉnh trọng số khỏi quyết định từng ảnh.
- [x] Thêm xác nhận trước khi xuất gói bàn giao.

### Ưu tiên P2 - Thư viện

- [x] Bổ sung bộ lọc Ảnh nguồn, Kết quả và Tham chiếu.
- [x] Hiển thị metadata cơ bản: kích thước, ngày tạo và tác vụ.
- [x] Thêm lựa chọn nhiều ảnh và thao tác theo lô.
- [x] Thêm nhóm Gần đây.
- [ ] Hỗ trợ xóa hoặc lưu trữ an toàn với bước xác nhận.

### Ưu tiên P2 - Kiến trúc frontend

- [ ] Tách `app.js` thành các module Studio, Library, Review, Activity, Settings và Services.
- [ ] Tách `index.html` thành các template hoặc component có phạm vi rõ ràng.
- [x] Tách lớp CSS của giao diện mới khỏi tệp CSS nguyên khối.
- [x] Bổ sung store tập trung cho view, task, job, selection và result state.
- [ ] Loại bỏ thao tác chuyển node DOM động khi cấu trúc component mới đã ổn định.

### Ưu tiên P2 - Chất lượng trải nghiệm

- [x] Kiểm thử ở các breakpoint 360, 768, 1024 và 1440 px.
- [ ] Kiểm thử toàn bộ luồng bằng bàn phím.
- [ ] Rà soát focus order, tên truy cập và thông báo `aria-live`.
- [ ] Kiểm tra độ tương phản và trạng thái không chỉ phụ thuộc vào màu sắc.
- [ ] Đo thời gian tạo kết quả đầu tiên và số thao tác trước khi chạy.

## Bước tiếp theo được đề xuất

Lộ trình trải nghiệm chính đã hoàn thành. Bước tiếp theo là hardening kỹ thuật: tách dần `app.js` và `index.html`, bổ sung thao tác lưu trữ an toàn trong Thư viện, rồi đo usability trên người dùng thực tế.

## Tiêu chí hoàn thành

- Người mới có thể tạo kết quả đầu tiên trong dưới ba phút.
- Không cần quá bốn quyết định trước khi bắt đầu tác vụ.
- Hành động chính luôn xuất hiện trong viewport hiện tại.
- Các thiết lập kỹ thuật không xuất hiện mặc định trong chế độ Đơn giản.
- Có thể tạo, so sánh, chọn và chuyển kết quả sang Duyệt mà không rời Studio.
- Các bài kiểm thử chức năng hiện có tiếp tục hoạt động.
