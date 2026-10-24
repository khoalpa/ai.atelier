# Lưu trữ mốc 2.3 — không phải trạng thái hiện tại

# Công việc để hoàn thành dự án

## Trạng thái hiện tại

- SD3.5 Large và pipeline inpainting đã chạy offline.
- LoRA `sd35-large-photorealistic` đã được chuyển từ Kohya sang Diffusers/PEFT, nạp thành công và chạy A/B cùng seed.
- A/B LoRA đạt kiểm tra kỹ thuật nhưng chưa đủ chất lượng baseline do mask hình chữ nhật và lỗi hòa biên.
- Registry model, registry LoRA, checksum, giao diện quản lý, review matrix và đóng gói cơ bản đã có.
- Mask theo thân người, vùng bảo vệ đầu/tóc/tay và trình chạy ma trận LoRA 5 × 3 đã có; còn phải chạy và duyệt bộ ma trận chính thức.
- Smoke test mask 5 ảnh và một hàng ma trận SD3.5 đã chạy thành công về kỹ thuật; chất lượng còn lỗi blur, chuyển tiếp dọc và cấu trúc áo kép nên chưa được duyệt.
- Chính sách coverage tối thiểu, strength thích ứng và ma trận hiệu chỉnh 3 × 3 đã có; cần chọn strength thắng cuộc bằng duyệt trực quan.
- Hàng hiệu chỉnh `c002` xác nhận `strength=0.50` tốt hơn `0.60/0.70` và loại được lỗi áo kép; còn blur và vệt tối biên trái nên chưa đủ điều kiện baseline.
- Hòa biên cục bộ thích ứng đã được tích hợp vào inpainting; cần xác nhận bằng A/B sau xử lý trên `c001–c003`.
- A/B `c002` sau hòa biên giảm outside-mask MAE hơn 99% và loại phần lớn đường cắt cứng; lõi thân áo vẫn mờ, cần khôi phục texture trước khi chạy ma trận đầy đủ.
- FLUX Chroma1-HD đã được tải, xác minh SHA-256 và có backend suy luận ngoại tuyến biệt lập; trạng thái phát hành phụ thuộc smoke test 512 px có báo cáo.
- Khôi phục texture tần số cao có giới hạn đã được tích hợp và chạy A/B `c001–c003`: detail gain `1,34–1,80`, ngoài mask gần như bất biến. Kết quả chỉ tăng nét nhẹ; `c002` còn vệt dọc/khuy giả nên chưa thể khóa baseline.
- Bộ phát hiện và tái sinh cục bộ lỗi cấu trúc lõi đã được triển khai và A/B. Detector sửa đúng vùng `c002` nhưng chỉ làm mềm một phần vệt; tính năng tiếp tục tắt mặc định. Nguyên nhân chính là preset thử nhanh chỉ có khoảng 2 bước khử nhiễu hiệu dụng.
- Chính sách bước hiệu dụng đã được tích hợp và xác nhận đúng 12 bước trên `c002`. Ảnh có nhiều cấu trúc hơn nhưng đường chia thân áo rõ hơn do mask chỉ phủ phần giữa; chưa chạy 16/20 và chưa khóa preset.
- Pose-union và cổng garment completeness đã được tích hợp, đạt `84–87%` trên `c001–c003`; mask liền khối và ngoài mask được bảo toàn. Kết quả 12 bước vẫn bám prompt kém, cho thấy cần chuyển lượt thay đồ chính sang CatVTON có ảnh tham chiếu.
- Endpoint so sánh CatVTON, SD3.5 và hybrid đã được triển khai. Smoke `c001` cho thấy CatVTON nhanh nhưng lỗi thắt lưng; hybrid chậm hơn nhiều, không cải thiện similarity và vẫn lỗi. Chưa chạy `c002–c003` cho đến khi có reference trang phục sạch.
- Pipeline chuẩn hóa reference và ma trận CatVTON thuần Sprint 4Y đã chạy đủ `c001–c003`. Cutout đạt cổng kỹ thuật và ma trận dùng khoảng `2,54 GB` VRAM, nhưng cả ba ảnh còn lỗi cấu trúc/eo rõ; không khóa preset và đánh dấu reference `experimental-rejected`.
- Mask CatVTON pose-first chuyên biệt Sprint 4Z đã chạy đủ `c001–c003`: rò cạp quần và chồng lấn vùng bảo vệ đều bằng `0`, seam/anatomy tăng rõ so với Sprint 4Y. `c001` đạt cải thiện trực quan tốt; `c002` còn mảng nhòe nội vùng và `c003` còn viền vai/tay, nên chưa khóa preset.
- Selective retry Sprint 5A đã được triển khai để thử `3 seed × 10/20 steps` chỉ trên ca lỗi, có thêm điểm texture lõi và bất cân xứng trái/phải mà các chỉ số biên trước đây bỏ sót.
- Selective retry Sprint 5A đã chạy đủ 12 lượt. `c002` chỉ cải thiện một phần; `c003` regression với mảng nâu ở tay áo dù điểm tự động cao hơn. Không thay baseline Sprint 4Z và dừng tối ưu seed/steps cho reference hiện tại.
- Cổng nhập reference Sprint 5B đã được triển khai: kiểm tra người/pose, nền, coverage, mép, độ nét, bảng màu và SHA-256 trước khi lưu. Resolver chỉ dùng reference sản phẩm đã được xác nhận; hiện chưa có ảnh sản phẩm đạt cổng để kích hoạt.
- Kiểm thử cổng reference đã đạt cả hai chiều: ảnh người mẫu `c003` bị từ chối, fixture sản phẩm nền trắng được chấp nhận; không profile hiện tại nào bị thay đổi trong lúc kiểm thử.
- Cổng nhất quán màu/chất liệu Sprint 5C đã được tích hợp vào selective retry và có audit ngoại tuyến cho báo cáo Sprint 5A; candidate không đạt không được phép promotion dù điểm seam/texture khác cao.
- Audit Sprint 5C loại đúng regression nâu `c003` của Sprint 5A (`colorOutlierRatio=0,249`). Candidate thay thế sạch màu hơn nhưng `c002–c003` vẫn chưa đạt trực quan; baseline không thay đổi.
- Cổng hình học nội vùng Sprint 5D đã được tích hợp, kết hợp bắt mảng phẳng, bất cân xứng cạnh, vệt dọc và biên yếu với cổng màu Sprint 5C; cần audit 12 candidate để hiệu chỉnh ngưỡng trước reference sản phẩm thật.
- Audit Sprint 5D loại toàn bộ `c002` do bất cân xứng hình học; `c003` còn candidate đủ điều kiện xem xét nhưng chưa được promotion. So với Sprint 5C, số nhóm đủ điều kiện giảm từ 2 xuống 1 và không baseline nào bị thay đổi.
- Reference readiness và benchmark preflight Sprint 5E đã được triển khai ở cả UI và máy chủ: kiểm tra validation, tồn tại tệp, checksum và trạng thái kích hoạt; benchmark bị chặn trước GPU nếu reference của loại đang chọn chưa sẵn sàng.
- Smoke qualification Sprint 5F đã được triển khai: mỗi reference phải vượt qua ba ca chuẩn và đồng thời đạt cổng mask, similarity, màu/chất liệu, hình học, đường may và giải phẫu trước khi được mở benchmark.
- Chroma Sprint 5G đã tải đủ dependency và smoke thực tế đạt ở 512 px/8 bước; ảnh, checksum, thời gian và peak allocation được lưu trong báo cáo phát hành.
- Gói mã nguồn ngoại tuyến 2.2.0 đã qua checksum 522 tệp, clean-install, update và rollback; cấu hình SD3.5/Chroma cùng dữ liệu `workspace` được bảo toàn.
- Gói tự chứa model 2.2.0 đã được tạo với khoảng 70,24 GiB model, xác minh checksum và clean-install thành công trên 697 tệp; thư mục thử tạm đã được dọn sau kiểm tra.
- Chuỗi bằng chứng Sprint 5H đã khóa checksum từ kiểm định → qualification → benchmark → release. Ba benchmark cũ vẫn đạt ngưỡng số học nhưng không có provenance và không còn được tính là technical pass cho bản 2.3.0.
- Gói mã nguồn 2.3.0 đã qua checksum và clean-install trên 524 tệp; model bundle 2.2.0 đã xác minh vẫn là nguồn model ngoại tuyến hiện có, chưa nhân đôi thêm khoảng 70,24 GiB cho 2.3.0.

