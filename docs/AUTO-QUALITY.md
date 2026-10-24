# Tự động cải thiện chất lượng

Vào **Cài đặt → Tự động cải thiện chất lượng**. Tính năng dùng chung cho Tạo ảnh mới, Xóa vật thể, Thay trang phục bằng ảnh hoặc mô tả và Mở rộng ảnh.

## Các chế độ

- **Tắt:** không ghi nhận thêm tác vụ hoặc lựa chọn tự động. Dữ liệu trước đó vẫn xem được.
- **Chỉ ghi nhận và đánh giá:** mặc định. Ghi nhận các tác vụ hoàn tất sau khi tính năng được cài đặt/bật, thông số thực chạy, kiểm tra sẵn có và phản hồi. Không tự xử lý lại ảnh cũ.
- **Tự động cải thiện:** thêm tối đa một lần thử hoàn thiện nhẹ mỗi tác vụ. Bản thử chỉ được công bố khi vượt kiểm tra pixel và còn ngân sách xử lý.

Web chạy một tiến trình CPU riêng để đọc các tác vụ đã hoàn tất, khoảng mỗi 3 giây. Đóng tab không dừng việc theo dõi nếu máy chủ web còn chạy. Khi web khởi động lại, các tác vụ hoàn tất trong lúc dịch vụ ngừng vẫn được đọc; công việc đang xử lý có thể được nhận lại sau khi quyền xử lý hết hạn. Nhiều cổng web dùng chung cơ sở dữ liệu và không xử lý trùng một tác vụ.

Tác vụ lỗi, bị hủy hoặc chỉ có phương án tạm chưa được ghi nhận như một tác vụ thành công. Nếu kiểm tra bổ sung lỗi, ảnh đã sinh vẫn được giữ và lỗi xuất hiện trong màn đánh giá. Bộ theo dõi thử lại tối đa 3 lần đối với lỗi đọc/xử lý.

## Phạm vi hoàn thiện của bản đầu

Bản này dùng bộ lọc tăng chi tiết nhẹ trên CPU. Không tải thêm model, không sinh lại ảnh, không sửa prompt và không thay thông số tạo ảnh đã chọn. Mỗi kênh RGB chỉ được thay tối đa 2/255; không đưa thêm điểm ảnh vào mức cháy sáng/đen tuyệt đối. Mặt nạ được co vào để tránh sửa biên ghép.

| Tác vụ | Vùng được phép sửa thêm |
|---|---|
| Tạo ảnh mới | Ảnh kết quả, với giới hạn thay đổi pixel |
| Xóa vật thể | Phần bên trong mask chỉnh sửa đã lưu, loại vùng bảo vệ |
| Thay trang phục | Mask chỉnh sửa đã lưu, loại vùng bảo vệ nhân vật |
| Mở rộng ảnh | Vùng sinh mới, loại toàn bộ hình chữ nhật chứa ảnh nguồn và vùng bảo vệ |

Thiếu mask, sai kích thước mask, kiểm tra hiện có không đạt, ảnh gần như phẳng, ảnh quá nhiều chi tiết, bố cục chưa hoàn thiện hoặc ảnh đã được tinh chỉnh trước đó: giữ bản ban đầu. Ảnh tự hoàn thiện tối đa 4.194.304 pixel. Ngân sách mặc định 8 giây, chọn từ 2–30 giây; nếu xử lý vượt thời hạn thì không công bố bản thử. Đây là giới hạn cho lượt hoàn thiện, không phải cam kết thời gian phản hồi của toàn bộ hệ thống.

Kiểm tra trước/sau gồm: pixel ngoài vùng sửa, mức thay đổi lớn nhất, tín hiệu chi tiết và tỷ lệ điểm ảnh bị cắt sáng/tối. Tín hiệu chi tiết phải tăng từ 0,3% đến 12%. Các giới hạn này cố định, không tự hạ theo phản hồi. Đây là kiểm tra kỹ thuật, chưa chứng minh đẹp hơn, đúng giải phẫu, đúng nội dung hoặc đúng họa tiết.

Các lỗi vật thể còn sót, sai trang phục hoặc hình thể được ghi nhận để người dùng xử lý bằng công cụ hiện có. Bản đầu chưa tự chạy thêm vòng inpainting, tối ưu thông số khuếch tán hoặc huấn luyện model.

