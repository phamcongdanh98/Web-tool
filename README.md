# WEB TOOL PDF — Docker/Hosting/VPS

Bộ công cụ PDF dùng Node.js, Fastify, MuPDF.js và pdf-lib. Bản này được chuẩn bị để:

- Chạy trực tiếp trên Windows/macOS/Linux.
- Deploy thử bằng Docker trên Render hoặc Railway.
- Chuyển lên VPS bằng Docker Compose.
- Gắn tên miền và HTTPS tự động bằng Caddy khi chạy VPS.

## 1. Chạy trực tiếp

```bash
npm ci
cp .env.example .env
npm run dev
```

Windows PowerShell:

```powershell
npm ci
Copy-Item .env.example .env
npm run dev
```

Mở `http://localhost:3000`.

## 2. Chạy bằng Docker

```bash
docker build -t web-tool-pdf .
docker run --rm -p 3000:3000 \
  -e MAX_UPLOAD_MB=20 \
  -e MAX_PDF_PAGES=200 \
  -e MAX_CONCURRENT_JOBS=1 \
  web-tool-pdf
```

Windows PowerShell:

```powershell
docker build -t web-tool-pdf .
docker run --rm -p 3000:3000 `
  -e MAX_UPLOAD_MB=20 `
  -e MAX_PDF_PAGES=200 `
  -e MAX_CONCURRENT_JOBS=1 `
  web-tool-pdf
```

Kiểm tra trạng thái:

```text
http://localhost:3000/api/health
```

## 3. Docker Compose — máy cá nhân hoặc VPS chưa gắn tên miền

```bash
cp .env.example .env
docker compose up -d --build
docker compose ps
docker compose logs -f
```

Dừng:

```bash
docker compose down
```

Xóa cả file tạm còn lại:

```bash
docker compose down -v
```

`compose.yml` lưu file tạm trong Docker volume trên ổ đĩa, không dùng `tmpfs`, nhằm tránh file PDF chiếm trực tiếp RAM.

## 4. Deploy thử trên Render

1. Đưa toàn bộ dự án lên GitHub.
2. Trên Render chọn **New → Blueprint** và chọn repository.
3. Render đọc `render.yaml` và build từ `Dockerfile`.
4. Chờ trạng thái deploy chuyển sang Live.

Cấu hình miễn phí đã được giới hạn:

```text
MAX_UPLOAD_MB=20
MAX_PDF_PAGES=200
MAX_CONCURRENT_JOBS=1
MAX_QUEUE_SIZE=3
NODE_OPTIONS=--max-old-space-size=384
```

Hosting miễn phí chỉ nên dùng PDF nhỏ. MuPDF và quá trình dựng PDF có thể dùng thêm bộ nhớ ngoài V8 heap.

## 5. Deploy thử trên Railway

1. Đưa dự án lên GitHub.
2. Railway → **New Project → Deploy from GitHub Repo**.
3. Railway tự đọc `railway.json` và `Dockerfile`.
4. Thêm các biến môi trường phù hợp.
5. Chọn **Generate Domain** để tạo địa chỉ công khai.

Khuyến nghị thử nghiệm:

```text
HOST=0.0.0.0
MAX_UPLOAD_MB=20
MAX_PDF_PAGES=200
MAX_CONCURRENT_JOBS=1
MAX_QUEUE_SIZE=3
REQUEST_TIMEOUT_MS=600000
NODE_OPTIONS=--max-old-space-size=384
```

Không cần đặt cứng `PORT`; Render/Railway tự cung cấp biến này.

## 6. Deploy lên VPS có tên miền và HTTPS

Yêu cầu:

- VPS đã cài Docker Engine và Docker Compose Plugin.
- Tên miền đã trỏ bản ghi A về IP VPS.
- Mở cổng 80 và 443 trên firewall.

Tạo `.env`:

```text
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
TEMP_ROOT=/tmp/web-tool-pdf
MAX_UPLOAD_MB=100
MAX_PDF_PAGES=500
MAX_CONCURRENT_JOBS=1
MAX_QUEUE_SIZE=10
REQUEST_TIMEOUT_MS=1800000
LOG_LEVEL=info
NODE_OPTIONS=--max-old-space-size=1536
CONTAINER_MEMORY_LIMIT=2g
CONTAINER_CPU_LIMIT=2.0
DOMAIN=pdf.tenmiencuaban.com
ACME_EMAIL=email-cuaban@example.com
```

