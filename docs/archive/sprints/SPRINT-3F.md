# Sprint 3F — Offline pose and keypoint protection

## Đã triển khai

- YOLO11n Pose chạy local bằng checkpoint 6 MB.
- Phát hiện người, độ tin cậy và 17 keypoint COCO trên GPU.
- Người có diện tích lớn nhất được đặt làm nhân vật chính mặc định.
- Hiển thị keypoint trên canvas khi bật chế độ pose.
- Bảo vệ tự động vùng mắt, tai, mũi và hai cổ tay khỏi mask trang phục.
- Pose là tùy chọn; detector Haar/HOG vẫn là chế độ nhanh mặc định.
- Audit có thể chạy riêng với `yolo11n-pose` và ngưỡng mask phù hợp với vùng bảo vệ keypoint.
- Checkpoint và SHA-256 đã được đưa vào manifest mô hình.

## Nghiệm thu

- `characters/c001.png`: một người, confidence `0.9137`, đủ 17 keypoint.
- Try-on pose: seed 500, SAM `0.9140625`, face MAE `0.00116338`.
- Kết quả: `workspace/outputs/tryon_c001_20261013T073431763542Z/selected.png`.
- Audit pose: 23 ảnh, trung bình 2.39 người/ảnh; 3 ảnh chạy hoàn toàn tự động, 20 ảnh cần duyệt.
- Báo cáo: `workspace/outputs/audit_20261013T073355772134Z/regression-report.json`.

## So sánh detector

- Haar/HOG phát hiện trung bình 1.74 người/ảnh.
- Pose phát hiện trung bình 2.39 người/ảnh và gắn cờ nhiều cảnh nhiều người hơn.
- Số ảnh tự động giảm từ 4 xuống 3 vì hệ thống ưu tiên không chỉnh nhầm nhân vật phụ.

## Giới hạn

- Keypoint tay là vị trí cổ tay, chưa có landmark từng ngón.
- Pose cải thiện bảo vệ cấu trúc nhưng không bảo đảm trang phục sinh ra giống mẫu nếu ảnh tham chiếu chứa cả người hoặc nền phức tạp.
- YOLO11n Pose dùng giấy phép của Ultralytics; cần rà soát giấy phép trước khi thương mại hóa.