## Đánh giá và dùng kết quả

Sau khi tác vụ hoàn tất, mở **Đánh giá & cải thiện chất lượng** bên cạnh kết quả. Có thể mở lại các kết quả gần đây từ Cài đặt.

1. Xem ảnh ban đầu và bản hoàn thiện nếu có; bấm ảnh để xem kích thước đầy đủ.
2. Chọn ảnh cần đánh giá, bấm **Hài lòng** hoặc **Cần sửa**, chọn lý do khi cần.
3. Khi có hai ảnh, ghi riêng bản ưu tiên hoặc **Tương đương**.
4. Tải ảnh đang chọn hoặc **Dùng để chỉnh sửa tiếp**. Ảnh ban đầu không bị ghi đè.

Lựa chọn phương án và thao tác chỉnh sửa tiếp là tín hiệu phụ. Chúng không tạo nhãn “Hài lòng”. Có thể sửa/xóa đánh giá; ảnh được kiểm tra SHA-256 trước khi lưu phản hồi để tránh học từ tệp đã thay đổi.

## Báo cáo hiệu quả

Trong **Cài đặt → Tự động cải thiện chất lượng → Báo cáo hiệu quả**, xem tổng số ảnh và tác vụ, số bản hoàn thiện vượt kiểm tra pixel, tỷ lệ ưu tiên bản mới và thời gian xử lý thêm. Bảng tách riêng bốn tác vụ; mở từng mục bên dưới để xem lý do giữ ảnh gốc, đánh giá hài lòng/cần sửa và lựa chọn trước–sau.

- Thống kê dùng toàn bộ bản ghi, không bị giới hạn bởi danh sách 60 ảnh gần đây. Một tác vụ có nhiều ảnh được tính một lần trong tổng tác vụ và từng ảnh trong tổng ảnh.
- Tỷ lệ ưu tiên chỉ dùng lựa chọn so sánh được lưu rõ ràng. Mẫu số gồm cả lựa chọn ảnh ban đầu và tương đương. Chưa có so sánh hiển thị “Chưa có so sánh”; thao tác chọn ảnh hoặc đánh giá hài lòng không tự tăng tỷ lệ này.
- Thời gian xử lý thêm là thời gian đọc/đánh giá/hoàn thiện một ảnh, không gồm chờ nền hoặc suy luận GPU. Hiển thị số ảnh có số đo; bản ghi cũ thiếu thời gian không được coi là 0. Thời gian riêng của bộ lọc được hiển thị trong phần chi tiết.
- Lý do giữ ảnh gốc được lưu bằng mã ổn định. Bản ghi cũ chỉ được phân loại khi bằng chứng đã lưu đủ rõ; những trường hợp còn mơ hồ được ghi “Bản ghi cũ chưa tách rõ nguyên nhân”.
- Bấm **Làm mới báo cáo** để đọc dữ liệu mới. Sửa/xóa phản hồi trong cửa sổ đánh giá tự cập nhật báo cáo đang mở, không đặt lại biểu mẫu cài đặt.

Báo cáo mô tả kết quả và phản hồi, không coi việc vượt kiểm tra pixel là bằng chứng ảnh đẹp hơn.

## Học và khôi phục cấu hình

Cấu hình học được chỉ điều chỉnh mức tăng chi tiết nhẹ (12%, 20% hoặc 28% của bộ lọc, vẫn bị chặn bởi giới hạn 2/255). Mỗi tác vụ chỉ thử một mức. Nhóm học được tách theo tác vụ, model, loại trang phục/vật thể hoặc kiểu khung, cùng thông tin phiên bản sẵn có trong metadata.

Ba nhóm nội dung đã đánh giá tốt và ưu tiên cùng một mức mới đủ tạo cấu hình ứng viên. Cấu hình được cố định để kiểm chứng trên các nhóm mới. Cần ít nhất 5 nhóm kiểm chứng, tất cả đều ưu tiên bản hoàn thiện và đánh giá tốt, không gắn nhãn lỗi; cận dưới Wilson 95% của tỷ lệ ưu tiên phải lớn hơn 0,5 trước khi kích hoạt.

