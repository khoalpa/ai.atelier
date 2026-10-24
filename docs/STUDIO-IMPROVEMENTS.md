# Cải tiến luồng Studio

- Bốn bước có thể dùng bàn phím; bước cuối bao gồm tạo và so sánh. Model được đưa vào chế độ Chuyên gia; chế độ Đơn giản tiếp tục dùng model được ứng dụng chọn.
- Hướng dẫn ảnh tham chiếu nằm cạnh ô chọn ảnh, phân biệt ảnh nên dùng và ảnh cần thay; có lối vào thiết lập kiểm định. Studio dùng ảnh vừa chọn; benchmark giữ nguyên cổng kiểm định hiện có.
- Nút **Xem trước vùng xử lý** hiển thị ảnh với mask sửa và bảo vệ, tỷ lệ diện tích được sửa và cảnh báo mask thiếu. Khi tự tạo mask hoặc tái tạo cơ thể được bật, bản xem trước nói rõ vùng thực tế còn được tính lại trong pipeline; không giả định đã biết phần cơ thể bị che.
- **Lịch sử chỉnh sửa** lưu quan hệ nguồn → kết quả đã chọn → ảnh nguồn mới vào `workspace/edit-history.json`, ghi tệp nguyên tử. Có thể mở một phiên bản cũ để tạo nhánh. Chỉ những lần chỉnh sửa tiếp sau nâng cấp mới có quan hệ lịch sử; không suy đoán quan hệ từ tên ảnh cũ.
- Khi duyệt, nhãn lỗi hiện gợi ý kiểm tra biên, màu, hoa văn, hình thể, cổ, tay áo và eo ngay cạnh quyết định. Nhãn sai màu được lưu và chọn cấu hình ưu tiên độ giống reference. Hành động Chạy lại lưu nhãn để bộ lập kế hoạch chọn cấu hình và giữ cặp cũ–mới.
- Tiến độ ưu tiên số bước đo được; khi chưa có ước tính đó, dùng trung vị ít nhất ba lượt thành công cùng tác vụ, model, kích thước và số bước trên trình duyệt này. Lưu tối đa 100 mẫu; chưa đủ dữ liệu thì tiếp tục hiển thị đang tính. Lỗi bộ nhớ, model và kết nối có hướng khắc phục.

Kiểm tra: `node tests/studio-guidance.test.js` cùng các bài kiểm thử Studio, continuation, reference, progress và result hiện có. Những kiểm tra này xác nhận hành vi giao diện và lưu trữ; không chứng nhận chất lượng ảnh sinh hoặc thay thế duyệt trực quan.

Kiểm tra rộng `tests/server.test.js` ngày 17/10/2026 dừng tại yêu cầu dữ liệu có sẵn `workspace/review/reference-profiles.json` vì tệp này không tồn tại. Không tạo profile giả hoặc thay đổi dữ liệu nghiệm thu để vượt kiểm tra.