Khởi động:

```bash
docker compose -f compose.yml -f compose.vps.yml up -d --build
```

Caddy sẽ tự xin và gia hạn chứng chỉ HTTPS cho `DOMAIN`.

Xem log:

```bash
docker compose -f compose.yml -f compose.vps.yml logs -f
```

Cập nhật code:

```bash
git pull
docker compose -f compose.yml -f compose.vps.yml up -d --build
```

## 7. Cấu hình tài nguyên

### Hosting miễn phí khoảng 512 MB RAM

```text
MAX_UPLOAD_MB=10–20
MAX_PDF_PAGES=100–200
MAX_CONCURRENT_JOBS=1
MAX_QUEUE_SIZE=3
NODE_OPTIONS=--max-old-space-size=320 hoặc 384
```

### VPS 4 GB RAM

```text
MAX_UPLOAD_MB=80–100
MAX_PDF_PAGES=500
MAX_CONCURRENT_JOBS=1
MAX_QUEUE_SIZE=10
CONTAINER_MEMORY_LIMIT=2g
NODE_OPTIONS=--max-old-space-size=1536
```

### VPS 8 GB RAM

```text
MAX_UPLOAD_MB=100–150
MAX_PDF_PAGES=800–1000
MAX_CONCURRENT_JOBS=1
MAX_QUEUE_SIZE=15
CONTAINER_MEMORY_LIMIT=4g
NODE_OPTIONS=--max-old-space-size=3072
```

Chỉ tăng `MAX_CONCURRENT_JOBS=2` sau khi đã đo RAM với PDF thực tế.

## 8. Các file triển khai

```text
Dockerfile                 Image production, chạy bằng user không phải root
.dockerignore              Loại node_modules, .env, log và ZIP khỏi image
compose.yml                Chạy app và giới hạn RAM/CPU
compose.vps.yml            Thêm Caddy, domain và HTTPS cho VPS
deploy/caddy/Caddyfile     Reverse proxy và giới hạn request body
render.yaml                Cấu hình Render Blueprint
railway.json               Cấu hình Railway
scripts/healthcheck.js     Docker/hosting health check
.env.example               Mẫu biến môi trường
```

## 9. Cấu trúc tính năng

```text
src/features/compress-pdf/
├── compress-pdf.route.js
├── compress-pdf.controller.js
├── compress-pdf.service.js
├── compress-pdf.options.js
└── compression-engine.js
```

Khi thêm công cụ:

```text
src/features/merge-pdf/
src/features/split-pdf/
src/features/pdf-to-image/
src/features/image-to-pdf/
```

Sau đó đăng ký module mới trong `src/routes/api.routes.js`.

## 10. Lưu ý về nén hiện tại

Engine hiện raster hóa trang thành JPEG. Phù hợp với PDF scan và nén mạnh, nhưng có thể làm mất:

- Khả năng tìm kiếm/chọn chữ.
- Form, liên kết và chú thích.
- Nội dung vector.

Nên bổ sung engine giữ text/vector trước khi sử dụng như một dịch vụ PDF hoàn chỉnh.


## Chẩn đoán lỗi và theo dõi RAM

Bản này ghi log bộ nhớ định kỳ và theo từng giai đoạn nén. Các trường quan trọng:

- `rssMb`: tổng RAM tiến trình Node.js đang giữ.
- `heapUsedMb`: heap JavaScript đang sử dụng.
- `externalMb`: bộ nhớ ngoài heap, gồm Buffer và một phần thư viện native/WASM.
- `arrayBuffersMb`: bộ nhớ ArrayBuffer.
- `cgroupUsedMb`: RAM toàn container đang sử dụng trên Docker/Render.
- `cgroupLimitMb`: giới hạn RAM container nếu nền tảng cung cấp.
- `cgroupUsagePercent`: tỷ lệ RAM container đã sử dụng.

Biến môi trường:

```env
MEMORY_LOG_INTERVAL_MS=10000
MEMORY_WARNING_PERCENT=80
PROGRESS_LOG_EVERY_PAGES=5
```

Nếu Render dừng container bằng SIGKILL do hết RAM, Node.js không thể ghi log sau cùng. Hãy xem dòng `Cảnh báo RAM container đang cao` hoặc `Theo dõi RAM định kỳ` ngay trước lúc server khởi động lại.
