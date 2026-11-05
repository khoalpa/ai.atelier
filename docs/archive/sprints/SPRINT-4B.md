# Sprint 4B — Kiểm soát lỗi biên và tự chạy lại

## Mục tiêu

Giảm lỗi cục bộ tại cổ áo, tay áo và eo; không chấp nhận một bản sửa chỉ vì điểm tổng cao hơn; tự thử lại có giới hạn khi kết quả chưa đạt chuẩn.

## Đã triển khai

- Bổ sung bốn chỉ số: chất lượng biên (`seamScore`), tính hợp lý hình thể (`anatomyScore`), độ liên tục hoa văn (`textureContinuity`) và gradient biên.
- Thêm bước sửa cục bộ trên dải biên bằng inpainting TELEA và hòa trộn mềm.
- Bản sửa chỉ được nhận khi điểm biên tăng, độ giống trang phục giảm dưới 0,02 và điểm hình thể giảm dưới 1 điểm.
- Thêm ngưỡng tối thiểu cho điểm biên và điểm hình thể vào cổng chất lượng.
- Thêm tự chạy lại từ 0–3 lần bằng seed kế tiếp và tăng 5 bước render mỗi lần.
- Hiển thị các chỉ số mới, số lần chạy lại và trạng thái sửa biên trong giao diện và báo cáo batch.

## Kết quả xác minh

### Ca chính — hai tầng, hai seed

- Ảnh nhân vật: `samples/characters/c001.png`
- Ảnh tham chiếu: `samples/characters/c003.png`
- Seed được chọn: 700
- Điểm tổng: 92,5686
- Độ giống mẫu: 0,71785
- Điểm biên: 85,8830
- Điểm hình thể: 98,2835
- Cổng chất lượng: đạt
- Số lần chạy lại: 0
- Sửa biên đã được thử nhưng bị từ chối vì không cải thiện đủ. Đây là hành vi mong muốn của cơ chế bảo vệ.
- Kết quả: `workspace/outputs/tryon_c001_20261013T075848883987Z/selected.png`

### Ca ép chạy lại

- Ngưỡng điểm biên được đặt ở 95 để chủ động kích hoạt nhánh chạy lại.
- Hệ thống chạy thêm đúng một lần: seed 710 rồi 711.
- Hai điểm biên lần lượt là 68,52 và 66,97; kết quả cuối vẫn bị đánh dấu không đạt thay vì được chấp nhận sai.
- Kết quả: `workspace/outputs/tryon_c001_20261013T075929991451Z`

## Giới hạn còn lại

Phục hồi TELEA phù hợp với lỗi nhỏ nhưng chưa tái tạo tốt cấu trúc đường may hoặc chi tiết thắt lưng phức tạp. Vùng eo của ca chính vẫn có một lỗi nhẹ, vì vậy bước tiếp theo nên là sửa sinh ảnh có mục tiêu trên vùng hẹp và hiệu chỉnh ngưỡng bằng tập kết quả được người dùng gán nhãn.
