# AI Atelier 2.5 — Ổn định & nghiệm thu

Ba giai đoạn của đợt 2.5 đã được triển khai: quản lý dịch vụ, nghiệm thu theo tác vụ và hàng đợi chạy trên máy. Phiên bản dùng chung được khai báo trong `version.json`; web, AI và gói ngoại tuyến đọc cùng nguồn này.

## 1. Phiên bản và dịch vụ

Vào **Cài đặt và quản trị → Phiên bản & kết nối** để xem phiên bản web, AI và khả năng xuất ảnh nền. Khi mã nguồn thay đổi, ứng dụng báo dịch vụ nào cần nạp lại, kể cả khi số phiên bản chưa đổi.

**Khởi động lại AI** kiểm tra cả tác vụ có tên, thao tác AI đang xử lý và các lô đang chờ/chạy. Dịch vụ đặt một phiên bảo trì có chủ sở hữu trước khi khởi động lại, không nhận thêm yêu cầu xử lý trong khoảng đó. Công cụ xác nhận đúng tiến trình của dự án, kiểm tra CUDA trước khi dừng, lưu nhật ký và xác nhận mã nguồn mới đã được nạp. Phiên bảo trì tự hết hạn nếu công cụ gặp sự cố.

**Nạp lại giao diện** cũng kiểm tra hàng đợi trước khi khởi động lại web. Lưu vùng chỉnh sửa trước khi dùng nút này. Nhật ký khởi động lại AI gần nhất được giữ qua lần nạp lại web.

Các trình mở phiên nâng cấp trên cổng riêng chỉ còn là công cụ lịch sử. Dùng `start-all.ps1` và giao diện chính tại cổng 7860 cho công việc hằng ngày.

## 2. Bộ nghiệm thu thống nhất

Mở **Duyệt → Chất lượng theo từng tác vụ**. Bộ nghiệm thu bao gồm Tư thế & biểu cảm, Thay trang phục, Xóa vật thể, Mở rộng ảnh, Cải thiện ảnh, Trang điểm, Ảnh mới và Chỉnh sửa thủ công/nền.

1. Thêm ca từ ảnh kết quả trong mục Duyệt hoặc nút **Thêm ca nghiệm thu**; chọn tác vụ, mức độ, ảnh nguồn và ảnh tham chiếu nếu cần.
2. Mở **Đối chiếu & đánh giá**. Có chế độ vừa khung/100% và cuộn đồng bộ các ảnh.
3. Đánh giá đủ tiêu chí. Mục không áp dụng cần lý do; không thể bỏ qua toàn bộ tiêu chí. Ghi rõ người đánh giá là người dùng hay trợ lý.
4. Tải báo cáo để lưu kết quả. Có thể đưa ca vào lưu trữ và đưa lại vào bộ nghiệm thu.

Ảnh nguồn, kết quả và tham chiếu được gắn bằng SHA-256. Ảnh thay đổi hoặc biến mất khiến đánh giá cũ hết hiệu lực; cần cập nhật mốc và duyệt lại. Lịch sử đánh giá được giữ, thay đổi đồng thời bị từ chối để tránh ghi đè. Dữ liệu nằm trong `workspace/acceptance` và được đưa vào sao lưu công việc/đầy đủ.

Chỉ số kỹ thuật là dữ liệu đã lưu của đúng lượt tạo ảnh, có ghi rõ chưa chạy lại model trong đợt 2.5. Tình trạng tệp, chỉ số kỹ thuật và quyết định xem ảnh được trình bày riêng. Một ngưỡng kỹ thuật đạt không tự tạo quyết định chấp nhận.

### Kết quả đối chiếu trên máy này

Đã chọn và xem 16 ca hiện có: mỗi tác vụ một ca thông thường, một ca khó. Trợ lý đánh giá **8 đạt, 8 cần sửa, 0 chưa duyệt**. Đây là nghiệm thu nội bộ trên các ảnh đã chọn, không phải phê duyệt của người dùng hay bảo đảm cho mọi ảnh. Các ca tổng hợp/tái dựng được ghi rõ giới hạn; các model không được chạy lại toàn bộ trong đợt này.

