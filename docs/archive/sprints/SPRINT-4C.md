# Sprint 4C — Sửa sinh ảnh có mục tiêu

## Mục tiêu

Xử lý các lỗi đường may mà phép phục hồi nhanh không sửa được, đồng thời giữ phạm vi thay đổi nhỏ, có thể kiểm soát và có dữ liệu để hiệu chỉnh cổng chất lượng.

## Đã triển khai

- Phát hiện điểm bất thường trong dải biên của mask trang phục.
- Chỉ gọi SD3.5 inpainting khi điểm biên chưa đạt và bản sửa nhanh không được chấp nhận.
- Mask sinh ảnh được giới hạn quanh vùng bất thường, làm mềm mép khi ghép và dùng prompt bảo vệ khuôn mặt, dáng người, tư thế và ánh sáng.
- Chỉ nhận bản sửa khi điểm biên tăng, độ giống mẫu giảm không quá 0,02 và điểm hình thể giảm không quá 1 điểm.
- Lưu `generative_seam_mask_seed_*.png` khi bản sửa được nhận và ghi trạng thái vào metadata.
- Ghi `selectedMetrics` để liên kết kết quả máy với nhãn duyệt của người dùng.
- Tạo báo cáo hiệu chỉnh từ các kết quả đã duyệt; dùng phân vị 15% của nhóm chấp nhận để đề xuất ngưỡng bảo thủ.
- Gắn mã cho tác vụ đơn và batch; hỗ trợ yêu cầu hủy và trạng thái tác vụ. Hủy có hiệu lực giữa các lượt suy luận để không làm hỏng trạng thái GPU.

## Nguyên tắc vận hành

Sửa sinh ảnh không chạy nếu kết quả đã vượt ngưỡng biên. Cơ chế này tránh tăng thời gian xử lý và tránh thay đổi không cần thiết. Báo cáo hiệu chỉnh chỉ đáng tin sau khi có đủ kết quả mới được duyệt và chứa bộ chỉ số Sprint 4C.

## Tệp đầu ra bổ sung

- `metadata.json`: `generativeRefine` và `selectedMetrics`.
- `generative_seam_mask_seed_*.png`: vùng sửa đã được chấp nhận.
- `workspace/review/quality-calibration.json`: tập nhãn và ngưỡng đề xuất.

## Kết quả xác minh

### Ca đạt chuẩn

- Seed 820, 10 bước, kích thước model 320 × 512.
- Điểm tổng 92,1214; độ giống mẫu 0,6923; điểm biên 84,2889; điểm hình thể 98,8537.
- Với ngưỡng biên 60, cổng chất lượng đạt và sửa sinh ảnh không chạy.
- Kết quả: `workspace/outputs/tryon_c001_20261013T080854006905Z`.

### Ca ép sửa sinh ảnh

- Seed 821, ngưỡng biên được nâng lên 95.
- Pipeline khoanh 6.114 pixel và chạy SD3.5 trên vùng hẹp.
- Bản sửa không vượt tiêu chí nên bị từ chối; ảnh trước sửa được giữ làm `selected.png` và cổng chất lượng vẫn không đạt.
- Kết quả: `workspace/outputs/tryon_c001_20261013T080912126564Z`.

### Hủy tác vụ

- Tác vụ thử nghiệm đang ở giai đoạn retry nhận yêu cầu hủy.
- Trạng thái chuyển `running` → `cancelling` → `cancelled` tại điểm dừng kế tiếp.
- Dịch vụ AI vẫn hoạt động sau phép thử.
