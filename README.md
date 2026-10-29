# 🔍 Discord Reverse Image Search Bot

Bot Discord tìm nguồn ảnh ngược (Reverse Image Search) tốc độ cao, hỗ trợ tìm kiếm **Anime, Manga/Doujinshi, Fanart/2D Illust, Cosplay và Phim/Ảnh thực tế (3D)** — bao gồm cả nội dung **SFW và NSFW** — hoạt động **hoàn toàn miễn phí (Free), không giới hạn (Unlimited) và phản hồi tức thì (Zero-Delay)**.

---

## ✨ Tính năng nổi bật

- **⚡ Thực thi song song (Zero-Delay Parallel Waves):**
  - **Đợt 1 (Wave 1):** Gọi đồng thời `SauceNAO`, `Danbooru + IQDB.org` và `trace.moe`. Trả kết quả ngay lập tức khi tìm thấy nguồn khớp độ tin cậy cao (`source_found`).
  - **Đợt 2 (Wave 2):** Tự động fallback sang `Yandex Images` nếu các engine chuyên biệt ở Đợt 1 chưa tìm ra nguồn gốc.
- **💸 Hoàn toàn Free & Không cần thẻ tín dụng:**
  - Chỉ yêu cầu duy nhất thông tin Bot Discord (`DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`).
  - Không bắt buộc API trả phí như SerpApi hay Bright Data (vẫn hỗ trợ làm fallback tùy chọn nếu bạn có sẵn key).
- **🔞 Hỗ trợ đầy đủ ảnh NSFW (2D & 3D) với Quy tắc Hiển thị An toàn:**
  - **Tìm kiếm mọi nơi:** Dù người dùng gọi lệnh ở kênh thường hay kênh NSFW, bot vẫn mở khóa bộ lọc (`hide=0` trên SauceNAO, `family=no` trên Yandex, và đa sàn Booru trên IQDB) để tìm ra đúng link nguồn gốc.
  - **Kiểm soát Preview theo kênh:**
    - **Tại kênh thường (Non-NSFW):** Tự động ẩn ảnh thumbnail nhạy cảm và ẩn video preview để đảm bảo an toàn cộng đồng, chỉ trả về tên tác phẩm, tác giả và link nguồn.
    - **Tại kênh 18+ (Age-Restricted / NSFW):** Hiển thị đầy đủ ảnh thumbnail và video clip cắt cảnh.
- **🔄 Cơ chế chống Rate-Limit & Tự động Fallback:**
  - **SauceNAO:** Hỗ trợ xoay vòng nhiều API key (`SAUCENAO_API_KEYS=key1,key2,...`) kết hợp tự động cào giao diện Web (`parseSauceNaoHtml`) khi không cấu hình key hoặc khi hết quota API.
  - **Danbooru + IQDB.org:** Kết hợp API Danbooru và tìm kiếm trực tiếp trên `iqdb.org` (bao phủ cùng lúc Danbooru, Gelbooru, Sankaku Complex, Yande.re, Konachan, Zerochan, Anime-Pictures).
  - **Yandex Direct:** Truy vấn trực tiếp `yandex.com/images` kèm chế độ tắt bộ lọc gia đình (`family=no`), không tốn phí qua bên thứ ba.
- **🛡️ Tích hợp sẵn Cloudflare WARP Proxy (Docker):**
  - Đi kèm container `caomingjun/warp` tự động định tuyến lưu lượng tìm kiếm qua mạng Cloudflare WARP, giúp tránh bị chặn IP (403/429/Captcha) khi chạy trên VPS Linux/Windows, trong khi kết nối tới Discord Gateway vẫn đi trực tiếp với độ trễ thấp nhất.

---

## 🧠 Kiến trúc & Chế độ tìm kiếm (`type`)

Bot phân loại kết quả thành 3 cấp độ tin cậy:
1. **`source_found`**: Tìm thấy nguồn gốc chuẩn xác (Pixiv, Twitter/X, Danbooru, Gelbooru, Yande.re, Sankaku, Fakku, e-hentai, AniList, IMDb, v.v. với độ tương đồng vượt ngưỡng).
2. **`best_guess`**: Kết quả gần đúng nhất khi độ tương đồng ở mức trung bình hoặc chỉ tìm thấy qua trang tổng hợp.
3. **`not_found`**: Không tìm thấy kết quả phù hợp.

