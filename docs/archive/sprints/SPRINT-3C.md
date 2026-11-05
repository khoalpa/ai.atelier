# Sprint 3C — Multi-person quality audit

## Đã triển khai

- Phát hiện tối đa tám nhân vật bằng Haar face cascade và HOG, chạy hoàn toàn local.
- Hợp nhất khung phát hiện trùng nhau và dùng vùng trung tâm làm phương án dự phòng.
- Chọn từng nhân vật trước khi tạo mask trang phục bằng SAM 2.
- Mask trang phục được tính theo khung người, phù hợp hơn với landscape và cảnh nhiều nhân vật.
- Vector màu–hoa văn cục bộ đo độ giống giữa ảnh tham chiếu và vùng trang phục sinh ra.
- Điểm giống tham chiếu được đưa vào điểm tổng để tự chọn seed.
- Audit phát hiện người và mask trên toàn bộ 23 ảnh mẫu, không cần chạy CatVTON cho mọi ảnh.

## Kết quả nghiệm thu

- Audit: 23 ảnh; 4 ảnh đạt tự động; 19 ảnh cần xem lại.
- Báo cáo: `workspace/outputs/audit_20261013T070242385582Z/regression-report.json`.
- Try-on xác nhận: seed 300, SAM `0.9765625`, độ giống tham chiếu `0.895879`.
- Điểm tổng: `96.1724/100`; sai lệch khuôn mặt `0.00063188`.
- Kết quả: `workspace/outputs/tryon_c001_20261013T070311558286Z/selected.png`.

## Diễn giải audit

- Landscape luôn được đưa vào hàng xem lại vì bố cục nhiều người cần chọn đối tượng rõ ràng.
- `multiple_people` yêu cầu người dùng chọn nhân vật trước khi batch.
- `weak_mask` là mask có độ tin cậy dưới 0.75 hoặc diện tích quá nhỏ.
- `detector_fallback` nghĩa là bộ dò không tìm thấy người và đã dùng vùng trung tâm.
