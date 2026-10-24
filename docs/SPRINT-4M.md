# Sprint 4M — LoRA SD3.5 Phase 1

## Đã triển khai

- Registry LoRA offline tại `models/lora/registry.json`.
- Chỉ chấp nhận tệp `.safetensors` nằm bên trong `models/lora`.
- Kiểm tra base model SD3.5 và SHA-256 trước khi kích hoạt.
- Mỗi lượt tối đa hai adapter; weight được giới hạn từ 0 đến 1,5.
- Có thể cấu hình trước khi pipeline tải hoặc nạp–tháo động khi SD3.5 đang hoạt động.
- Giao diện hiển thị adapter sẵn sàng, chọn adapter, weight, bật hoặc tắt toàn bộ.
- Metadata inpainting ghi ID, weight và checksum của LoRA đang dùng.
- A/B sinh hai ảnh cùng seed: một bản base và một bản dùng LoRA; kết quả luôn yêu cầu duyệt trực quan.
- Gói mã nguồn chứa registry và hướng dẫn, nhưng không tự tải adapter từ Internet.

## Cấu trúc một mục registry

```json
{
  "id": "fabric-detail-v1",
  "name": "Fabric Detail v1",
  "file": "sd35/fabric-detail-v1.safetensors",
  "sha256": "<64 ký tự hex>",
  "baseModel": "sd35",
  "recommendedWeight": 0.75,
  "enabled": true,
  "source": "nguồn nội bộ hoặc URL nguồn",
  "license": "giấy phép"
}
```

## Trạng thái hiện tại

Registry đang rỗng nên không có LoRA nào được kích hoạt. Đây là trạng thái hợp lệ: SD3.5 tiếp tục chạy bằng trọng số gốc. Cần bổ sung adapter có nguồn và giấy phép rõ ràng trước khi benchmark A/B.
