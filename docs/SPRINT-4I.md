# Sprint 4I — Phát hành an toàn và cấu hình model

## Đã triển khai

- Đường dẫn model SD3.5, CatVTON, VAE và pose có thể cấu hình qua `workspace/config.json`; biến môi trường vẫn có ưu tiên cao nhất.
- Ảnh trang phục đang chọn có thể được lưu làm tham chiếu chuyên biệt cho `upper_body`, `lower_body` hoặc `overall`.
- Trọng số hiệu chỉnh chỉ được kích hoạt khi có ít nhất 5 ảnh đã duyệt, 3 ảnh có nhãn lỗi và tiện ích A/B tăng tối thiểu 0,1 điểm.
- Benchmark ưu tiên `active-score-weights.json`; bản đề xuất chưa kiểm chứng không tự động ảnh hưởng kết quả chính thức.
- Bộ cài đặt Windows cho phép chọn thư mục ứng dụng và vị trí model SD3.5.
- Cập nhật và rollback chỉ thay mã ứng dụng; giữ nguyên `workspace`, model và môi trường Python.

## Cài đặt

```powershell
.\install-offline.ps1 -ReleasePath <goi-phat-hanh> -InstallPath <thu-muc-cai> -InpaintModelPath <thu-muc-model> -CreateDesktopShortcut
```

## Cập nhật và rollback

```powershell
.\update-offline.ps1 -ReleasePath <goi-moi> -InstallPath <thu-muc-cai>
.\rollback-offline.ps1 -BackupPath <thu-muc-cai>\workspace\version-backups\<moc-thoi-gian> -InstallPath <thu-muc-cai>
```

Mỗi lần cập nhật tạo bản mã nguồn cũ trong `workspace/version-backups`. Dữ liệu duyệt, mask, cấu hình và model không bị ghi đè.

## Cổng kích hoạt trọng số

Hiệu chỉnh chỉ tạo ứng viên `workspace/review/score-weights.json`. Nút **Kích hoạt trọng số đã kiểm chứng** mới tạo `active-score-weights.json`, và chỉ khi đủ dữ liệu duyệt cùng kết quả A/B tốt hơn. Với dữ liệu hiện tại 1/23 ảnh, hệ thống chủ động từ chối kích hoạt.

## Việc cần người dùng thực hiện

- Duyệt trực quan đủ 23 ảnh và gắn nhãn lỗi cho ảnh `retry` hoặc `rejected`.
- Chọn ảnh trang phục chuyên biệt cho `lower_body` và `overall`, sau đó lưu bằng nút mới.
- Chạy hiệu chỉnh, A/B và kích hoạt lại sau khi đủ bằng chứng.
