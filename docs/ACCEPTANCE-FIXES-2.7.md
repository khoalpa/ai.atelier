# AI Atelier 2.7 — Hoàn thiện các ca nghiệm thu

Đợt này xử lý năm ca còn lỗi của bộ nghiệm thu 2.6: bắt tay, thay áo khi giơ tay, tạo hai người, mở rộng nền studio và mở rộng trên chân dung. Các ảnh cũ và đánh giá cũ được giữ trong mục lưu trữ. Tiêu chí nghiệm thu và ngưỡng kiểm tra chất lượng không được nới lỏng.

Kết quả: **16/16 ca đạt nội bộ, 0 cần sửa, 0 chưa duyệt, 0 tệp thay đổi**. Cả năm ca cũ đã có ảnh thay thế được đối chiếu. Ca thay áo dùng AI kết hợp hoàn thiện thủ công; đây không phải xác nhận rằng bước thay áo tự động đã giải quyết hoàn toàn trường hợp này.

## Thay đổi trong ứng dụng

- **Tư thế & biểu cảm:** giữ phần thân áo khi vai và hông không di chuyển. Các vùng tay cũ, tay mới và tay người khác đi qua vẫn được phép tái tạo. Kế hoạch xem trước và vùng thực sự xử lý dùng cùng giới hạn này.
- **Tạo ảnh → Khung hình → Toàn thân, thấy rõ bàn tay:** thêm hướng dẫn bố cục vào mô tả thực gửi cho model. Mô tả người dùng được giữ riêng; phần kiểm tra trước khi tạo hiển thị cả nội dung bổ sung và giới hạn token. Tùy chọn này hướng dẫn model, không bảo đảm mọi phương án đều đúng bàn tay.
- **Mở rộng ảnh → Giữ nguyên ảnh gốc:** giữ ảnh nguồn cả trong ngữ cảnh sinh ảnh, tránh để model vẽ lại tóc rồi ghép ảnh cũ lên phần tóc mới. Dải khớp màu vẫn nằm phía ngoài ảnh gốc.
- **Mở rộng ảnh → Đồng bộ chất liệu nền hẹp từ ảnh gốc:** tùy chọn mặc định tắt, dành cho một cạnh mở rộng 16–128 px. Lấy màu và chi tiết nền từ một vùng nguồn độc lập; bỏ qua nếu vùng nguồn, vùng lấy mẫu hoặc phần thêm có chủ thể hay dữ liệu không chắc chắn. Bước này giữ bố cục AI, giữ nguyên điểm ảnh nguồn và vẫn chịu kiểm tra hồi quy. Cần đối chiếu trực quan hoa văn và phối cảnh.
- **Thay trang phục:** vùng được bộ phân tích nhận diện chắc chắn là vải không còn bị khóa nhầm chỉ vì có màu giống tóc hoặc da. Vùng lõi đầu và phần nhận diện không chắc chắn tiếp tục được giữ.
- **Duyệt:** chỉ số chất lượng được gắn với đúng tên ảnh đã chọn trong lượt thay áo, kể cả khi dữ liệu lưu tên tệp tương đối. Không dùng nhầm chỉ số của phương án được xếp hạng cao nhất.

## Bằng chứng và phạm vi

Bằng chứng nằm tại `workspace/diagnostics/acceptance-fixes-2.7`. Các tệp `*-run.json` ghi yêu cầu, model, seed, thời gian và thư mục ảnh từ dịch vụ thật. `*-reviewed.json` ghi tiêu chí và người đánh giá. `baseline-cases.json` giữ năm ca trước sửa.

| Ca | Kết quả được chọn | Cách xử lý |
| --- | --- | --- |
| Hai người bắt tay | `outputs/character/2973d1d58e1847a78718/result_seed_44.png` | Chạy lại AI, giữ mặt và thân áo đứng yên; xem riêng vùng tiếp xúc tay. Seed 45 bị loại. |
| Hai người, mặt và bốn tay | `outputs/chroma/chroma-20261024T025405775349Z-seed-439.png` | Chạy lại FLUX.2 Klein, khung toàn thân, làm rõ khoảng cách giữa hai người. Các bản che tay/lỗi cổ tay áo bị loại. Đạt yêu cầu gốc; không xác nhận yêu cầu bổ sung về lòng bàn tay ngang eo. |
| Studio mở rộng bên trái | `outputs/outpaint_20261024T025851841735Z/result_seed_43.png` | Bố cục FLUX Fill thật, sau đó khớp màu/chi tiết nền từ nguồn. Bước hoàn thiện không chạy sinh ảnh mới. Sai lệch vùng nguồn bằng 0. |
| Chân dung mở rộng phía trên | `outputs/outpaint_20261024T022416318565Z/result_seed_43.png` | FLUX Fill 28 bước, mức 768 px, giữ ngữ cảnh tóc. Sai lệch vùng nguồn bằng 0. Bộ đo vẫn cảnh báo dải màu rộng ở tóc/trán; đã xem trực tiếp trước khi duyệt nội bộ. |
| Thay áo khi giơ tay | `outputs/manual/b56d404f-9d28-4ba3-a676-682edbcce653/result.png` | IDM-VTON seed 221134 tạo áo, SDXL/FLUX sửa vùng nhỏ, ghép các vùng đã đối chiếu và sửa chuyển màu bằng công cụ thủ công. Xuất PNG qua hàng đợi thật. |

Ca studio có một bản khớp màu bị bộ kiểm tra loại vì thay đổi vượt ngưỡng. Bản sau giới hạn mức hiệu chỉnh trước khi kiểm tra, đạt `coarseChange=11.5229` dưới ngưỡng 18 hiện có. Không thay ngưỡng để cho qua ảnh.

Ca thay áo dùng quy trình nhiều bước. Các bản sửa cục bộ tạo thêm ngón tay, còn cổ áo đỏ hoặc lộ mảng màu đều bị loại. Phiên chỉnh thủ công lưu các lớp, vùng chọn và nét sửa; không thay thế ảnh nguồn hay xóa các lần thử.

Hai phiên thủ công là `8ee0e7b7-f9b2-4136-b6ae-8133ef804107` và `578bb942-6d83-4c10-b25a-9f326f072031`. Vùng bên trong khuôn mặt được đối chiếu với nguồn, sai lệch tối đa 1/255 sau xuất ảnh. Da cánh tay được tái tạo và chi tiết phụ kiện cổ tay thay đổi trong vùng sửa; không cam kết giữ từng phụ kiện hay họa tiết từng điểm ảnh. Chỉ số chất lượng của lượt IDM-VTON thuộc ảnh trung gian, không được dùng như chứng nhận tự động cho ảnh thủ công cuối.

## Kiểm tra

- 120/120 kiểm tra Node đạt, không bỏ qua kiểm tra nào.
- 14 bộ kiểm tra Python liên quan đạt: tạo ảnh, tư thế, hình học và bốn hướng mở rộng, chất liệu/nối nền, bảo vệ danh tính, hình học/chất lượng thay áo, biên vùng chọn, giới hạn mô tả và phiên bản dịch vụ.
- Giao diện đã xác nhận phần hướng dẫn toàn thân xuất hiện trong nội dung thực gửi vào model; tắt giữ ảnh gốc sẽ tắt tùy chọn đồng bộ nền hẹp.

Đánh giá ảnh ở đây là nghiệm thu nội bộ của trợ lý trên các ca đã chọn, không phải phê duyệt của người dùng hay bảo đảm chất lượng cho mọi ảnh. Bản dự phòng nguồn: `workspace/backups/acceptance-fixes-2.7-20261024-091743`.
