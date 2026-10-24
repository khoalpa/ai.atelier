# Sprint 4J — Phiên duyệt có hướng dẫn

## Đã triển khai

- Hàng duyệt benchmark hiển thị từng cặp ảnh theo thứ tự, thay vì buộc người dùng cuộn qua 23 thẻ cùng lúc.
- Tự chuyển tới ảnh chưa duyệt đầu tiên và chuyển sang ảnh kế tiếp sau khi lưu quyết định.
- Phím tắt: `A` chấp nhận, `R` chạy lại, `X` loại bỏ, `←` và `→` chuyển ảnh.
- Thanh tiến độ hiển thị vị trí hiện tại và số ảnh đã duyệt.
- Màn hình kiểm tra tiến độ tổng hợp số ảnh đã duyệt, nhãn lỗi, ảnh tham chiếu và trạng thái trọng số.
- Nghiệm thu nội dung yêu cầu đủ 23 ảnh được chấp nhận và đủ hồ sơ tham chiếu cho ba loại trang phục.
- Không có ảnh nào được ứng dụng tự động chuyển sang trạng thái chấp nhận.

## Quy trình đề nghị

1. Chọn **Duyệt 23 kết quả benchmark**.
2. Xem ảnh gốc và kết quả; gắn nhãn lỗi trước khi chọn chạy lại hoặc loại bỏ.
3. Chọn ảnh trang phục phù hợp, lần lượt lưu tham chiếu cho `lower_body` và `overall`.
4. Chọn **Kiểm tra tiến độ duyệt** để xem các điều kiện còn thiếu.
5. Khi đủ dữ liệu, chạy hiệu chỉnh trọng số, so sánh A/B và kích hoạt trọng số đã kiểm chứng.
6. Chạy kiểm tra nghiệm thu.

## Trạng thái hiện tại

Dữ liệu duyệt vẫn là quyết định của người dùng. Sprint này chỉ rút ngắn thao tác và cung cấp cổng kiểm tra; không suy diễn hoặc tự tạo kết quả duyệt.
