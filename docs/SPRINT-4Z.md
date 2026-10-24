# Sprint 4Z — Mask CatVTON chuyên biệt

## Mục tiêu

Không tái sử dụng mask inpainting rộng cho CatVTON. Mask mới phải thay được thân và tay áo nhưng dừng trước cạp quần, đồng thời không sửa đầu, tóc hoặc bàn tay.

## Triển khai

- Tạo silhouette trực tiếp từ vai, khuỷu, cổ tay và hông của pose.
- Nâng đường gấu áo lên trên keypoint hông và xóa toàn bộ vùng trung tâm phía dưới đường này.
- Trừ mask bảo vệ đầu, tóc và bàn tay sau mọi phép hình thái học.
- Ghi `hemY`, coverage, `waistLeakage`, `protectedOverlap` và trạng thái chấp nhận cho từng ảnh.
- Endpoint `POST /api/catvton-dedicated-mask-matrix` chạy tối đa ba ảnh bằng reference chuẩn hóa, không gọi SD3.5.

## Cổng kỹ thuật

- Coverage tối thiểu `0,025`.
- `waistLeakage <= 0,005`.
- `protectedOverlap <= 0,001`.
- Kết quả sinh ảnh vẫn phải được duyệt trực quan; chỉ số mask không thay thế nghiệm thu nội dung.

## Lệnh chạy

```powershell
Invoke-RestMethod http://127.0.0.1:7861/catvton-dedicated-mask-matrix -Method Post -ContentType application/json -Body '{"sampleIds":["characters/c001.png","characters/c002.png","characters/c003.png"],"category":"upper_body","seed":50001,"steps":10,"maxSide":512}'
```

## Kết quả chạy 2026-10-13

- Ma trận hoàn tất `3/3`, không bỏ qua; mọi mask có `waistLeakage=0` và `protectedOverlap=0`.
- Coverage mask nằm trong `0,0350–0,0461`; VRAM đỉnh `2536,2 MB`.
- Điểm seam tăng lên `85,70–89,77`, anatomy `98,13–98,67`; outside-mask MAE giảm còn `0,00019–0,00030`.
- Duyệt trực quan: `c001` loại được mảng nhiễm ở cạp quần và cho kết quả liền mạch hơn; `c003` giữ quần sạch nhưng còn cháy/viền ở vai và tay áo; `c002` còn một mảng nhòe lớn phía thân phải.
- Kết luận: mask dedicated đạt mục tiêu kỹ thuật và tốt hơn Sprint 4Y, nhưng pipeline chưa đủ điều kiện mặc định do lỗi nội vùng trên `c002` và viền trên `c003`.
- Báo cáo: `workspace/review/catvton-reference-matrix-20261013T153223547856Z.json`.
