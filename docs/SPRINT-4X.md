# Sprint 4X — Pipeline hybrid CatVTON → SD3.5

## Mục tiêu

Dùng CatVTON để bám ảnh trang phục tham chiếu, sau đó chỉ dùng SD3.5 sửa biên hoặc lỗi cục bộ. Tránh yêu cầu SD3.5 text inpaint tự suy luận toàn bộ thiết kế trang phục.

## Triển khai

- Endpoint `/hybrid-tryon-compare` chạy tối đa ba ảnh một người.
- Ba nhánh dùng cùng seed và cùng mask đạt cổng completeness:
  - CatVTON thuần, không sửa seam.
  - SD3.5 thuần với 12 bước hiệu dụng.
  - CatVTON sau sửa seam cục bộ bằng SD3.5, hòa biên và khôi phục texture.
- CatVTON và SD3.5 được nạp tuần tự để không giữ đồng thời hai model trong VRAM.
- Mỗi nhánh lưu ảnh riêng và được chấm quality, reference similarity, seam, anatomy và texture continuity.
- Ảnh tham chiếu mặc định là profile `upper_body` hiện tại: `characters/c003.png`.

## Tiêu chí duyệt

- Hybrid hoặc CatVTON thắng SD3.5 thuần ở ít nhất 2/3 ảnh.
- Reference similarity không giảm quá 0,02 sau refine.
- Không giảm anatomy quá 1 điểm và không tạo thay đổi ngoài mask.
- Chỉ bật hybrid mặc định nếu refine thực sự cải thiện seam; nếu không, giữ CatVTON thuần.

## Smoke test `c001`

- Báo cáo: `workspace/review/hybrid-tryon-compare-20261013T151841398215Z.json`.
- Tham chiếu: profile tạm `characters/c003.png` (ảnh toàn thân).
- CatVTON: `16,94 giây`, VRAM đỉnh `2.543 MB`, similarity `0,783`, seam `80,96`; bám áo sáng nhưng tạo lỗi lớn ở thắt lưng.
- SD3.5: 12 bước hiệu dụng, similarity `0,809`, seam `93,49`; chỉ số cao nhưng duyệt trực quan cho thấy chủ yếu giữ áo cũ.
- Hybrid: sửa `32.432` pixel, similarity `0,785`, seam `92,42`; mất hơn 13 phút do nghẽn CPU offload sau chuyển model và vẫn còn lỗi thắt lưng.

Kết luận: endpoint và luồng ba nhánh hoạt động, nhưng hybrid không thắng và tiếp tục bị tắt. Điểm similarity hiện bị thiên lệch vì ảnh tham chiếu là người toàn thân có nền/quần. Cần tạo reference trang phục sạch và khóa mask tại đường eo trước khi chạy `c002–c003`.
