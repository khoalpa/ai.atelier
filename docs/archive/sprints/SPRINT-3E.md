# Sprint 3E — Persistent review workflow

## Đã triển khai

- Trạng thái `pending`, `approved`, `retry`, `rejected` được lưu trong `workspace/review/review-state.json`.
- Hàng đợi audit lọc theo trạng thái và tiếp tục được sau khi khởi động lại ứng dụng.
- Kết quả được chọn tự động hoặc thủ công được liên kết với bản ghi duyệt.
- Thanh trượt so sánh ảnh trước–sau trong hộp kết quả.
- Xuất manifest chỉ chứa các mục đã chấp nhận.
- Manifest kiểm tra sự tồn tại của từng `selected.png` trước khi bàn giao.
- Mask tự động loại trừ vùng đầu/mặt phía trên của người được chọn; crop giữ nguyên các nhân vật khác.

## Nghiệm thu

- Đã lưu `characters/c001.png` ở trạng thái `approved`.
- Đọc lại trạng thái từ đĩa thành công.
- Manifest có một mục được duyệt và `selectedExists: true`.
- Manifest: `workspace/review/approved-manifest-2026-10-13T07-17-47-419Z.json`.
- Kết quả liên kết: `workspace/outputs/tryon_c001_20261013T071041818285Z/selected.png`.

## Giới hạn

- Trạng thái duyệt là một tệp JSON cục bộ; chưa có khóa ghi cho nhiều người dùng đồng thời.
- Thanh trượt so sánh dùng ảnh nguồn và kết quả cuối, chưa có zoom đồng bộ.
- Bảo vệ tay vẫn phụ thuộc mask SAM và crop; chưa có keypoint tay chuyên biệt.
