# Sprint 4P — Mask theo thân người và ma trận LoRA

## Đã triển khai

- Mask trang phục dùng SAM 2 trong khung người và các điểm pose YOLO.
- Vùng bảo vệ đầu, tóc, mặt và hai bàn tay được tạo riêng, sau đó loại khỏi editable mask.
- Giao diện hiển thị editable mask màu đỏ, protected mask màu xanh, độ tin cậy và tỷ lệ phủ.
- Ma trận LoRA chạy tối đa 5 ảnh; mỗi ảnh có một baseline và ba weight `0.40`, `0.60`, `0.80` cùng seed.
- Cấu hình LoRA ban đầu được khôi phục kể cả khi ma trận lỗi giữa chừng.
- Báo cáo ghi mask score, coverage, đường dẫn ảnh và outside-mask MAE cho từng weight.

## Cổng chất lượng

Kết quả ma trận luôn yêu cầu duyệt trực quan. Không tự động chuyển LoRA thành baseline chỉ dựa trên outside-mask MAE.
