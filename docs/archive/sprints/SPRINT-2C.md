# Sprint 2C — Quality controls

## Đã triển khai

- Mask bảo vệ màu xanh tách biệt với mask chỉnh sửa màu đỏ.
- Preset cho kính, mũ, trang sức, túi và giày.
- Điều chỉnh steps, strength, guidance, mask expansion, feathering và crop padding.
- So sánh ảnh gốc với mọi phương án trong cùng cửa sổ.
- Đo sai khác trung bình ngoài mask cho từng kết quả.
- Chọn một seed làm `selected.png` và ghi lựa chọn vào metadata.

## Quy tắc mask

- Đỏ: vùng được phép sinh lại.
- Xanh: chi tiết bắt buộc giữ nguyên; vùng xanh được trừ khỏi vùng đỏ trước inference.
- Ngoài vùng đỏ: lấy trực tiếp từ ảnh gốc khi ghép kết quả.

Với kính, mask đỏ chỉ nên phủ gọng và tròng kính. Dùng mask xanh bảo vệ con ngươi, mí mắt, lông mày và đường viền tóc khi cần.
