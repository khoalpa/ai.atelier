# AI Atelier 2.6 — Mép chủ thể & chất lượng nền

Đợt này ưu tiên chất lượng nền từ các ca cần sửa của bản 2.5. Không thay model mặc định, không ghi đè ảnh hoặc phiên chỉnh sửa cũ.

## Các thay đổi

**Chỉnh sửa thủ công → Chủ thể & nền → Khử màu viền** giảm màu nền cũ còn bám ở tóc và mép áo. Mức 0 giữ nguyên cách xuất trước đây; phiên cũ mặc định 0, lần nhận diện/chọn chủ thể mới mặc định 70%. Có thể hoàn tác, lưu phiên bản và xuất trong hàng đợi như các chỉnh sửa khác. Công cụ chỉ thay RGB ở dải mép tối đa 8 pixel, lấy màu từ vùng chủ thể bên trong; không đổi alpha, không tự cắt tóc. Nên xem ở 100% trên nền sáng và tối; sợi tóc quá mảnh không có vùng màu đáng tin cậy sẽ được giữ nguyên.

**Xóa vật thể** bổ sung bước khớp nền từ ngữ cảnh ảnh nguồn. Chỉ áp dụng cho vùng nền phẳng, chuyển sáng đều hoặc chi tiết theo hàng/cột khi kiểm tra vòng ngữ cảnh độc lập đạt ngưỡng. Bỏ qua vùng sát mép ảnh, vùng có bảo vệ, vùng quá lớn, thiếu ngữ cảnh hoặc hoa văn không dự đoán được. Bước này không dùng ảnh chuẩn, không đổi mô tả đã xác nhận, không tác động tác vụ thay trang phục. Nền phức tạp tiếp tục dùng kết quả AI và cần xem lại.

**Mở rộng ảnh** kiểm tra đường nối trên ảnh cuối, ở cả sát biên và dải rộng tới 64 pixel. Cảnh báo lệch màu/kéo giãn chi tiết/đứt đường nối hiển thị cạnh kết quả và được lưu trong dữ liệu nghiệm thu. Không thấy lỗi đo được vẫn được ghi là chưa kiểm chứng nội dung; tóc, vật thể và phối cảnh cần xem trực tiếp. Bước sửa đường nối bị bỏ qua nếu làm xuất hiện vân ảnh kéo giãn dù sai lệch sát biên giảm. Nếu bố cục mới sai, hãy tạo lại bố cục trước khi chạy hoàn thiện.

## Kiểm chứng

- 119 kiểm tra ứng dụng đạt; 10 kiểm tra liên quan được chạy lại sau lần chỉnh cuối.
- 33/33 kiểm tra trình dựng ảnh trên trình duyệt đạt, gồm ảnh 16 triệu pixel, lớp, cọ, vùng chọn, nền, alpha và xuất ảnh.
- Các bộ kiểm tra Python về nối nền, xóa vật thể, bốn hướng mở rộng, vùng bảo vệ, vật liệu, yêu cầu xử lý và phiên bản đều đạt.
- Chạy lại bước hậu kỳ trên 48 kết quả tổng hợp cũ: 35 cải thiện sai lệch so với ảnh chuẩn, 13 không áp dụng, không ca nào giảm chất lượng theo phép đo này; toàn bộ vùng ngoài lựa chọn giữ nguyên. Đây không phải bộ ảnh chụp thực độc lập hay 48 lượt AI mới.
- Chạy lại AI thật trên hai ca xóa: sai lệch trung bình trong vùng xóa từ 13,2007 và 5,8536 về 0/255 so với ảnh chuẩn tổng hợp. Điểm ảnh ngoài vùng sửa giữ nguyên.
- Xuất ba mức khử viền 0/70/100 bằng hàng đợi thật. Alpha giống nhau; mức 0 trùng từng điểm ảnh với bản xuất 2.5. Đã xem mép tóc, tay, áo trên nền sáng/tối và thử thanh chỉnh/lưu phiên trên giao diện.

Kiểm chứng mở rộng dùng FLUX Fill, 24 bước, mức 640 px và dải ngữ cảnh 64 px; các mốc cũ dùng SDXL 512 px nên không phải so sánh cùng model/thông số. Sau lượt GPU, bộ kiểm tra đường nối được cải tiến và chạy lại trên các giai đoạn ảnh đã lưu; không chạy lại model ở bước đối chiếu này. Bản kết quả đối chiếu ghi rõ nguồn gốc.

Bằng chứng và ảnh đối chiếu: `workspace/diagnostics/background-quality-2.6`. Kết quả đánh giá trực quan là đánh giá nội bộ của trợ lý, không phải phê duyệt của người dùng.

## Kết quả nghiệm thu sau đợt sửa

Bộ đang dùng có **11 đạt, 5 cần sửa, 0 chưa duyệt** (trước đó 8 đạt, 8 cần sửa). Năm ca cũ được đưa vào lưu trữ và thay bằng các kết quả đối chiếu mới; ảnh và lịch sử đánh giá cũ vẫn còn.

| Ca kiểm chứng | Kết quả |
| --- | --- |
| Xóa trên nền phẳng | Đạt; hết vệt sáng, khớp ảnh chuẩn tổng hợp |
| Xóa trên nền kẻ | Đạt; hết vùng nhòe, các đường kẻ nối liền |
| Xuất chủ thể trong suốt | Đạt nội bộ ở mức khử viền 100%; giữ alpha và màu bên trong |
| Mở rộng studio trái | Cần sửa; bỏ được bước gây kéo giãn, màu tốt hơn, vẫn có chi tiết giống chữ và chuyển chất liệu |
| Mở rộng trên chân dung | Cần sửa; vẫn thấy đường cắt ở tóc/trán dù nền tốt hơn |

Cả hai ca mở rộng giữ nguyên toàn bộ điểm ảnh nguồn. Chỉ số đường nối không thay thế quyết định xem ảnh; bản 2.6 không công bố đã giải quyết mọi lỗi mở rộng.

## Giới hạn và ưu tiên sau đợt này

Khử màu viền không sửa được mặt nạ thiếu tóc hoặc sai hình thể. Khớp nền đơn giản không phục dựng đồ vật bị che khuất hay hoa văn phối cảnh phức tạp. Kiểm tra đường nối không đánh giá được nội dung mới có hợp lý hay không.

Các ca hai người bắt tay, thử áo khi giơ tay và tạo ảnh hai người bị cắt bàn tay chưa được sửa trong đợt này. Ưu tiên tiếp theo là vùng tay và trang phục khi đổi tư thế, cùng kiểm tra bố cục trước khi tạo ảnh người.

Bản dự phòng nguồn: `workspace/backups/background-quality-2.6-20261024-075042`. Các ảnh và đánh giá 2.5 được giữ làm mốc đối chiếu.