## Chênh lệch so với bước liền trước

- Trước bước này Chroma chỉ có checkpoint transformer; hiện đã đủ dependency, loader, UI, API và smoke thực tế đạt.
- Reference readiness trước đây chỉ kiểm tra tệp/checksum; hiện thêm smoke qualification ba ca và chặn benchmark nếu chất lượng không đạt.
- Gói 2.1.0 chưa kiểm kê Chroma và sao chép model bundle sai cấu trúc; gói 2.2.0 đã sửa cấu trúc và vượt kiểm thử vòng đời.
- Nghiệm thu trước đây tin cờ trạng thái profile và benchmark cũ; hiện xác minh nội dung báo cáo qualification, checksum reference và provenance của từng benchmark.
- Benchmark trước đây cho phép ảnh trong request ghi đè reference đã qualification; hiện máy chủ luôn nạp reference đã khóa từ đĩa.
- Mức hoàn thành dữ liệu không đổi: `0/69` ảnh được người dùng chấp nhận và `0/3` reference sản phẩm đạt qualification.

## 1. Hoàn tất dữ liệu nghiệm thu

- Duyệt đủ 69 trường hợp: 23 ảnh cho mỗi loại `upper_body`, `lower_body`, `overall`.
- Mỗi ảnh lỗi phải có trạng thái `retry` hoặc `rejected` và nhãn lỗi phù hợp.
- Chạy lại các ảnh `retry`, so sánh cũ–mới và duyệt lại.
- Kết quả cuối cùng cần 23/23 ảnh được người dùng chấp nhận trong từng loại.

