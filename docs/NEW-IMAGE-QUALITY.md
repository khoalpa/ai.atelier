# Ảnh mới: tạo bố cục và hoàn thiện

Chức năng tạo ảnh cục bộ có ba mức Nhanh, Cân bằng và Chi tiết. Mặc định dùng Cân bằng, hai phương án và seed ngẫu nhiên cho mỗi lượt. Chọn seed tùy chỉnh khi cần tái lập một kết quả. Các lựa chọn seed đã lưu của người dùng được giữ lại.

## Mô tả và giới hạn

Mô tả chính và Điều cần tránh được giữ nguyên, không cắt theo số ký tự. Ô Điều cần tránh trống có nghĩa là không thêm negative prompt. FLUX.2 klein không hỗ trợ trường này; giao diện vô hiệu hóa trường và phần kiểm tra thông báo nếu yêu cầu API vẫn chứa nội dung.

**Kiểm tra trước khi tạo** đọc tokenizer cục bộ và hiển thị số token cùng văn bản thực gửi vào từng bộ mã hóa. Bước này không nạp trọng số sinh ảnh. Yêu cầu vượt giới hạn bị chặn trước khi nạp model. API giới hạn mỗi trường văn bản ở 16.000 ký tự để kiểm soát kích thước yêu cầu, với thông báo lỗi rõ ràng.

SD3.5 dùng hai bộ CLIP tối đa 77 token và T5 tối đa 256 token. Khi mô tả dài, mở **Mô tả ngắn cho CLIP khi nội dung dài**, tự nhập hoặc dùng gợi ý AI rồi xem trước bản nháp. Mô tả đầy đủ vẫn đi vào T5. Bản ngắn cho điều cần tránh là trường riêng. Khi để trống bản ngắn, hệ thống dùng nội dung đầy đủ và kiểm tra giới hạn; không tự rút gọn.

Chroma dùng T5 tối đa 512 token. Klein kiểm tra cả phần bao văn bản theo mẫu hội thoại trong giới hạn 512 token. Trợ lý viết mô tả nhận thông tin model, giới hạn và việc có hỗ trợ negative prompt hay không. Gợi ý vẫn cần được người dùng xem và áp dụng qua hộp thoại hiện có.

## Chất lượng và kích thước

| Model | Nhanh / Cân bằng / Chi tiết | Mức bám mô tả |
|---|---|---|
| FLUX.2 klein 4B | 4 / 4 / 4 bước | 1 |
| SD3.5 Medium | 16 / 28 / 40 bước | 4,5 |
| Chroma1-HD | 12 / 28 / 40 bước | 3 |
| SDXL | 16 / 28 / 40 bước | 5 |

Các mức có ngân sách pixel tương đương khung vuông 512, 768 và 1024 px. Tỷ lệ gồm 1:1, 4:5, 2:3, 3:2, 16:9 và 9:16. Khung được làm tròn theo kích thước model hỗ trợ; giao diện ghi số pixel đầu ra thực tế. API nhận thêm `width` và `height` là bội số 16, mỗi chiều 256–1536, tổng tối đa 1.200.000 pixel. Kích thước vượt giới hạn bị từ chối, không tự hạ xuống 768.

Thông số riêng của model được lưu ở `runtimePresets.textToImage.profiles` trong `workspace/prompts.json`. Chỉnh tham số thủ công chuyển sang Tùy chỉnh. SD3.5 có tùy chọn **Hỗ trợ cấu trúc cơ thể**, dùng Skip Layer Guidance và mặc định tắt để người dùng đối chiếu trước khi áp dụng.

SD3.5 Medium nạp BF16 và chuyển model qua CPU khi cần; VAE hỗ trợ chia nhỏ ảnh. Chroma trên GPU dưới 24 GB chuyển transformer theo nhóm hai block và bộ đọc văn bản theo lớp, tránh đưa toàn bộ transformer vào GPU 16 GB. Đổi lại, Chroma có thể cần nhiều phút cho một ảnh. Thiếu bộ nhớ báo lỗi để người dùng chọn lại thiết lập, không âm thầm giảm độ phân giải.

## Chọn và hoàn thiện

Sau khi tạo, bấm **Chọn phương án**:

