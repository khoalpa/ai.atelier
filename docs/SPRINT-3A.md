# Sprint 3A — Offline virtual try-on

## Đã triển khai

- CatVTON `mix-48k-1024` chạy bằng checkpoint cục bộ.
- Tải ảnh trang phục PNG, JPEG hoặc WebP tối đa 20 MB.
- Hỗ trợ áo, quần/váy và trang phục toàn thân.
- Dùng chung editable mask và protected detail mask từ Sprint 2C.
- Sinh 1–4 phương án, lưu ảnh trang phục, mask, kết quả và metadata.
- Ghép lại vùng ngoài mask từ ảnh nguồn.
- So sánh với ảnh gốc và chọn `selected.png`.

## Giới hạn POC

- Checkpoint CatVTON có giấy phép CC BY-NC-SA 4.0 và chỉ dùng phi thương mại.
- Ảnh trang phục nên chụp chính diện, nền đơn giản, không bị người mẫu che nhiều.
- Landscape và cảnh nhiều nhân vật chưa nằm trong nghiệm thu Sprint 3A.

## Cấu hình mặc định

- Kích thước làm việc tối đa: 960 px.
- 35 bước inference.
- Guidance: 2.5.
- Một phương án mỗi lượt để kiểm soát thời gian và VRAM.

## Nghiệm thu kỹ thuật

- Trạng thái `/health`: `tryonAvailable: true`, không còn tệp thiếu.
- Smoke test: `characters/c001.png`, mask áo từ SAM 2, ảnh tham chiếu `characters/c003.png`.
- Cấu hình thử nhanh: 512 px, 10 bước, seed 42, guidance 2.5.
- Kết quả lưu tại `workspace/outputs/tryon_c001_20261013T062144535993Z`.
- Sai lệch trung bình ngoài mask: `0.0001249384`.
- Checksum các trọng số quan trọng nằm trong `models/tryon/manifest.json`.