Nhóm nội dung được nhận diện bằng hash ảnh nguồn; với ảnh mới, bằng mô tả được chuẩn hóa cơ bản. Đổi seed hoặc đổi tên tệp nguồn không tạo thêm bằng chứng độc lập. Các mô tả gần nghĩa chưa được gom bằng mô hình ngữ nghĩa, nên số nhóm này không thay thế một nghiên cứu thẩm mỹ có kiểm soát.

Phản hồi bị rút lại hoặc kết quả xấu hơn có thể làm cấu hình mất điều kiện và tự quay về mức mặc định. Nút **Khôi phục mặc định** trong Cài đặt thực hiện việc này ngay. Các phiên bản, bằng chứng và sự kiện vẫn được lưu. Cấu hình tiếp theo chỉ được học từ ảnh mới sau lần thu hồi; không kích hoạt lại cùng bằng chứng cũ.

## Lưu trữ và điểm tích hợp

- `quality_learning.py`: theo dõi, đánh giá, hoàn thiện có mask, quản lý phản hồi và điều kiện học.
- `quality_report.py`: tổng hợp toàn bộ lịch sử, thời gian, lý do giữ ảnh gốc và phản hồi hiện tại.
- `app/quality-service.js`: tiến trình CPU và giao tiếp với máy chủ web; tự khởi động lại nếu worker dừng.
- `app/public/quality-learning.js`, `quality-learning.css`: cài đặt, so sánh, phản hồi và khôi phục.
- `workspace/quality-learning/state.sqlite3`: cấu hình, kết quả, phản hồi, phiên bản và nhật ký. Các lần ghi dùng giao dịch; cài đặt có kiểm tra phiên bản để tránh ghi đè từ cửa sổ cũ.
- `workspace/outputs/quality-learning/<id>/`: bản hoàn thiện và metadata, tách khỏi ảnh ban đầu.

Các API POST nằm dưới `/api/quality-learning/`: `state`, `report`, `configure`, `feedback`, `selection`, `rollback`. `report` chỉ đọc, trả về thống kê toàn bộ lịch sử, bốn nhóm tác vụ và thời điểm tạo báo cáo. Dùng cùng kiểm tra yêu cầu cục bộ của máy chủ hiện có. Không nhận lệnh shell, đường dẫn ngoài thư mục kết quả hoặc thông số huấn luyện tùy ý.

Chỉ cần khởi động lại máy chủ web để nạp tính năng. Dịch vụ AI hiện có tiếp tục được dùng.

Có thể mở phiên web riêng bằng `powershell -File scripts/start-quality-upgrade.ps1`, mặc định ở `http://127.0.0.1:57860`, dùng dịch vụ AI đang có ở cổng 7861. Trình mở tái sử dụng phiên phù hợp và không dừng các dịch vụ khác.

## Kiểm chứng

```powershell
.venv-sam2/Scripts/python.exe tests/quality-learning.test.py
.venv-sam2/Scripts/python.exe tests/quality-report.test.py
node tests/quality-service.test.js
node tests/new-image-ui.test.js
node tests/generation-results.test.js
node tests/generation-progress.test.js
node tests/tryon-quality-feedback.test.js
node tests/outpaint-workflow.test.js
node tests/outpaint-ui.test.js
```

Kiểm thử dùng cơ sở dữ liệu và ảnh tạm, không đưa phản hồi giả vào dữ liệu học của người dùng. Bao phủ cả bốn tác vụ, bảo toàn nguồn/vùng bảo vệ, không vượt một lượt thử, bỏ qua hủy/lỗi, chống xử lý trùng, phục hồi worker, cập nhật cài đặt từ cửa sổ cũ, phản hồi ảnh bị sửa, tách dữ liệu chọn cấu hình/kiểm chứng và thu hồi khi rút phản hồi.

