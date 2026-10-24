# Sprint 4O — Chuyển đổi và xác minh LoRA SD3.5

## Đã triển khai

- Giữ nguyên tệp Kohya nguồn và tạo tệp Diffusers/PEFT riêng.
- Chuyển projection, MLP, AdaLN; tách QKV gộp thành Q, K, V.
- Hấp thụ hệ số `alpha/rank` vào ma trận LoRA B để giữ cường độ gốc.
- Chuyển 377 module nguồn thành 529 module PEFT, 1.058 tensor đầu ra.
- Xác minh checksum, nạp adapter và chạy A/B cùng seed `42001`, weight `0.60`.

## Kết quả

- Bộ nạp Diffusers 0.37.1 đã gắn adapter thành công.
- Cả bản nền và bản LoRA đều sinh ảnh thành công; metadata ghi đúng adapter, weight và checksum.
- Bản LoRA bám prompt áo khoác tốt hơn bản nền.
- Chưa duyệt làm baseline vì mask smoke test hình chữ nhật tạo biên chuyển tiếp rõ.

## Tệp liên quan

- `scripts/convert-kohya-sd3-lora.py`
- `workspace/review/lora-sd35-large-photorealistic-conversion.json`
- `workspace/review/lora-ab-20261013T102900559772Z.json`
