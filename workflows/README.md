# Workflows

Thư mục này được dành cho các định nghĩa workflow có phiên bản của AI Atelier. Khi được bổ sung, mỗi tệp JSON sẽ mô tả đầu vào, các bước xử lý và dữ liệu cần thiết cho một tác vụ chỉnh sửa ảnh.

## Workflow dự kiến

| Tệp | Mục đích |
| --- | --- |
| `replace-garment.json` | Thay trang phục trong vùng đã chọn |
| `remove-accessory.json` | Xóa phụ kiện và tái tạo vùng bị che |
| `infer-exposed-body.json` | Tái tạo phần cơ thể có thể lộ ra sau khi chỉnh trang phục |

Hiện repository chưa có ba tệp JSON này; các luồng tương ứng vẫn được triển khai trong mã ứng dụng và dịch vụ AI. README này ghi lại vị trí và quy ước dành cho lần tách workflow sau.

## Nguyên tắc chỉnh sửa

- Xem các tệp workflow là hợp đồng có phiên bản; thay đổi schema hoặc ý nghĩa bước xử lý phải đi kèm cập nhật mã đọc và kiểm thử liên quan.
- Dùng đường dẫn tương đối với repository, không ghi đường dẫn model hoặc tài khoản cụ thể của máy phát triển.
- Không thêm thông tin nhạy cảm, ảnh người dùng hoặc dữ liệu phát sinh trong `workspace`.
- Giữ đầu vào mask tương thích với quy ước của ứng dụng và bảo toàn vùng ngoài phạm vi chỉnh sửa.
- Chạy bộ kiểm thử workflow trước khi phát hành.

## Kiểm tra

Từ thư mục gốc dự án, chạy:

```powershell
node scripts/verify-workflow-release.js
pnpm test
```

Các workflow sinh ảnh phụ thuộc vào model cục bộ và dịch vụ AI. Kiểm tra cấu trúc chỉ xác nhận định dạng và hợp đồng; chất lượng kết quả vẫn cần được đánh giá trực quan trên bộ ảnh nghiệm thu.

Xem thêm [kiến trúc 3.0](../docs/ARCHITECTURE-3.0.md), [khả năng model](../docs/MODEL-CAPABILITIES.md) và [quy trình nâng cấp workflow](../docs/WORKFLOW-UPGRADE.md).
