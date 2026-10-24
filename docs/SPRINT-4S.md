# Sprint 4S — Tải và đăng ký FLUX Chroma1-HD

## Kết quả

- Đã tải checkpoint chính thức `Chroma1-HD.safetensors` vào `models/flux/chroma1-hd`.
- Kích thước đã xác minh: `17.800.038.288` byte.
- SHA-256 đã xác minh: `d446d9695d08276f61e53653e025289dd96f7a489c27982a1fa54ecabc06642a`.
- Đã lưu model card `README.md` để tra cứu ngoại tuyến.
- Đã đăng ký model với ID `flux-chroma1-hd`, loại `text-to-image`, giấy phép `Apache-2.0`.

## Trạng thái tích hợp

Model được đăng ký ở trạng thái `downloaded-unintegrated`. Không có `configKey`, vì vậy giao diện quản lý có thể kiểm tra và liệt kê model nhưng không thể vô tình kích hoạt nó thay cho pipeline SD3.5 hiện tại.

Checkpoint đơn chứa transformer Chroma. Để suy luận trực tiếp trong ứng dụng vẫn cần bổ sung loader `ChromaPipeline` tương thích, các thành phần text encoder/tokenizer/VAE cần thiết, kiểm tra VRAM/RAM và một smoke test text-to-image an toàn.

## Nguồn

- Kho chính thức: https://huggingface.co/lodestones/Chroma1-HD
- Tệp checkpoint: https://huggingface.co/lodestones/Chroma1-HD/resolve/main/Chroma1-HD.safetensors

## Bước tiếp theo

Tích hợp một backend Chroma độc lập, không thay đổi backend SD3.5: kiểm kê dependency còn thiếu, nạp có offload, chạy một ảnh 512 px với seed cố định, ghi VRAM/RAM/thời gian và chỉ sau đó mới thêm nút kích hoạt.
