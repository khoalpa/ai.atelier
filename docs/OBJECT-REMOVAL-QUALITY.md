# Kiểm chứng chất lượng xóa vật thể

Luồng phục hồi nền dùng `object_removal.py`. Các thay đổi tập trung vào việc xóa vật thể thông thường và giữ nguyên phần ảnh ngoài vùng được phép chỉnh sửa.

## Xử lý ảnh

- Chuẩn hóa chiều EXIF trước khi chọn và xử lý vật thể.
- Chuyển hộp nhận diện YOLO-World qua SAM; không âm thầm thay mask phân đoạn lỗi bằng hình chữ nhật.
- Trừ vùng bảo vệ trước khi mở rộng mask. Mask tạo ảnh lấy thêm ngữ cảnh; mask ghép quyết định chính xác pixel nào được phép thay đổi.
- Nhóm các crop có phần ngữ cảnh chồng nhau, xử lý tối đa 8 nhóm; nếu vượt giới hạn thì dùng một crop bao tất cả vùng chọn.
- Crop từ ảnh gốc, giữ tỷ lệ, thêm đệm đến bội số 64; khôi phục về đúng tọa độ nguồn sau khi sinh ảnh. Mask thu nhỏ giữ các vùng mảnh.
- Làm sạch phần ảnh trong mask bằng phép lấp cục bộ trước khi đưa vào model để giảm việc tái sinh màu và hình dạng của vật thể cũ. Đây chỉ là khởi tạo đầu vào; model vẫn tạo nội dung cuối.
- Thay hoàn toàn lõi vật thể, hòa trộn ra ngoài và khôi phục nguyên pixel vùng bảo vệ. Không dùng tăng nét hoặc kiểm tra đường may mặc định cho phục hồi nền.

## Thông số và đánh giá

Giá trị người dùng nhập ưu tiên hơn profile. Guidance cho FLUX là 1–50; các họ còn lại 1–12. Steps là 4–60; quy tắc số bước khử nhiễu hiệu dụng vẫn được áp dụng và ghi lại trong metadata. Giao diện cập nhật đúng giới hạn theo model và giữ giá trị sửa tay khi làm mới danh sách.

Chênh lệch pixel chỉ phát hiện ảnh gần như không đổi. Trạng thái kiểm tra phân biệt: chưa xác minh, còn phát hiện vật thể, không còn phát hiện vật thể, ảnh gần như không đổi và lỗi bảo toàn vùng ngoài mask. Bộ nhận diện phải có bằng chứng ở ảnh gốc trước khi xác nhận vật thể biến mất. Điểm biên chỉ dùng xếp hạng giữa các ứng viên cùng mức kiểm chứng; không chứng minh nền tự nhiên.

Lượt thử lại giữ nguyên prompt đã xác nhận và thông số thực chạy, đổi seed. Trường hợp chưa xác minh do thiếu nhận diện không tự tiêu tốn lượt thử lại. Hủy tác vụ được kiểm tra trong từng crop và từng bước sinh ảnh. Model đã chọn được giữ nguyên.

## Bộ thử có nền chuẩn

`scripts/benchmark-object-removal.py` tạo 40 ca tổng hợp: 5 nhóm nền × 8 tình huống. Mỗi ca có ảnh đầu vào, mask và nền sạch. Các tình huống gồm vật thể nhỏ, sát mép, dây mảnh, bóng đổ, ít tương phản, nhiều vùng và ảnh độ phân giải cao. Đây là bộ kiểm tra kỹ thuật, không phải benchmark ảnh chụp thực tế.

```powershell
.\.venv-sam2\Scripts\python.exe scripts/benchmark-object-removal.py --prepare-only
.\.venv-sam2\Scripts\python.exe scripts/benchmark-object-removal.py --model sdxl-inpaint-base-0.1
.\.venv-sam2\Scripts\python.exe scripts/benchmark-object-removal.py --model flux-1-fill-dev --limit 8
.\.venv-sam2\Scripts\python.exe scripts/report-object-removal.py
```

`--limit` chọn mẫu trải đều trong 40 ca. Mặc định chạy 24 bước, độ phân giải AI 512; dùng `--steps 40 --resolution 1024 --output workspace/diagnostics/object-removal-high-resolution` để đo cấu hình cao hơn. `--guidance` hỗ trợ thử nghiệm thông số riêng; dùng một thư mục `--output` riêng cho mỗi cấu hình. Báo cáo đã có được bỏ qua; `--force` chạy lại và ghi đè báo cáo của ca đó.

Không coi số ca giảm MAE là tỷ lệ xóa thành công. Khi so sánh model, chỉ dùng các ca cả hai đã chạy và cùng ảnh, mask, seed, độ phân giải, số bước. Giá trị strength và guidance theo từng họ model được ghi rõ. Thời gian bao gồm xử lý, lưu tệp và lần nạp model nếu có; số liệu 512 px không dự báo trực tiếp thời gian 1024 px.

Tiêu chí kiểm chứng kỹ thuật: không thay đổi pixel ngoài vùng ghép; không rò qua vùng bảo vệ; không đưa màu vật thể cũ trở lại khi model đã cung cấp nền sạch; xử lý đúng vật thể mảnh, nhiều vùng, hủy và retry; không tự xác nhận thành công khi thiếu dữ liệu. Đánh giá ảnh thực tế vẫn cần xem độ tự nhiên của nền, đường thẳng, hoa văn và bóng đổ.

## Tệp kết quả

- `workspace/diagnostics/object-removal-tests.json`: kết quả các bài kiểm thử.
- `workspace/diagnostics/object-removal-benchmark/summary.json`: thống kê các ca đã chạy.
- `workspace/diagnostics/object-removal-benchmark/report.html`: ảnh đầu vào, vùng chọn, kết quả từng model và nền chuẩn.
- `workspace/backups/object-removal-20261022`: bản sao các tệp hiện có trước đợt sửa.

## Kết quả kiểm chứng ngày 22/10/2026

33/33 bài kiểm thử đạt. Đã chạy thật trên GPU: 40 ca SDXL và 8 ca FLUX trải đều trong bộ mẫu; cả 48 đầu ra giữ nguyên pixel ngoài vùng ghép. Có 37/40 ca SDXL và 7/8 ca FLUX giảm sai lệch với nền chuẩn. Đây không phải tỷ lệ xóa thành công: một số ảnh vẫn có vệt màu hoặc chi tiết thừa. Trong 8 ca chung, FLUX có MAE thấp hơn ở 5 ca, SDXL ở 3 ca.

Kiểm tra dịch vụ thực ở 1024 px, 40 bước được lưu tại `workspace/diagnostics/object-removal-live-smoke.json`. Chạy lại bằng `scripts/smoke-object-removal.py`; script yêu cầu dịch vụ đã nạp đúng bản mã hiện tại. Hai biến môi trường `AI_IMAGE_PORT` và `AI_SEGMENT_PORT` chọn cổng máy chủ web và AI, mặc định 7860/7861.

Bản mới đang phục vụ ở `http://127.0.0.1:17860`, dùng dịch vụ AI ở cổng 17861. Việc dừng dịch vụ cũ để khởi động lại đã bị cơ chế phê duyệt tự động chặn (`blocked by policy`), nên phiên 7860/7861 được giữ nguyên. Sau khi người dùng tự khởi động lại phiên gốc, mã mới trên ổ đĩa sẽ được nạp ở cổng gốc.
