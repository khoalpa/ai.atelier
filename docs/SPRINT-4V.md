# Sprint 4V — Hiệu chỉnh số bước khử nhiễu hiệu dụng

## Vấn đề

Diffusers chỉ sử dụng một phần timestep khi `strength < 1`. Cấu hình `steps=4`, `strength=0.50` vì vậy chỉ chạy khoảng hai bước khử nhiễu, không đủ để thay đổi cấu trúc trang phục.

## Triển khai

- Thêm `effective_step_policy` tính số bước thực tế sau khi áp dụng strength.
- Mặc định yêu cầu tối thiểu 12 bước hiệu dụng và tự nâng tổng steps khi cần.
- Giới hạn tổng steps ở 60 và ngưỡng hiệu dụng cấu hình được trong khoảng 0–24.
- Metadata ghi `requestedSteps`, `adjustedSteps`, `effectiveSteps`, `minimumEffectiveSteps` và `autoAdjusted`.
- `allowFastPreview=true` cho phép bỏ ngưỡng khi người dùng chủ động chọn preview nhanh.
- Endpoint `/effective-step-matrix` so sánh mục tiêu 12/16/20 trên `c001–c003` cùng seed và strength.

## Tiêu chí duyệt

- Trang phục sinh ra bám prompt rõ hơn cấu hình hai bước cũ.
- Không tăng lỗi khuôn mặt, hình thể hoặc vùng ngoài mask.
- Chọn mức hiệu dụng thấp nhất đạt chất lượng để giảm thời gian chạy offline.

## Kết quả xác nhận ban đầu

- Báo cáo: `workspace/review/effective-step-matrix-20261013T144316968102Z.json`.
- Mẫu: `c002`, seed `46002`, strength `0.50`, tổng 24 bước, đúng 12 bước hiệu dụng.
- Outside-mask MAE: `0,000000430`; vùng ngoài mask tiếp tục được bảo toàn.
- Thời gian sau khi nạp model khoảng 14–18 giây mỗi bước trên máy thử nghiệm.
- Duyệt trực quan: ảnh có thêm chi tiết cấu trúc nhưng đường chia giữa thân áo rõ và dài hơn; chưa đạt baseline.

Kết luận: chính sách bước hiệu dụng hoạt động đúng, nhưng không thể khắc phục mask chỉ phủ phần giữa thân. Chưa chạy mức 16/20 vì tăng steps trên cùng mask có nguy cơ khuếch đại lỗi ghép. Cần sửa độ đầy đủ của mask trang phục trước, sau đó mới tiếp tục ma trận.
