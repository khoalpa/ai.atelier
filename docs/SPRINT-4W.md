# Sprint 4W — Độ đầy đủ và hợp nhất mask trang phục

## Mục tiêu

Ngăn pipeline inpaint một dải hẹp giữa thân áo, nguyên nhân tạo đường chia và cấu trúc trang phục kép khi tăng số bước diffusion.

## Triển khai

- Tạo silhouette trang phục từ keypoint pose cho thân, tay hoặc chân theo category.
- Đo `relativePersonCoverage` trong bounding box người.
- Đo `garmentCompleteness` bằng tỷ lệ silhouette pose được mask bao phủ.
- Khi SAM phủ dưới 72% silhouette dự kiến, hợp nhất SAM với pose prior.
- Mở rộng giới hạn ngang `upper_body`/`overall` để không cắt mất tay áo.
- Áp lại mask bảo vệ đầu, tóc và bàn tay sau phép hợp nhất.
- Cổng chấp nhận yêu cầu coverage toàn ảnh tối thiểu 2,5% và garment completeness tối thiểu 72%.

## Tiêu chí duyệt

- `c001–c003` đều vượt cổng completeness.
- Mask phủ liên tục vai–thân–eo và tay áo liên quan, không chạm đầu hoặc bàn tay.
- Chạy lại 12 bước hiệu dụng không còn mảng ghép hẹp giữa thân.

## Kết quả chạy 2026-10-13

- Cổng mask: `c001–c003` đều đạt, không bỏ qua ảnh nào.
- Coverage toàn ảnh: `5,93%`, `7,41%`, `7,48%`.
- Coverage trong khung người: `15,11%`, `19,64%`, `19,34%`.
- Garment completeness: `84,02%`, `86,51%`, `85,05%`.
- Báo cáo 12 bước hiệu dụng: `workspace/review/effective-step-matrix-20261013T145956748215Z.json`.
- Outside-mask MAE vẫn rất thấp: từ `0,000000090` đến `0,000001528`.

Duyệt trực quan xác nhận mask không còn là dải hẹp và trang phục liền khối hơn. Tuy nhiên độ bám prompt chưa đạt: `c001` gần như giữ áo sơ mi; `c002` có khe trắng và khuy lớn bất thường; `c003` thay đổi nếp nhưng chưa thành áo khoác xanh. Kết luận: Sprint 4W đạt mục tiêu mask, nhưng SD3.5 text inpaint không đủ điều kiện trực quan để thay trang phục chính xác. Bước tiếp theo cần dùng CatVTON/ảnh trang phục tham chiếu làm lượt sinh chính, SD3.5 chỉ tinh chỉnh.
