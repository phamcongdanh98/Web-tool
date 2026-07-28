# WEB TOOL PDF V4 – sửa lỗi HTTP 502

## Thay đổi chính

- Chuyển nén PDF sang tác vụ nền có `jobId`.
- Upload trả về ngay, không giữ request chờ 5–10 phút.
- Frontend tự hỏi tiến độ mỗi 2 giây.
- Chỉ tải PDF khi worker đã tạo xong file.
- Kết quả được giữ tạm để có thể tải lại.
- Tự xóa tác vụ/file hết hạn.
- Giới hạn số tác vụ đang lưu để tránh đầy ổ đĩa.
- Giữ worker riêng và memory guard của bản RAM Safe.

## API

- `POST /api/pdf/compress/jobs`
- `GET /api/pdf/compress/jobs/:jobId`
- `GET /api/pdf/compress/jobs/:jobId/download`
- `DELETE /api/pdf/compress/jobs/:jobId`

## Cập nhật lên Render

Chép đè bản V4 vào repository rồi chạy:

```powershell
git add .
git commit -m "Switch PDF compression to background jobs"
git push
```
