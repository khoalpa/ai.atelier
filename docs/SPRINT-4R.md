# Sprint 4R — Hòa biên cục bộ thích ứng

## Đã triển khai

- Feather chỉ đi vào phía trong editable mask; pixel ngoài mask giữ nguyên từ ảnh nguồn.
- Bề rộng feather mặc định dựa trên blur và bị giới hạn trong `3–32` pixel.
- Phát hiện vệt quá tối/quá sáng bằng sai lệch luminance so với lân cận trên dải biên hẹp.
- Chỉ các pixel bị gắn cờ mới được sửa bằng TELEA và hòa trộn Gaussian nhẹ.
- Mỗi kết quả lưu `edge_artifacts_seed_*.png` và metadata: feather, số pixel biên, số pixel sửa, tỷ lệ artifact.

## Cổng chất lượng

Hòa biên không thể biến một cấu trúc áo sai thành kết quả hợp lệ. Ảnh vẫn phải qua duyệt cấu trúc trang phục, chi tiết vải và danh tính.

## Kết quả A/B sau xử lý

- `c002`, seed `43101`, strength `0.50`: outside-mask MAE giảm từ `0.0000557860` xuống `0.0000003084`.
- 225 trong 32.275 pixel dải biên được sửa, tỷ lệ `0.697%`.
- Biên trái và đường cắt cứng đã giảm; vùng giữa thân áo vẫn thiếu chi tiết vải nên chưa duyệt baseline.