Ngày 22/10/2026: 10 bài kiểm thử Python và các kiểm thử giao tiếp, giao diện, kết quả/progress, try-on và outpaint nêu trên đạt. Chạy lại bước đánh giá/hoàn thiện trên bản sao bốn kết quả thật đã lưu: một ảnh mới vượt kiểm tra pixel (0,078 giây hoàn thiện), ba trường hợp còn lại giữ bản ban đầu theo điều kiện kiểm tra. Tất cả ảnh nguồn gốc giữ nguyên hash. Báo cáo ở `workspace/diagnostics/quality-learning-verified/verification.json`; đây là kiểm chứng bước hậu xử lý, chưa chứng minh chất lượng thẩm mỹ tăng. Giao diện đã được thử lưu đánh giá, ưu tiên trước–sau và xóa phản hồi trên cơ sở dữ liệu riêng.

Lượt thử FLUX.2 klein trước đó đã hủy tại điểm dừng an toàn; không tính lượt này vào bằng chứng thành công của tính năng.

Đợt kiểm chứng tiếp theo ngày 22/10/2026 đã chạy thực tế qua máy chủ web ở cổng 7860 và AI ở cổng 7861, mỗi tác vụ một ảnh:

| Tác vụ | Cấu hình thử | Thời gian yêu cầu | Bước cải thiện tự động |
|---|---|---:|---|
| Tạo ảnh mới | SD3.5 Medium, 256 × 256, 4 bước | 45,984 giây | Giữ ảnh ban đầu: chưa có chi tiết phù hợp |
| Xóa vật thể | SDXL Inpainting, mức xử lý 512, 8 bước | 50,562 giây | Có bản hoàn thiện vượt kiểm tra pixel |
| Thay trang phục | CatVTON, mức xử lý 512, 10 bước | 14,922 giây | Giữ ảnh ban đầu: kiểm tra tác vụ chưa đạt |
| Mở rộng ảnh | SDXL Inpainting, mức xử lý 512, 4 bước | 20,047 giây | Giữ ảnh ban đầu: chưa có chi tiết phù hợp |

Đây là thử luồng tích hợp với cấu hình nhỏ, không phải đánh giá thẩm mỹ hoặc tốc độ ở cấu hình sản xuất. Tất cả bốn kết quả được bộ theo dõi ghi nhận tự động. Hash ảnh kết quả ban đầu giữ nguyên; pixel ngoài mask của xóa vật thể/thay trang phục và toàn bộ ảnh nguồn trong khung mở rộng được giữ chính xác. Một lượt tạo ảnh riêng được yêu cầu hủy sau 2 giây, kết thúc ở trạng thái `cancelled` sau 10,515 giây và không xuất hiện trong dữ liệu học.

Báo cáo chứng cứ: `workspace/diagnostics/quality-report/verified-20261022-r2/workflow-verification.json` và `feedback-verification.json`. Các thử lưu/sửa/xóa đánh giá cho cả bốn tác vụ, cùng thử so sánh bản hoàn thiện, chạy trên bản sao có cơ sở dữ liệu riêng; phản hồi thử đã xóa, dữ liệu người dùng không nhận đánh giá giả. Giao diện được kiểm tra lưu phản hồi, cập nhật tỷ lệ ngay sau so sánh và trở về “Chưa có so sánh” sau khi xóa.

Hai lượt đầu hoàn tất trước khi nạp phần đo thời gian mới, nên báo cáo thật ghi “Chưa đo” cho chúng. Chạy lại bước hậu xử lý trên bản sao đo đủ 4/4 ảnh; các số này nằm trong báo cáo kiểm chứng riêng và không được ghi ngược vào lịch sử thật.

`scripts/verify-quality-live.py` chạy một yêu cầu GPU có hạn thời gian, kiểm tra trước để không xếp sau tác vụ đang chạy và gửi hủy an toàn khi hết thời gian. `--cancel-after 2` dùng cho kiểm chứng hủy. Script không dừng dịch vụ AI; nếu còn trạng thái `cancelling`, cần chờ điểm dừng an toàn trước lượt khác. `scripts/verify-quality-workflows.py --output <thư mục mới>` kiểm tra kết quả thật rồi chuẩn bị bản sao. Đặt `QUALITY_FIXTURE_ROOT` tới thư mục `fixture` vừa tạo để chạy `node tests/quality-workflows.test.js`; kiểm thử tự chọn cổng trống và chỉ gửi phản hồi khi đã xác nhận máy chủ riêng khởi động thành công.
