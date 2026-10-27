---
name: phase0-verify
description: Chạy các script giai đoạn 0 để lấy fixture thật từ các engine (trace.moe, SauceNAO, Danbooru, Yandex), ghi kết quả vào spec và xác minh lại adapter.
---

# Xác minh giai đoạn 0

## Khi nào chạy
Khi có API key mới, khi engine đổi định dạng phản hồi, hoặc trước khi bật test fixture thật của Yandex.

## Lệnh
Cần `.env` có key tương ứng và một URL ảnh Discord (cdn.discordapp.com / media.discordapp.net).

```
node --env-file=.env scripts/phase0/tracemoe.ts <discord-image-url>
node --env-file=.env scripts/phase0/saucenao.ts <discord-image-url> [hide-level] [--movies]
node --env-file=.env scripts/phase0/danbooru.ts <discord-image-url>
node --env-file=.env scripts/phase0/yandex-serpapi.ts <discord-image-url>
node --env-file=.env scripts/phase0/yandex-brightdata.ts <discord-image-url>
```

Chạy script trace.moe (`/me`) trên VPS, vì quota tính theo IP của máy chạy.

Fixture được ghi vào `test/fixtures/<engine>/` (đã tự che key và tham số ký `ex`/`is`/`hm`).

## Sau khi chạy
1. Kiểm tra fixture trước khi commit: `grep -r "hm=" test/fixtures` phải không còn kết quả (và không có key/secret nào).
2. Ghi kết quả vào spec `docs/superpowers/specs/2026-10-27-discord-reverse-image-search-bot-design.md` ở mục "## 17. Kết quả giai đoạn 0". Mục này chưa tồn tại: hãy tạo ở cuối spec.
3. Chạy lại test adapter: `npm test`.
4. Bật test fixture thật của Yandex đang bị skip, rồi chạy lại `npm test`.
5. Chạy smoke: `node --env-file=.env scripts/smoke-engine.ts <engine> <discord-image-url>`.
