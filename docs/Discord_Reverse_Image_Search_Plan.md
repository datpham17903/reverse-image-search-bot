# Kế hoạch Tổng thể: Discord Bot Reverse Image Search (v3.0)

> Tài liệu đặc tả chi tiết: `docs/superpowers/specs/2026-10-27-discord-reverse-image-search-bot-design.md`  
> Kế hoạch triển khai chi tiết: `docs/superpowers/plans/2026-10-27-discord-reverse-image-search-bot.md`

- **Phiên bản:** 3.0, cập nhật ngày 29/10/2026 (giờ Việt Nam).
- **Mục tiêu:** Tìm nguồn ảnh Anime, Manga/Doujinshi, Fanart/2D Illust, Cosplay và Phim/Ảnh thực tế (3D) — bao gồm cả nội dung **SFW và NSFW** — ngay trong server Discord; **hoàn toàn miễn phí (0 đồng)**, **không giới hạn (Unlimited)** và **không độ trễ (Zero-Delay)**.

---

## 1. Những nâng cấp đột phá ở bản v3.0 (So với v2.0)

1. **Thực thi song song theo đợt (Parallel Waves — Zero-Delay):**
   - Thay vì gọi tuần tự từng engine khiến người dùng phải đợi cộng dồn 15–30 giây, bot chia luồng tìm kiếm thành **2 Đợt (Waves)**:
     - **Đợt 1 (Wave 1):** Chạy song song cùng lúc `SauceNAO`, `Danbooru + IQDB.org` và `trace.moe`. Trả kết quả ngay lập tức (dưới 1–3 giây) nếu bất kỳ engine nào tìm ra nguồn chính xác (`source`).
     - **Đợt 2 (Wave 2):** Chỉ khi Đợt 1 chưa tìm ra nguồn mức `source`, bot mới tự động gọi `Yandex Images` để tìm kiếm diện rộng (3D, Cosplay, Movie, bài đăng mạng xã hội).
2. **Hoàn toàn miễn phí & Không bắt buộc API Key bên thứ ba:**
   - Chỉ cần 3 biến môi trường của Discord (`DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`) để khởi chạy toàn bộ tính năng.
   - Bổ sung **SauceNAO Web HTML Fallback** (`parseSauceNaoHtml`), **IQDB.org Multi-Booru** (`parseIqdbHtml`) và **Yandex Direct** (`yandexViaDirect`) hoạt động không cần thẻ tín dụng hay tài khoản trả phí.
   - Hỗ trợ xoay vòng nhiều key SauceNAO (`SAUCENAO_API_KEYS=key1,key2,...`) và giữ nguyên hỗ trợ `Bright Data` / `SerpApi` làm đường dự phòng tùy chọn.
3. **Mở khóa hoàn toàn ảnh NSFW (2D & 3D) kèm Quy tắc Hiển thị An toàn:**
   - Luôn tìm kiếm đầy đủ nguồn NSFW ở mọi kênh (`hide=0` trên SauceNAO, `family=no` kèm cookie `yp=1999999999.sp.family%3A0` trên Yandex Direct, và 7 sàn Booru lớn trên IQDB.org).
   - **Kiểm soát hiển thị theo kênh (`previewAllowed`):**
     - **Kênh thường (Non-NSFW):** Tự động ẩn ảnh thumbnail và ẩn video preview đối với kết quả nhạy cảm (`adult: true` hoặc từ Yandex), chỉ hiện tên tác phẩm, tác giả và link nguồn.
     - **Kênh 18+ (NSFW):** Hiển thị đầy đủ ảnh xem trước lớn và link video đoạn cảnh.
4. **Không giới hạn lượt dùng & Không thời gian chờ (Unlimited Mode):**
   - Mặc định tắt cooldown (`USER_COOLDOWN_MS=0`), nâng hạn mức ngày lên `1.000.000`, cho phép một người gửi nhiều ảnh cùng lúc (`ALLOW_CONCURRENT_USER_SEARCHES=true`) và mở rộng cổng đồng thời (`UNLIMITED_GATES=true`).
5. **Tích hợp sẵn Cloudflare WARP Proxy trong Docker:**
   - Đi kèm container `caomingjun/warp:latest` trong `docker-compose.yml` giúp che IP máy chủ VPS khi gọi Yandex, IQDB, SauceNAO, tránh lỗi 403/429/Captcha mà không làm chậm kết nối tới Discord (`NO_PROXY`).

---

## 2. Cách người dùng gửi ảnh

### 2.1. Lệnh `/search`
| Trường | Kiểu | Bắt buộc | Ghi chú |
| :--- | :--- | :--- | :--- |
| `image` | ATTACHMENT (`file_types: ["image"]`) | Có | Hỗ trợ `.png`, `.gif`, `.jpg`, `.jpeg`, `.webp`, `.avif`, kiểm tra thực tế bằng `sharp` |
| `mode` | STRING: `auto`, `anime`, `art`, `movie` | Không | Mặc định `auto` |
| `private` | BOOLEAN | Không | `true` = chỉ người gọi thấy kết quả (ephemeral) |

### 2.2. Context Menu `"Tìm nguồn ảnh"`
- Chuột phải vào tin nhắn bất kỳ (hoặc nhấn giữ trên điện thoại) → **Apps** → **Tìm nguồn ảnh**.
- Thứ tự trích xuất ảnh: `attachment` → `embed.image` → `embed.thumbnail` (ảnh embed chỉ tải qua `proxy_url` của Discord để chống SSRF).
- Nếu tin nhắn có 1 ảnh: tìm ngay bằng `auto`. Nếu có nhiều ảnh: hiện menu chọn ảnh.

---

## 3. Hệ thống Engine & Đa đường cung cấp (Providers)

