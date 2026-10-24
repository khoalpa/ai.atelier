# Sprint 4A — Garment normalization and semantic quality gate

## Đã triển khai

- Phân biệt ảnh người mẫu và ảnh sản phẩm bằng YOLO pose local.
- Ảnh người mẫu: pose xác định người, SAM 2 tách riêng loại trang phục đã chọn.
- Ảnh sản phẩm: SAM 2 tách vật thể trung tâm và làm sạch nền.
- Ảnh trang phục sau xử lý được crop gọn và đặt trên nền trung tính.
- Embedding CLIP local từ model safety checker, kết hợp đặc trưng màu–hoa văn.
- Hai tầng sinh ảnh: nhiều seed preview 512 px, sau đó render lại duy nhất seed tốt nhất.
- Cổng chất lượng theo điểm tổng và độ giống tham chiếu.
- Batch không đưa kết quả dưới chuẩn vào hàng duyệt chính thức.

## Nghiệm thu

- Ảnh tham chiếu `characters/c003.png` được nhận là `model-photo`.
- Diện tích áo tách được: `0.0353756`; SAM: `0.796875`.
- Preview seed 600: điểm `87.71`, similarity `0.6636`.
- Preview seed 601: điểm `90.31`, similarity `0.6938` và được chọn.
- Render cuối: điểm `93.0275`, similarity `0.73377`; cổng chất lượng đạt.
- Kết quả: `workspace/outputs/tryon_c001_20261013T074755522762Z/selected.png`.

## Giới hạn

- Điểm semantic chưa đánh giá tốt lỗi nhỏ ở đường ráp áo–quần.
- Ảnh tham chiếu quá nhỏ hoặc bị che nhiều vẫn có thể tạo mask trang phục thiếu chi tiết.
- Hai tầng giảm số lượt render độ phân giải cao nhưng tăng thời gian khi chỉ yêu cầu một seed.
