# Sprint 4T — Khôi phục texture lõi vùng inpaint

## Mục tiêu

Giảm độ mờ trong phần lõi trang phục sau khi hòa biên, không thay đổi pixel ngoài mask và không làm sắc lại vùng đầu, tóc hoặc tay đã được bảo vệ.

## Triển khai

- Tạo `texture_preserving_core_recovery` dùng high-pass có giới hạn từ chính ảnh sinh.
- Chỉ áp dụng trong lõi ổn định, bắt đầu sau khoảng `1,5 × edgeFeather` tính từ biên mask.
- Giới hạn biên độ high-pass ở 18 mức sáng để tránh viền sáng/tối và nhiễu giả.
- Mặc định `textureRecoveryAmount=0.65`; có thể tắt bằng `textureRecovery=false`.
- Mỗi lượt lưu ảnh trước khôi phục, ảnh kết quả và `texture_core_seed_*.png` để kiểm toán.
- Báo cáo Laplacian variance trước/sau và tỷ lệ tăng chi tiết.
- Endpoint `/texture-recovery-matrix` chạy `c001–c003`; mỗi cặp dùng cùng một lần sinh nên khác biệt chỉ đến từ bước khôi phục texture.

## Tiêu chí duyệt

- `outsideMaskMAE` không tăng đáng kể.
- `detailGain` lớn hơn 1 nhưng không xuất hiện halo, nhiễu hạt hoặc hoa văn giả.
- Khuôn mặt, tóc, tay và nền không thay đổi.
- Người duyệt chấp nhận ít nhất 2/3 cặp trước khi mở rộng ma trận 5 ảnh.

## Kết quả chạy 2026-10-13

- Báo cáo: `workspace/review/texture-recovery-matrix-20261013T141812184136Z.json`.
- Chạy đủ `c001–c003`, không bỏ qua ảnh nào, cùng seed `44001–44003`.
- `c001`: detail gain `1,441`, outside-mask MAE `0,000000126`.
- `c002`: detail gain `1,343`, outside-mask MAE `0,000000433`.
- `c003`: detail gain `1,796`, outside-mask MAE `0,000000171`.
- Không quan sát thấy thay đổi ở nền, khuôn mặt, tóc hoặc tay.
- Duyệt trực quan: độ nét lõi tăng nhẹ nhưng `c002` vẫn có vệt dọc/khuy giả ở giữa thân áo. Kết quả chưa đủ điều kiện làm baseline.

Kết luận: giữ bộ khôi phục texture làm hậu xử lý mặc định vì tác động được giới hạn tốt, nhưng không xem đây là giải pháp cho lỗi cấu trúc. Bước tiếp theo phải phát hiện và tái sinh cục bộ vùng lỗi cấu trúc trong lõi mask.