| Engine | Providers | Thế mạnh | Cơ chế hoạt động |
| :--- | :--- | :--- | :--- |
| **SauceNAO** | `saucenao` | Fanart 2D, Pixiv, Twitter/X, Doujinshi, H-Manga, Anime, Movies/Shows | Xoay vòng danh sách `SAUCENAO_API_KEYS` (với `hide=0`) + tự động chuyển sang cào Web HTML (`https://saucenao.com/search.php`) khi không có key hoặc hết quota. |
| **Danbooru & IQDB** | `danbooru`, `iqdb` | Tranh 2D Anime/Manga/NSFW trên các Booru | Gọi API Danbooru (nếu có key hoặc public) kết hợp upload trực tiếp lên `https://iqdb.org/` bao phủ đồng thời: Danbooru, Konachan, Yande.re, Gelbooru, Sankaku Complex, Zerochan, Anime-Pictures. |
| **trace.moe** | `tracemoe` | Cảnh cắt từ tập phim Anime | Gửi ảnh JPEG chuẩn hóa lên `api.trace.moe/search?anilistInfo&cutBorders=1`, trả về tên Anime, số tập, mốc thời gian `mm:ss` và video preview. |
| **Yandex Images** | `yandex_direct`, `brightdata`, `serpapi` | Ảnh 3D, Phim người đóng, Cosplay, Idol, Ảnh cắt nhỏ / chỉnh sửa nặng | Ưu tiên gọi trực tiếp `yandex.com/images` với `family=no` (qua Cloudflare WARP proxy khi chạy Docker). Tự động fallback sang Bright Data và SerpApi nếu được cấu hình key. |

---

## 4. Luồng tìm kiếm theo chế độ (`mode`)

| Chế độ | Đợt 1 (Chạy song song cùng lúc) | Đợt 2 (Fallback khi Đợt 1 chưa có `source`) |
| :--- | :--- | :--- |
| **`auto`** | `saucenao` + `danbooru` (`danbooru` & `iqdb`) + `tracemoe` | `yandex` (`yandex_direct` → `brightdata` → `serpapi`) |
| **`anime`** | `tracemoe` + `saucenao` | `yandex` |
| **`art`** | `saucenao` + `danbooru` (`danbooru` & `iqdb`) | `yandex` |
| **`movie`** | `yandex` (`yandex_direct` → `brightdata` → `serpapi`) | `saucenao` (chỉ index Movies & Shows) |

### Ngưỡng phân loại kết quả:
- **SauceNAO:** `NGUỒN` (`similarity ≥ 90`), `CÓ THỂ LÀ` (`70 ≤ similarity < 90`).
- **trace.moe:** `NGUỒN` (`similarity ≥ 0.92`), `CÓ THỂ LÀ` (`0.85 ≤ similarity < 0.92`).
- **Danbooru / IQDB:** `NGUỒN` (`score ≥ 90`), `CÓ THỂ LÀ` (`70 ≤ score < 90`).
- **Yandex:** `CÓ THỂ LÀ` khi trang đích thuộc danh sách domain nguồn chuẩn (`KNOWN_SOURCE_DOMAINS`: Pixiv, X/Twitter, Danbooru, Gelbooru, Yande.re, Konachan, Sankaku, Fakku, E-Hentai, ExHentai, Kemono, Fantia, Fanbox, ArtStation, DeviantArt, Newgrounds, Rule34, E621, IMDb, TMDB, MAL, AniList…); các trang khác xếp loại `LIÊN QUAN`.

---

## 5. Quy tắc hiển thị nội dung NSFW theo kênh

| Loại kênh Discord | Hành vi tìm kiếm | Hành vi hiển thị Embed |
| :--- | :--- | :--- |
| **Kênh thường (Non-NSFW)** | Tìm kiếm **đầy đủ** cả nguồn SFW lẫn NSFW | - **Kết quả SFW (`adult === false`):** Hiện đầy đủ ảnh xem trước.<br>- **Kết quả NSFW (`adult === true`) hoặc không rõ nhãn (`adult === null` từ Yandex):** **Ẩn ảnh xem trước & ẩn video preview**, chỉ hiện tên tác phẩm, tác giả và link chữ dẫn tới nguồn. |
| **Kênh 18+ (`nsfw: true`)** | Tìm kiếm **đầy đủ** cả nguồn SFW lẫn NSFW | Hiện **đầy đủ** ảnh xem trước lớn (Embed Image) và link video preview cho mọi kết quả. |

---

## 6. Kiến trúc thư mục & Vận hành

```text
src/
  index.ts                 Khởi động bot, đăng ký lệnh guild, đồng bộ định kỳ, tắt an toàn (SIGTERM)
  app.ts                   Khởi tạo và kết nối toàn bộ module
  config.ts                Đọc và kiểm tra biến môi trường (.env) bằng Zod
  discord/                 Xử lý /search, menu "Tìm nguồn ảnh", /quota, /help, nút bấm, render Embed
  search/                  Orchestrator chạy song song theo đợt (flow.ts, orchestrator.ts, runner.ts, tiers.ts)
  engines/                 Adapters: tracemoe.ts, saucenao.ts, danbooru.ts (kèm IQDB), yandex/ (direct, brightdata, serpapi)
  limits/                  Gates đồng thời, circuit breaker (health.ts), hạn mức người dùng
  images/                  Kiểm tra host Discord, tải stream giới hạn 10 MiB, chuẩn hóa ảnh bằng sharp
  store/                   SQLite (node:sqlite): cache 30 ngày, thống kê lượt gọi, trạng thái nhà cung cấp
```

### Triển khai với Docker Compose + Cloudflare WARP:
```bash
# Chạy ngầm cả Bot và Cloudflare WARP Proxy
docker compose up -d --build

# Xem log
docker compose logs -f bot
```
