---
name: deploy-vps
description: Triển khai, cập nhật và sao lưu bot tìm nguồn ảnh trên VPS bằng Docker Compose.
---

# Triển khai lên VPS

## Chuẩn bị
Clone repo lên VPS, copy `.env.example` thành `.env` rồi điền token Discord và các API key. Không commit `.env`.

## Chạy
```
docker compose up -d --build
docker compose logs -f bot
```
Log phải có dòng báo bot sẵn sàng; thử `/search` trong server. Container tự khởi động lại (`restart: unless-stopped`).

## Cập nhật
```
git pull
docker compose up -d --build
```
Bot tự drain các tác vụ đang chạy khi nhận SIGTERM trước khi dừng.

## Sao lưu
Dữ liệu nằm ở `data/bot.db` (mount từ `./data`). Sao lưu file này định kỳ, ví dụ `cp data/bot.db backup/bot-$(date +%F).db`.
