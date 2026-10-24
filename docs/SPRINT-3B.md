# Sprint 3B — Automated offline try-on

## Đã triển khai

- Tạo mask tự động theo ba loại: thân trên, thân dưới và toàn thân.
- Tiền xử lý ảnh trang phục bằng SAM 2: tách vùng trung tâm, cắt gọn và đặt trên nền trung tính.
- Tự bỏ qua tách nền khi ảnh tham chiếu là ảnh người mẫu hoặc vùng tách không đáng tin cậy.
- Chạy hàng loạt tối đa 12 ảnh trong một lượt.
- Chấm điểm từng seed theo vùng ngoài mask, khuôn mặt, biên ghép và tỷ lệ cháy màu.
- Tự sao chép phương án tốt nhất thành `selected.png`.
- Lưu `batch-report.json` với kết quả và lỗi riêng cho từng ảnh.

## Nghiệm thu

- Ảnh nguồn: `characters/c001.png`.
- Ảnh tham chiếu: `characters/c003.png`.
- Cấu hình thử nhanh: 512 px, 10 bước, seed 200.
- Mask tự động: `0.953125`.
- Điểm phương án được chọn: `96.6739955667/100`.
- Kết quả: `workspace/outputs/tryon_c001_20261013T062858600771Z/selected.png`.
- Báo cáo: `workspace/outputs/batch_20261013T062900769059Z/batch-report.json`.

## Giới hạn

- Mask tự động giả định một nhân vật chính, gần giữa ảnh.
- Ảnh nhiều người và bố cục landscape cần bước phát hiện từng người trước khi chạy.
- Điểm chất lượng hiện đo lỗi hình ảnh kỹ thuật, chưa đánh giá chính xác mức độ giống món đồ bằng embedding thị giác.