## 2. Hoàn tất ảnh tham chiếu

- Giữ hoặc thay ảnh tham chiếu `upper_body` hiện tại.
- Cung cấp và lưu ảnh chuyên biệt cho `lower_body`.
- Cung cấp và lưu ảnh chuyên biệt cho `overall`.
- Chạy lại benchmark tương ứng nếu ảnh tham chiếu thay đổi đáng kể.

## 3. Khóa cấu hình chất lượng

- Có tối thiểu 5 ảnh đã duyệt và 3 ảnh có nhãn lỗi.
- Chạy hiệu chỉnh trọng số.
- Chạy so sánh A/B trên chính bộ đã duyệt.
- Chỉ kích hoạt nếu tiện ích A/B tăng ít nhất 0,1 điểm.
- Chạy lại benchmark ba loại sau khi kích hoạt.
- Thêm phát hiện lỗi cấu trúc trong lõi trang phục và tái sinh cục bộ; hậu xử lý tăng nét không đủ sửa vệt dọc hoặc chi tiết khuy giả.
- Đặt ngưỡng số bước khử nhiễu hiệu dụng tối thiểu cho preset chất lượng; chạy A/B 12/16/20 bước hiệu dụng trước khi khóa cấu hình.
- Tính coverage theo vùng người thay vì toàn ảnh, kiểm tra độ phủ vai–thân–eo và hợp nhất mask pose/SAM để tránh inpaint một dải hẹp giữa áo.
- Dùng CatVTON làm lượt thay trang phục có điều kiện từ ảnh tham chiếu; chỉ dùng SD3.5/LoRA cho hòa biên, chất liệu và sửa lỗi cục bộ.
- Tách reference `upper_body` thành ảnh sản phẩm/cutout sạch, không chứa mặt, quần hoặc nền; thêm cổng kiểm tra reference trước CatVTON.
- Duyệt manifest/reference Sprint 4Y và thay bằng ảnh sản phẩm thật nếu cutout suy ra từ người mẫu vẫn giữ tay hoặc chi tiết thân dưới.
- Giữ mask dedicated làm nhánh CatVTON mặc định thử nghiệm; bổ sung phát hiện vùng suy biến nội mask và thử nhiều seed/steps chỉ trên các ca lỗi trước khi mở benchmark 23 ảnh.
- Bổ sung cổng nhất quán màu/chất liệu và quy tắc chống regression so với baseline; không cho điểm texture cao bù cho sai màu lớn.
- Nhập ảnh sản phẩm upper-body nền sạch, không có người mẫu, trước khi chạy lại CatVTON; đây là blocker chất lượng hiện tại.

