# Sprint 5G — Tích hợp ngoại tuyến Chroma1-HD

## Kết quả

- Dùng `ChromaPipeline` của Diffusers 0.37.1 và checkpoint đơn `Chroma1-HD.safetensors` đã xác minh.
- Các thành phần chính thức còn lại được lưu cục bộ: scheduler, T5 encoder/tokenizer, cấu hình transformer và FLUX VAE.
- Loader chạy `local_files_only`, dùng `bfloat16`, CPU offload và giải phóng SD3.5/CatVTON trước khi nạp Chroma.
- Thêm `GET /api/chroma-status`, `POST /api/chroma-smoke` và điều khiển tương ứng trong giao diện quản lý model.
- Smoke cố định seed, ghi ảnh, SHA-256, thời gian và VRAM vào `workspace/review/chroma-smoke-*.json`.
- Model chỉ được xem là tích hợp hoàn tất khi dependency đầy đủ và smoke thực tế đạt.

## Bằng chứng thực thi

- Báo cáo: `workspace/review/chroma-smoke-20261013T164034314247Z.json`.
- Kết quả: đạt; ảnh 512 × 512, seed 433, 8 bước.
- Thời gian lần nạp đầu: 342,916 giây.
- Peak allocation do PyTorch ghi nhận: 17.148 MB khi dùng CPU offload.
- SHA-256 ảnh: `d7c6882f284256bb27124867912fc07a2fbe1fc54713f147d5b3c6a6399841a7`.
- Ảnh đầu ra là áo khoác xanh nền trung tính, đúng prompt, không rỗng và không lỗi cấu trúc nổi bật.

## Cấu hình smoke phát hành

- Kích thước: 512 × 512.
- Seed: 433.
- Số bước kỹ thuật ban đầu: 8.
- Guidance: 3.0.
- Prompt là ảnh sản phẩm áo khoác an toàn, không dùng dữ liệu nhận diện.

## So với Sprint 4S

Sprint 4S chỉ tải checkpoint transformer và đăng ký registry. Sprint 5G bổ sung toàn bộ dependency suy luận, loader biệt lập, quan sát tài nguyên, giao diện và cổng smoke có bằng chứng đầu ra.
