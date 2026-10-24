# Sprint 4U — Phát hiện và tái sinh lỗi cấu trúc lõi

## Mục tiêu

Sửa vệt dọc, khuy hoặc chi tiết tương phản bất thường còn lại trong lõi trang phục mà không tái sinh toàn bộ người hay phần ảnh đã đạt.

## Triển khai

- Dùng phép black-hat theo chiều dọc để tìm nét tối khác biệt với vải lân cận.
- Chỉ xét lõi cách biên mask ít nhất `1,5 × edgeFeather`.
- Lọc connected component theo kích thước, tỷ lệ kéo dài và độ tin cậy.
- Mở rộng mask lỗi một vùng nhỏ, sau đó chạy SD3.5 inpaint ở crop cục bộ với `strength=0.48` và tối thiểu 12 bước.
- Composite mềm vùng sửa trở lại ảnh đã hòa biên và khôi phục texture.
- Lưu `structural_baseline_seed_*.png` và `structural_artifacts_seed_*.png` để kiểm toán.
- Tính năng không bật mặc định. Endpoint `/structural-refine-matrix` chạy A/B trên `c001–c003` trước khi quyết định kích hoạt.

## Tiêu chí duyệt

- Mask lỗi không chạm vùng đầu, tóc, tay hoặc nền.
- Không xóa nhầm đường may hợp lệ trên `c001` và `c003`.
- Vệt dọc bất thường trên `c002` giảm rõ rệt.
- Không tạo mảng màu, đường ghép hoặc texture khác tông quanh vùng sửa.

## Kết quả chạy

- Ma trận đầu: `workspace/review/structural-refine-matrix-20261013T142829298505Z.json`.
- Detector ban đầu quá bảo thủ: bỏ sót `c002` và chọn nhầm một chi tiết đơn trên `c003`.
- Đã đổi sang phát hiện chuỗi thành phần thẳng hàng và yêu cầu tối thiểu 500 pixel trước khi cho phép tái sinh.
- Lượt xác nhận `c002`: `workspace/review/structural-refine-matrix-20261013T143633492708Z.json`.
- Detector mới chọn 1.434 pixel thuộc 8 thành phần, chạy 12 bước cục bộ và giữ outside-mask MAE ở `0,000000307`.
- Duyệt trực quan: vệt được làm mềm một phần nhưng cấu trúc áo vẫn không đạt prompt.

Kết luận: giữ tính năng ở trạng thái thử nghiệm và tắt mặc định. Nút thắt chính không còn là hậu xử lý mà là số bước khử nhiễu hiệu dụng của lượt sinh đầu (`4 steps × strength 0,50` chỉ còn khoảng 2 bước). Cần sửa preset chất lượng trước khi tiếp tục mở rộng benchmark.