## 3A. Hoàn tất LoRA

- Tạo mask bám theo thân/ngực và bảo vệ khuôn mặt, tóc, tay thay cho mask chữ nhật của smoke test.
- Chạy A/B cùng seed ở trọng số `0.40`, `0.60`, `0.80` trên ít nhất 5 ảnh `upper_body`.
- Chấm riêng độ bám prompt, chất liệu, đường may, bảo toàn danh tính và lỗi biên.
- Chỉ đổi trạng thái `converted-experimental` sang `approved` khi kết quả LoRA tốt hơn bản nền mà không làm giảm ngưỡng an toàn.
- Thêm một adapter chuyên chất liệu/hoa văn/đường may định dạng Diffusers gốc để so sánh với adapter photorealistic tổng quát.

## 4. Nghiệm thu phát hành

- Ba benchmark đủ 23 ảnh, không lỗi kỹ thuật.
- Điểm tổng trung bình ≥ 90, giống mẫu ≥ 0,60, biên ≥ 80, hình thể ≥ 95.
- VRAM đỉnh ≤ 8 GB theo tiêu chí hiện tại.
- `technicalPassed`, `contentReady` và `referenceReady` đều đúng.
- Kiểm tra cài mới, cập nhật và rollback trên một máy Windows offline đại diện.

## 4A. Hoàn tất tích hợp Chroma

- Xác minh text encoder, tokenizer, VAE và cấu hình pipeline đã tải đủ từ nguồn chính thức.
- Backend `ChromaPipeline` độc lập với SD3.5, có CPU offload và báo lỗi dependency/VRAM rõ ràng đã được triển khai.
- Chạy smoke test 512 px bằng seed cố định; xác nhận báo cáo thời gian, VRAM, checksum và metadata đầu ra.
- Chỉ cấp khóa kích hoạt trong giao diện sau khi smoke test đạt và thao tác chuyển model không làm hỏng cấu hình SD3.5.

## 5. Đóng băng bản phát hành

- Sao lưu `workspace/review`, mask và cấu hình.
- Tạo golden baseline từ 23 ảnh đã chấp nhận.
- Đóng gói có model nếu phát hành cho máy không có kho model riêng.
- Xác minh checksum và kiểm tra thư mục cài sạch.
- Ghi lại phiên bản driver NVIDIA, CUDA/PyTorch và yêu cầu dung lượng đĩa.

## Định nghĩa hoàn thành

Dự án được coi là hoàn thành khi toàn bộ điều kiện nghiệm thu kỹ thuật và nội dung đạt, bản cài offline được xác minh trên máy mục tiêu, rollback phục hồi được mã ứng dụng mà không mất dữ liệu, và golden baseline cuối cùng đã được lưu.