- **Phóng lớn 2×**: nội suy Lanczos và tăng nét nhẹ, giữ bố cục từ ảnh đã chọn. Đây không phải sinh chi tiết bằng AI. Giới hạn đầu ra là 5 triệu pixel.
- **Tinh chỉnh AI nhẹ**: hiện với SD3.5 và SDXL. Pipeline img2img nhận chính ảnh đã chọn, strength 0,2, 40 bước cấu hình và khoảng 8 bước khử nhiễu thực tế. Đầu ra khoảng 1 megapixel. Có thể thay đổi chi tiết; luôn xem so sánh trước/sau. Chroma và Klein dùng phóng lớn hoặc chuyển ảnh sang Studio.
- **Chỉnh sửa tiếp**: đưa ảnh đã chọn vào Studio để dùng Xóa vật thể, Thay trang phục hoặc Mở rộng ảnh. Luồng mở ở mục vật thể Tùy chỉnh, yêu cầu trống và phục hồi nền để người dùng tự chọn tác vụ. Chưa có công cụ chuyên dụng sửa mặt/tay tự động; không coi Xóa vật thể là công cụ phục hồi giải phẫu.

Ảnh gốc và các phương án còn lại được giữ. Mỗi lần hoàn thiện tạo tệp mới, lưu quan hệ với ảnh cha và kiểm tra SHA-256 trước khi đọc nguồn. Không chấp nhận đường dẫn tùy ý hoặc ảnh đã bị thay đổi. Có thể mở lại kết quả, kể cả phương án hoàn tất trước khi hủy, trong Hoạt động. Bấm ảnh để xem kích thước đầy đủ.

## Thời gian và dữ liệu

Kết quả hiển thị tổng thời gian tác vụ, thời gian nạp model và thời gian xử lý. Không so thời gian tổng của lần nạp đầu với lần model đã nằm trong bộ nhớ để kết luận cấu hình nào nhanh hơn.

Mỗi PNG có JSON bên cạnh trong `workspace/outputs/chroma/`, gồm mô tả đầy đủ, tham số, seed, nguồn hoàn thiện, lịch sử prompt và SHA-256 của ảnh. Metadata mới còn lưu phiên bản thư viện, phiên bản mã nguồn và hash cấu hình model/scheduler; các hash này không thay thế checksum trọng số. Báo cáo từng lượt nằm trong `workspace/review/chroma-generate-*.json`.

## Kiểm chứng

Kiểm thử chính:

```powershell
.venv-sam2/Scripts/python.exe tests/new-image.test.py
node tests/new-image-ui.test.js
node tests/text-quality.test.js
node tests/generation-progress.test.js
node tests/generation-results.test.js
node tests/server.test.js
```

Bộ ảnh đối chiếu có sáu nhóm: sản phẩm, chân dung, toàn thân, hai người, vải có họa tiết và bố cục rộng. Mỗi cặp giữ nguyên prompt và seed, so thông số cũ với thông số mới. Đổi độ phân giải có thể đổi bố cục ngay cả với cùng seed. Tệp JSON ghi rõ cấu hình; không dùng điểm tự động làm bằng chứng về thẩm mỹ hay giải phẫu.

```powershell
.venv-sam2/Scripts/python.exe scripts/benchmark-new-image.py --limit 1
.venv-sam2/Scripts/python.exe scripts/benchmark-new-image.py --limit 6 --seeds 433 434 435
```

Lượt đầu mặc định tạo một cặp trên mỗi model đã có. Lệnh thứ hai là bộ đối chiếu mở rộng, có thể chạy lâu trên GPU 16 GB. Lượt đã thành công được tái sử dụng. `--models`, `--profiles` và `--output` giúp chọn phạm vi. Mỗi yêu cầu chạy lại dùng mã tác vụ mới để không kế thừa trạng thái hủy cũ.

Trang `workspace/diagnostics/new-image-quality/index.html` giấu tên model/cấu hình khi chấm, cho điểm 1–5 về đúng yêu cầu, hình thể, chất liệu, bố cục và ít lỗi. Người duyệt để trống tiêu chí không áp dụng, xuất điểm rồi mới xem `blind-key.json`. Kết quả trên một seed không đủ chứng minh model nào luôn tốt hơn.

## Chạy bản nâng cấp