| Ca cần sửa | Vấn đề quan sát được |
| --- | --- |
| Hai người bắt tay | Áo và diện mạo thay đổi; bàn tay chưa thuyết phục |
| Thử áo khi giơ tay | Còn áo cũ và trộn họa tiết |
| Xóa trên nền phẳng | Còn mảng sáng hình chữ nhật |
| Xóa trên nền kẻ | Còn vùng nhòe/tối tại chỗ xóa |
| Mở rộng studio sang trái | Phần nền mới không khớp tường/sàn |
| Mở rộng phía trên chân dung | Lộ đường nối và tóc không liên tục |
| Tạo ảnh hai người | Bàn tay bị cắt khỏi khung dù mô tả yêu cầu thấy tay |
| Xuất chủ thể trong suốt | Còn viền vàng của nền cũ |

Bộ nghiệm thu vì vậy vẫn hiển thị **chưa đạt đầy đủ**. Những lỗi ảnh trên là danh sách ưu tiên cho đợt cải thiện chất lượng kế tiếp, không bị đổi thành “đạt” để hoàn tất phát hành phần mềm.

## 3. Hàng đợi chạy nền

Các lô chỉnh màu, xuất ảnh và Tư thế & biểu cảm được điều phối bởi web service trên máy. Sau khi bấm chạy, có thể đóng trang; máy và dịch vụ phải tiếp tục hoạt động. Xem tiến độ hoặc tiếp tục lô tại **Hoạt động → Công việc nhiều ảnh**.

- Chỉ một tiến trình nhận quyền xử lý hàng đợi trong cùng dự án, kể cả khi mở thêm cổng web.
- Tiến độ và mã lượt AI được lưu trước/sau từng ảnh. Tiến trình mới có thể nhận lại sau khoảng 30 giây khi tiến trình cũ mất.
- Ảnh xuất đã được lưu và kiểm tra checksum được dùng lại nếu dịch vụ ngắt trước khi ghi trạng thái hoàn tất. Các ảnh đã hoàn tất không bị chạy lại.
- Sau mất kết nối AI, dịch vụ hỏi trạng thái lượt cũ; lượt bị gián đoạn có điểm tiếp tục dùng yêu cầu đã lưu. Nếu không xác nhận được lượt cũ, lô dừng với thông báo để tránh tạo trùng.
- **Dừng sau ảnh hiện tại** giữ ảnh đang xử lý và dừng trước ảnh tiếp theo. Lỗi xử lý giữ tiến độ; bấm tiếp tục sau khi xử lý nguyên nhân.

Xuất nền dùng Edge hoặc Chrome đã cài trên Windows, chạy ẩn với thư mục tạm riêng và cùng bộ dựng ảnh của trình sửa. Không cài thêm trình duyệt. Thư mục tạm, khóa tiến trình và dữ liệu chẩn đoán không đi vào bản sao lưu người dùng.

## Kiểm chứng và phát hành

Đã kiểm tra: hai tiến trình tranh quyền xử lý; dừng/tiếp tục; mất kết nối AI; lượt AI không rõ trạng thái; tiếp tục từ điểm kiểm tra; chết tiến trình thật giữa yêu cầu; ảnh lưu trước khi hàng đợi kịp xác nhận; bảo trì và khởi động lại; mốc ảnh thay đổi; xung đột đánh giá; lưu trữ/phục hồi ca; xuất PNG/JPEG, alpha và kích thước.

Kiểm chứng trên giao diện chính: khởi động lại AI từ Cài đặt; lưu đánh giá với vai trò Trợ lý; khởi chạy lô sáu kích thước rồi đóng cửa sổ kiểm chứng khi còn 0/6 ảnh hoàn tất. Lô đã hoàn tất 6/6. Ảnh nền 1024 × 768 trùng toàn bộ bốn kênh điểm ảnh với bản xuất trước đó.

Kết quả chi tiết và ảnh chụp nằm trong `workspace/diagnostics/stability-2.5`. Gói ngoại tuyến 2.5 được kiểm tra checksum, cú pháp, khởi động và API trong thư mục sạch. Gói mã không kèm môi trường Python, kho Ollama hay model AI trừ khi chọn đóng gói model.

Bản dự phòng nguồn trước khi làm: `workspace/backups/stability-2.5-20261024-070333`.