### Thứ tự ưu tiên theo chế độ (`type`):

| Chế độ (`type`) | Đợt 1 (Chạy song song) | Đợt 2 (Fallback khi chưa đạt `source_found`) | Phù hợp cho |
| :--- | :--- | :--- | :--- |
| **`auto`** *(Mặc định)* | `SauceNAO` + `Danbooru/IQDB` + `trace.moe` | `Yandex Images` | Mọi loại ảnh (tự động nhận diện 2D, Anime, Manga, 3D) |
| **`anime`** | `trace.moe` + `SauceNAO` | `Yandex Images` | Ảnh chụp màn hình tập phim Anime (trả kèm số tập, mốc thời gian & video preview) |
| **`art`** | `SauceNAO` + `Danbooru/IQDB` | `Yandex Images` | Tranh vẽ 2D, Fanart, Manga, Doujinshi, Hentai/Illust |
| **`movie`** | `Yandex Images` | `trace.moe` | Phim người đóng, Cosplay, Idol, Ảnh đời thực (3D) |

---

## 🚀 Hướng dẫn Cài đặt & Chạy Bot

### Bước 1: Chuẩn bị Discord Bot
1. Truy cập [Discord Developer Portal](https://discord.com/developers/applications) và tạo một Application mới.
2. Tại mục **Bot**, nhấn **Reset Token** để lấy `DISCORD_TOKEN`.
3. Tại mục **General Information**, copy `APPLICATION ID` làm `DISCORD_APPLICATION_ID`.
4. Bật **Developer Mode** trong Discord (User Settings -> Advanced -> Developer Mode), chuột phải vào Server của bạn chọn **Copy Server ID** để lấy `DISCORD_GUILD_ID`.
5. Mời bot vào Server với quyền `applications.commands`, `Send Messages`, `Embed Links`, `Attach Files`.

---

### Bước 2: Tạo file cấu hình `.env`
Sao chép file `.env.example` thành `.env`:

```bash
cp .env.example .env
```

Mở file `.env` và điền thông tin Discord của bạn:

```dotenv
# Bắt buộc
DISCORD_TOKEN=your_discord_bot_token_here
DISCORD_APPLICATION_ID=your_application_id_here
DISCORD_GUILD_ID=your_guild_id_here

# Tùy chọn (Có thể để trống — Bot tự động dùng Web Fallback / IQDB / Yandex Direct miễn phí)
SAUCENAO_API_KEY=
SAUCENAO_API_KEYS=
DANBOORU_LOGIN=
DANBOORU_API_KEY=
TRACEMOE_API_KEY=
BRIGHTDATA_API_KEY=
SERPAPI_API_KEY=

# Cấu hình không giới hạn & không delay (Mặc định đã bật sẵn)
USER_COOLDOWN_MS=0
USER_DAILY_SEARCHES=1000000
USER_DAILY_YANDEX=1000000
UNLIMITED_GATES=true
PARALLEL_SEARCH=true
ALLOW_CONCURRENT_USER_SEARCHES=true
```

> **💡 Mẹo tối ưu SauceNAO:** Bạn có thể đăng ký miễn phí một hoặc nhiều tài khoản tại [saucenao.com](https://saucenao.com/user.php?page=search-api) và điền danh sách key cách nhau bởi dấu phẩy vào `SAUCENAO_API_KEYS=key1,key2,key3`. Bot sẽ tự động xoay vòng key và chuyển sang chế độ cào Web nếu toàn bộ key chạm giới hạn.

---

### Bước 3: Khởi chạy Bot

#### Cách 1: Chạy bằng Docker Compose kèm Cloudflare WARP (Khuyên dùng cho VPS)
Cách này tự động dựng container Cloudflare WARP làm proxy xuất mạng cho các công cụ tìm kiếm, giúp không bị chặn IP VPS:

```bash
# Đăng ký Slash Commands & Context Menu lên Discord Server
docker compose run --rm bot node --experimental-strip-types src/discord/register-commands.ts

# Khởi chạy toàn bộ hệ thống (Bot + Cloudflare WARP) ở chế độ chạy ngầm
docker compose up -d --build

# Xem log hoạt động
docker compose logs -f bot
```

#### Cách 2: Chạy trực tiếp bằng Node.js 24+
Yêu cầu cài đặt **Node.js >= 24.0.0** (hỗ trợ chạy trực tiếp TypeScript không cần bước build):

```bash
# 1. Cài đặt thư viện
npm install

# 2. Đăng ký Slash Commands & Context Menu lên Discord
npm run register-commands

# 3. Khởi động bot
npm start
```

---

## 🎮 Cách sử dụng trên Discord

### 1. Tìm bằng Menu Chuột Phải (Nhanh nhất)
- **Trên máy tính:** Chuột phải vào tin nhắn bất kỳ có chứa ảnh -> chọn **Apps** -> **Tìm nguồn ảnh**.
- **Trên điện thoại:** Nhấn giữ vào tin nhắn có chứa ảnh -> chọn **Apps** -> **Tìm nguồn ảnh**.

### 2. Tìm bằng lệnh `/search`
Gõ `/search` tại bất kỳ kênh chat nào với các tham số:
- `image`: Tải trực tiếp file ảnh từ thiết bị của bạn lên.
- `url`: Dán đường dẫn URL trực tiếp của bức ảnh (`https://...`).
- `type` *(Tùy chọn)*: Chọn chế độ ưu tiên (`Auto`, `Anime`, `Art / Illust`, hoặc `Movie / Live-action`).

### 3. Các nút điều khiển tương tác trên kết quả
Sau khi bot trả về kết quả, người gọi lệnh có thể sử dụng các nút bấm bên dưới tin nhắn:
- **🔗 Nguồn chính:** Mở nhanh trang gốc chứa bức ảnh.
- **🔎 Thử thêm nguồn khác:** Yêu cầu bot chạy tiếp các engine còn lại (ví dụ ép chạy thêm Yandex hoặc các engine dự phòng) để tìm thêm góc nhìn khác.
- **🌐 Mở tìm kiếm ngoài:** Nhận danh sách đường dẫn một-chạm tới Google Lens, Yandex Images, SauceNAO, IQDB và trace.moe cho bức ảnh đó.
- **🗑️ Xoá:** Thu hồi tin nhắn kết quả tìm kiếm.

### 4. Các lệnh tiện ích khác
- `/quota`: Kiểm tra hạn mức tìm kiếm hiện tại và trạng thái hoạt động của từng Engine (`trace.moe`, `SauceNAO`, `Danbooru/IQDB`, `Yandex`).
- `/help`: Xem hướng dẫn sử dụng nhanh ngay trong Discord.

---

## 📂 Cấu trúc thư mục

```text
reverse-image-search-bot/
├── docs/
│   ├── Discord_Reverse_Image_Search_Plan.md  # Tài liệu thiết kế ban đầu
│   └── superpowers/                          # Kế hoạch & thông số kỹ thuật chi tiết
├── src/
│   ├── app.ts                                # Khởi tạo và kết nối toàn bộ module
│   ├── index.ts                              # Điểm vào chính (Entrypoint) của tiến trình
│   ├── config.ts                             # Đọc & kiểm tra biến môi trường (.env)
│   ├── discord/                              # Xử lý sự kiện Discord, lệnh, nút bấm & render Embed
│   ├── engines/                              # Tích hợp các công cụ tìm kiếm:
│   │   ├── tracemoe.ts                       #   - trace.moe (Anime)
│   │   ├── saucenao.ts                       #   - SauceNAO (API multi-key + Web HTML fallback)
│   │   ├── danbooru.ts                       #   - Danbooru API + IQDB.org multi-booru
│   │   └── yandex/                           #   - Yandex Direct HTML + Bright Data / SerpApi
│   ├── media/                                # Kiểm tra SSRF, tải ảnh, chuyển đổi định dạng bằng sharp
│   ├── search/                               # Điều phối luồng chạy song song (Wave 1/Wave 2) & chấm điểm
│   ├── limits/                               # Quản lý Concurrency Gates, Circuit Breaker & Rate Limit
│   └── logging/                              # Ghi log cấu trúc JSON (Pino)
├── test/                                     # Bộ kiểm thử tự động (Unit & Integration Tests)
├── Dockerfile                                # Cấu hình đóng gói image Node.js 24 Alpine
└── docker-compose.yml                        # Cấu hình chạy Bot + Cloudflare WARP sidecar
```

---

## 🧪 Phát triển & Kiểm thử

```bash
# Kiểm tra kiểu dữ liệu TypeScript
npm run typecheck

# Chạy toàn bộ bộ test (220+ test cases)
npm test
```