Mã nguồn được tích hợp vào ứng dụng chính. Dịch vụ đang chạy cần khởi động lại để nạp mã mới. Có thể mở phiên riêng bằng `scripts/start-new-image-upgrade.ps1`, mặc định tại `http://127.0.0.1:47860`. Trình mở tái sử dụng phiên phù hợp và không tự dừng phiên khác.

Bản sao các tệp chính trước thay đổi được lưu trong `workspace/backups/new-image-quality-20261022-142910/`.


## Kết quả kiểm chứng trên máy này — 22/10/2026

GPU NVIDIA RTX A4500 Laptop 16 GB. Đã tạo 11 ảnh đối chiếu: cặp thông số cũ/mới cho sản phẩm trên Klein, SD3.5 Medium và Chroma; thêm năm nhóm còn lại trên Klein. Các tệp kết quả và trang chấm ẩn tên model ở `workspace/diagnostics/new-image-quality/`. Đây là kiểm chứng vận hành và xem ảnh trên một seed, chưa phải đánh giá chất lượng thống kê.

| Trường hợp | Tổng | Nạp model | Xử lý |
|---|---:|---:|---:|
| Klein · sản phẩm 768 | 29,57 s | 3,50 s | 26,06 s |
| Klein · sản phẩm 1024 | 11,02 s | 0 s | 11,02 s |
| SD3.5 · sản phẩm 768 / 35 bước | 37,23 s | 9,75 s | 27,48 s |
| SD3.5 · sản phẩm 1024 / 40 bước | 39,93 s | 0 s | 39,92 s |
| Chroma · sản phẩm 768 / 28 bước | 429,34 s | 3,37 s | 425,97 s |
| Chroma · sản phẩm 1024 / 40 bước | 819,52 s | 8,61 s | 810,91 s |

Thời gian xử lý gồm khởi tạo ở lượt đầu, khử nhiễu, giải mã và lưu ảnh; tổng còn gồm kiểm tra đầu vào. Chuyển model, cache và trạng thái máy ảnh hưởng số đo. Không dùng bảng này để kết luận tăng độ phân giải làm Klein nhanh hơn.

Quan sát trực tiếp:

- Klein tạo được khung dọc toàn thân và bố cục rộng có khoảng trống bên phải. Mẫu hai người đúng vị trí/màu áo nhưng cắt mất tay dù prompt yêu cầu nhìn thấy tay; vẫn cần duyệt nội dung ảnh.
- Ở prompt sản phẩm, SD3.5 1024 và Chroma 1024 cho khung cận hơn yêu cầu “toàn bộ trang phục”. Vì vậy Chi tiết là một lựa chọn thông số, không phải cam kết mọi ảnh đều tốt hơn. Mặc định Cân bằng giúp chọn bố cục trước.
- Tinh chỉnh img2img từ ảnh SD3.5 768 tạo bản 1024 trong 52,18 s tổng, giữ bố cục áo trong mẫu kiểm chứng. Nút áo, đường vải và các chi tiết nhỏ vẫn có thể đổi. SHA-256 xác nhận tệp nguồn nguyên vẹn.
- Phóng lớn từ bản 1024 tạo tệp 2048 trong 1,99 s. Kiểm tra kích thước, hash ảnh nguồn, khôi phục so sánh từ Hoạt động và chuyển ảnh sang Studio đều đạt. Phóng lớn này không tạo chi tiết AI.

Ảnh tổng hợp: `klein-six-cases.jpg`, `refinement-comparison.jpg`. Số đo máy đọc được: `measurements.json`; bằng chứng nguồn hoàn thiện: `finishing-validation.json`. SDXL chưa có trọng số trên máy nên chưa được thử sinh ảnh thật.

Ứng dụng chính tại `http://127.0.0.1:7860` đã được khởi động lại với bản nâng cấp. Lượt kiểm tra trực tiếp sau khởi động tạo hai ảnh 448 × 576, seed ngẫu nhiên liên tiếp, Điều cần tránh trống và SLG bật; cả hai hoàn tất. Metadata khớp phiên bản dịch vụ đang chạy. Kiểm tra Chỉnh sửa tiếp xác nhận ảnh nguồn đã tải, vật thể Tùy chỉnh, phục hồi nền và ô yêu cầu trống.
