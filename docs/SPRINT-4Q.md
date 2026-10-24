# Sprint 4Q — Tự hiệu chỉnh mask và strength

## Đã triển khai

- Làm kín các lỗ nhỏ trong mask và mở nhẹ theo chiều ngang ở vai/eo.
- Mọi phép mở mask vẫn bị giới hạn trong khung trang phục theo thân người.
- Mask có coverage dưới `0.025` bị loại khỏi batch và ghi lý do `mask-coverage-below-minimum`.
- Strength gợi ý theo coverage: `<0.045 → 0.50`, `<0.08 → 0.60`, còn lại `0.70`.
- Ma trận strength dùng ba ảnh một người, cùng seed, LoRA weight cố định và ba strength `0.50/0.60/0.70`.
- Prompt phủ định bổ sung `duplicate clothing`, `double jacket`, `split torso`.

## Quy tắc duyệt

Outside-mask MAE chỉ là cổng bảo toàn. Strength được chọn sau khi xem trực quan cấu trúc áo, biên vai/eo, chi tiết vải và bảo toàn danh tính.

## Kết quả smoke test

- Sau refine, ba ảnh `characters/c001–c003` đều vượt coverage tối thiểu; khoảng `0.0264–0.0433`.
- Trên `c002`, strength `0.50` không còn lỗi áo kép và có outside-mask MAE thấp nhất.
- Strength `0.60` và `0.70` đều sinh đường mở dọc bất thường.
- Strength `0.50` vẫn còn blur thân áo và vệt tối biên trái, vì vậy trạng thái là `technical-pass-quality-retry`.
