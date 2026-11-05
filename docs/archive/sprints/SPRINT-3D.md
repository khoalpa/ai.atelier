# Sprint 3D — Review queue and person crop

## Đã triển khai

- Vẽ khung phát hiện người trực tiếp trên canvas.
- Công cụ **Chọn người** cho phép nhấp vào khung để chọn đối tượng.
- Hàng đợi audit có nút **Mở để duyệt** cho từng ảnh cần xem lại.
- Crop người được chọn, chạy CatVTON trên crop và ghép lại ảnh gốc.
- Batch có ngưỡng tin cậy SAM cấu hình từ 40–95%.
- Tùy chọn chỉ chạy ảnh vượt ngưỡng; ảnh dưới ngưỡng được ghi là `skipped` mà không nạp CatVTON.
- Báo cáo batch tách riêng `completed`, `failed` và `skippedItems`.

## Nghiệm thu

- Crop thử nghiệm: `characters/c001.png`, seed 410, kích thước model 384×512.
- Ảnh kết quả vẫn giữ kích thước gốc 1024×1536.
- SAM `0.98046875`, độ giống tham chiếu `0.886814`, điểm tổng `95.8138/100`.
- Kết quả: `workspace/outputs/tryon_c001_20261013T071041818285Z/selected.png`.
- Kiểm thử ngưỡng: `portrait/greeting.png`, SAM `0.609375`, ngưỡng `0.75` → bỏ qua; không lỗi.

## Giới hạn

- Bộ dò Haar/HOG vẫn có thể bỏ sót người nhỏ, quay lưng hoặc bị che nhiều.
- Hàng đợi duyệt hiện lưu trong báo cáo audit; chưa có trạng thái duyệt bền vững qua nhiều phiên.
- Ghép crop dùng vùng ngoài mask từ ảnh gốc; chưa cân chỉnh màu cục bộ ở biên crop.
