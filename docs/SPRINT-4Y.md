# Sprint 4Y — Reference trang phục sạch và CatVTON thuần

## Mục tiêu

Loại mặt, tay, quần và nền khỏi ảnh tham chiếu toàn thân trước khi đưa vào CatVTON; đồng thời giới hạn mask áo phía trên đường hông để giảm lỗi thắt lưng.

## Thành phần đã triển khai

- `normalize_garment_reference`: dùng pose và mask trang phục để tạo cutout trên nền xám trung tính.
- Báo cáo riêng tỷ lệ nhiễm mặt và phần thân dưới trước/sau làm sạch.
- Lưu reference, mask và manifest có nguồn gốc tại `workspace/references`.
- `POST /api/normalize-garment-reference`: tạo lại reference theo loại trang phục.
- `POST /api/catvton-reference-matrix`: chạy CatVTON thuần trên tối đa ba ảnh, cùng cấu hình và seed xác định.
- Mask `upper_body` dừng sớm hơn đường hông; không gọi SD3.5/hybrid trong ma trận này.

## Cổng chất lượng reference

- Coverage cutout tối thiểu `0,18`.
- Nhiễm mặt tối đa `0,01`.
- Nhiễm phần thân dưới sau làm sạch tối đa `0,20`.
- Kết quả tự động vẫn cần duyệt trực quan trước khi dùng làm baseline nội dung.

## Lệnh kiểm tra

```powershell
Invoke-RestMethod http://127.0.0.1:7861/api/normalize-garment-reference -Method Post -ContentType application/json -Body '{"garmentSampleId":"characters/c003.png","category":"upper_body"}'
Invoke-RestMethod http://127.0.0.1:7861/api/catvton-reference-matrix -Method Post -ContentType application/json -Body '{"sampleIds":["characters/c001.png","characters/c002.png","characters/c003.png"],"category":"upper_body","seed":49001,"steps":10,"maxSide":512}'
```

## Tiêu chí quyết định

Chỉ khóa CatVTON làm preset mặc định nếu cả ba ảnh không còn nhiễm quần/reference, không có đường cắt ngang eo rõ rệt và giữ khuôn mặt/tay tốt hơn baseline Sprint 4X.

## Kết quả chạy 2026-10-13

- Reference chuẩn hóa đạt cổng kỹ thuật: coverage `0,3106`, nhiễm mặt `0`, nhiễm thân dưới sau cắt `0,0016`.
- Ma trận hoàn tất `3/3`, không bỏ qua; thời gian lần lượt `14,406 s`, `4,016 s`, `3,881 s`; VRAM đỉnh `2543,4 MB`.
- Similarity reference đạt `0,6715–0,6884`, nhưng duyệt ảnh cho thấy cả ba kết quả còn lỗi cấu trúc rõ ở thân/eo. `c001` và `c003` đặc biệt có mảng chồng lấn và nhiễm quần.
- Kết luận: không khóa CatVTON làm preset mặc định. Reference suy ra từ ảnh người mẫu được đánh dấu `experimental-rejected` và không được tính là reference chuyên biệt đã nghiệm thu.
- Báo cáo: `workspace/review/catvton-reference-matrix-20261013T152650678384Z.json`.
