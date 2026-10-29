# Spec: Bot Discord tìm nguồn ảnh (v3.0 — Free, Unlimited & Zero-Delay)

- **Ngày cập nhật:** 29/10/2026 (giờ Việt Nam)
- **Trạng thái:** Đã triển khai & hoàn thiện (Production Ready)
- **Thay đổi trọng tâm ở bản v3.0:**
  - **Hoàn toàn Free & Không cần API key trả phí:** Chỉ yêu cầu duy nhất `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`. Các API key bên thứ ba (`SAUCENAO_API_KEY`, `DANBOORU_API_KEY`, `BRIGHTDATA_API_KEY`, `SERPAPI_API_KEY`) trở thành tùy chọn (optional).
  - **Không giới hạn (Unlimited) & Không độ trễ (Zero-Delay):** Mặc định tắt cooldown (`USER_COOLDOWN_MS=0`), mở khóa hạn mức người dùng (`1.000.000` lượt/ngày), cho phép tìm song song nhiều ảnh cùng lúc (`ALLOW_CONCURRENT_USER_SEARCHES=true`), mở rộng concurrency gate (`UNLIMITED_GATES=true`).
  - **Thực thi song song theo đợt (Parallel Waves):** Chạy đồng thời các engine tìm nguồn gốc (`SauceNAO`, `Danbooru + IQDB.org`, `trace.moe`) ngay trong Đợt 1; nếu chưa tìm ra kết quả mức `NGUỒN` (`source`), tự động gọi `Yandex Images` ở Đợt 2.
  - **Hỗ trợ đầy đủ ảnh NSFW (2D & 3D) kèm quy tắc hiển thị an toàn theo kênh:** Tìm ra link nguồn NSFW ở mọi kênh (`hide=0` trên SauceNAO, `family=no` trên Yandex Direct, đa sàn Booru trên IQDB.org), nhưng **tự động ẩn ảnh/video preview ở kênh thường** và **chỉ hiển thị đầy đủ preview ở kênh bật NSFW (Age-Restricted)**.
  - **Cơ chế tự chủ & dự phòng đa tầng:**
    - `SauceNAO`: Hỗ trợ xoay vòng nhiều key (`SAUCENAO_API_KEYS`) + tự động fallback sang cào Web HTML (`parseSauceNaoHtml`) khi không có key hoặc hết lượt.
    - `Danbooru`: Bổ sung provider `iqdb` (`https://iqdb.org/`) tìm kiếm không cần tài khoản qua đồng thời Danbooru, Gelbooru, Sankaku Complex, Yande.re, Konachan, Zerochan, Anime-Pictures.
    - `Yandex`: Bổ sung provider chính `yandex_direct` gọi trực tiếp `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&family=no` kèm cookie tắt lọc gia đình (`yp=1999999999.sp.family%3A0`), giữ `brightdata` và `serpapi` làm dự phòng tùy chọn.
  - **Tích hợp sẵn Cloudflare WARP Proxy trong Docker:** Định tuyến lưu lượng gọi engine qua container `caomingjun/warp` (`HTTP_PROXY=http://warp:1080` + `--use-env-proxy`) để chống chặn IP/Captcha trên VPS, đồng thời giữ kết nối Discord Gateway đi trực tiếp (`NO_PROXY`).

---

## 1. Mục đích

Thành viên trong server Discord thường gửi ảnh và hỏi nguồn: cảnh anime ở tập nào, phút nào; fanart/manga/doujinshi/hentai 2D do ai vẽ, đăng ở đâu; khung hình thuộc bộ phim, cosplay hay idol 3D nào. Bot trả lời tức thì ngay trong Discord.

**Tiêu chí thành công:**
1. **Miễn phí 100% (0 đồng):** Không cần thẻ tín dụng hay dịch vụ proxy trả phí.
2. **Không giới hạn & Không chờ đợi:** Phản hồi ban đầu dưới 1 giây, chạy song song các engine và trả kết quả ngay khi có nguồn khớp.
3. **Bao phủ cả ảnh SFW và NSFW (2D & 3D):** Tìm được nguồn chính xác cho cả ảnh nhạy cảm nhưng tuyệt đối không để lộ ảnh/video preview nhạy cảm ra kênh thường.

---

## 2. Mục tiêu, ngoài phạm vi, điều cấm

### 2.1. Mục tiêu
1. Tìm nguồn bằng `/search` (tải ảnh lên) và bằng menu tin nhắn `"Tìm nguồn ảnh"`.
2. Bốn chế độ: `auto` (mặc định), `anime`, `art`, `movie`.
3. Chạy ngay chỉ với 3 biến môi trường của Discord; tự động tận dụng thêm API key nếu người vận hành cấu hình.
4. Thực thi song song (Parallel Waves) giúp giảm thời gian chờ từ tuần tự (15–30s) xuống chỉ còn bằng thời gian của 1 engine nhanh nhất (1–3s).
5. Mọi phản hồi đều có ích: kết quả chính, ứng viên khác, kèm danh sách deep link tự tìm tiếp.

### 2.2. Ngoài phạm vi bản này
- Tự động quét mọi ảnh gửi trong kênh khi người dùng không gọi lệnh.
- Lưu trữ file ảnh gốc xuống ổ đĩa (ảnh chỉ xử lý trên RAM và xóa sau khi hết phiên nút bấm 10 phút).

### 2.3. Điều cấm (thất bại dù bot vẫn chạy)
- **Hiện ảnh/video xem trước (preview) nhạy cảm (NSFW) trong kênh thường.** (Link chữ dẫn tới nguồn vẫn được phép hiển thị để người dùng biết nguồn, nhưng ảnh thumbnail/video bắt buộc phải ẩn ở kênh thường).
- Khẳng định chắc chắn một nguồn sai.
- Treo hoặc crash khi một nhà cung cấp đổi cấu trúc HTML/JSON hoặc trả Captcha.
- Ghi lộ token, API key, hay query ký số URL ảnh Discord ra log.

---

## 3. Ràng buộc kỹ thuật

| Mục | Giá trị |
| :--- | :--- |
| **Runtime** | Node 24 (`--experimental-strip-types` / chạy `.ts` trực tiếp, `--use-env-proxy`, `fetch`, `node:sqlite`, `node:test`) |
| **Thư viện** | `discord.js` 14.27.0, `sharp` 0.35.5, `zod` 4.6.7; dev: `typescript` 7.0.2, `@types/node` 24.19.2 |
| **TypeScript** | `tsconfig.json`: `erasableSyntaxOnly`, import tương đối ghi đuôi `.ts`, kiểm tra bằng `npm run typecheck` |
| **Triển khai** | Docker Compose gồm 2 service: `bot` (`node:24-slim`) và `warp` (`caomingjun/warp:latest`), volume `./data` cho SQLite |
| **Ngôn ngữ** | Giao diện hiển thị tiếng Việt; tên lệnh: `/search`, `/quota`, `/help` và menu `"Tìm nguồn ảnh"` |

---

## 4. Trải nghiệm người dùng

### 4.1. `/search`
| Option | Kiểu | Bắt buộc | Ghi chú |
| :--- | :--- | :--- | :--- |
| `image` | ATTACHMENT, `file_types: ["image"]` | Có | Kiểm tra thêm magic bytes và kích thước bằng `sharp` |
| `mode` | STRING: `auto`, `anime`, `art`, `movie` | Không | Mặc định `auto` |
| `private` | BOOLEAN | Không | `true`: chỉ người gọi thấy kết quả (ephemeral) |

### 4.2. Menu tin nhắn `"Tìm nguồn ảnh"`
- Lấy ảnh ứng viên từ tin nhắn được chọn theo thứ tự: `attachment` → `embed.image` → `embed.thumbnail`. Ảnh embed chỉ tải qua `proxy_url` để chống SSRF.
- Một ảnh: tìm ngay bằng chế độ `auto`.
- Nhiều ảnh: hiển thị menu chọn ảnh trước khi tìm.
- Kết quả trả về ở chế độ ephemeral.

### 4.3. `/quota` và `/help`
- `/quota` (yêu cầu quyền Manage Server): Hiển thị tình trạng hoạt động và thống kê lượt gọi của từng provider (`tracemoe`, `saucenao`, `danbooru`, `iqdb`, `yandex_direct`, `brightdata`, `serpapi`).
- `/help`: Hướng dẫn cách tìm nguồn ảnh, các chế độ tìm kiếm và quy tắc hiển thị.

### 4.4. Hạn mức và Tốc độ (Mặc định Unlimited & Zero-Delay)
- `USER_COOLDOWN_MS=0`: Không bắt người dùng chờ giữa hai lần tìm.
- `USER_DAILY_SEARCHES=1000000`, `USER_DAILY_YANDEX=1000000`: Không giới hạn số lượt tìm trong ngày.
- `ALLOW_CONCURRENT_USER_SEARCHES=true`: Một người có thể tìm nhiều ảnh cùng lúc.
- `UNLIMITED_GATES=true`: Mở rộng cổng đồng thời (concurrency semaphore = 32) và bỏ giới hạn cửa sổ trượt cục bộ để đạt tốc độ phản hồi tối đa.
- *Lưu ý:* Người vận hành vẫn có thể đặt lại các biến môi trường này về mức giới hạn chặt nếu muốn cấu hình hạn mức riêng.

### 4.5. Tin nhắn kết quả (Kiểu C)
1. **Nhãn mức tin cậy:** `NGUỒN TÌM ĐƯỢC` (viền xanh), `CÓ THỂ LÀ` (viền vàng), `LIÊN QUAN` (viền xám).
2. **Tiêu đề & Link nguồn chính:** Tên anime / tranh / phim kèm link dẫn tới trang gốc.
3. **Chi tiết theo loại:** Anime (`Tập X · mm:ss`); Art (`Tác giả · Domain`); Phim/Web (`Tên trang · Domain`), kèm phần trăm độ khớp và tên engine.
4. **Ảnh xem trước lớn (Embed Image):** Hiển thị nếu thỏa mãn quy tắc an toàn NSFW tại Mục 8.
5. **Ứng viên khác:** Tối đa 2 kết quả kế tiếp khác URL.
6. **Tự tìm tiếp (Deep links):** Yandex · SauceNAO · Google Lens · trace.moe · IQDB · ascii2d · Bing · TinEye.
7. **Nút bấm tương tác (10 phút):** `"Đổi chế độ"` và `"Tìm thêm bằng Yandex"` (nếu lượt tìm đã dừng sớm ở Đợt 1 trước khi gọi Yandex).

---

## 5. Nguồn tìm kiếm & Đa đường cung cấp (Multi-Provider)

| Engine (`EngineId`) | Providers (`ProviderId`) | Cơ chế hoạt động & Hỗ trợ NSFW |
| :--- | :--- | :--- |
| **`saucenao`** | `saucenao` | - **Khi có API key (`SAUCENAO_API_KEY` / `SAUCENAO_API_KEYS`):** Gọi JSON API với `hide=0` (lấy cả kết quả NSFW) và tự động xoay vòng qua danh sách key nếu gặp `429`/`quota_exhausted`.<br>- **Web Fallback (Mặc định bật):** Khi không cấu hình key hoặc mọi key hết lượt, tự động gửi multipart POST lên `https://saucenao.com/search.php` và bóc tách HTML (`parseSauceNaoHtml`).<br>- Tự động gắn cờ `adult: true` cho các index 18+ (H-Misc, e-hentai, Fakku, Gelbooru, Sankaku, Yande.re, 2D-Market…) hoặc kết quả bị đánh dấu hidden. |
| **`danbooru`** | `danbooru`, `iqdb` | - **`danbooru` (khi có key hoặc gọi public):** Truy vấn `https://danbooru.donmai.us/iqdb_queries.json`.<br>- **`iqdb` (Mặc định bật, không cần key):** Upload ảnh chuẩn hóa lên `https://iqdb.org/` (`parseIqdbHtml`), tìm kiếm đồng thời trên Danbooru, Konachan, Yande.re, Gelbooru, Sankaku Complex, Zerochan, Anime-Pictures. Tự động nhận diện nhãn `[Safe]`, `[Ero]`, `[Explicit]` để gắn cờ `adult`. |
| **`tracemoe`** | `tracemoe` | - POST ảnh chuẩn hóa lên `https://api.trace.moe/search?anilistInfo&cutBorders=1` (hỗ trợ tùy chọn header `x-trace-key` nếu có `TRACEMOE_API_KEY`).<br>- Đọc `anilist.isAdult` để gắn cờ `adult`. |
| **`yandex`** | `yandex_direct`, `brightdata`, `serpapi` | - **`yandex_direct` (Đường chính, miễn phí):** Gọi trực tiếp `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&family=no&url=<URL>` kèm header trình duyệt và `Cookie: yp=1999999999.sp.family%3A0` để tắt bộ lọc gia đình (cho phép tìm ảnh NSFW 3D/Cosplay/Movie/2D). Bóc tách dữ liệu từ `initialState.cbirSites.sites` và DOM.<br>- **`brightdata` & `serpapi` (Dự phòng tùy chọn):** Tự động kích hoạt trong chuỗi provider nếu người dùng có điền API key tương ứng trong `.env`. |

---

## 6. Luồng tìm kiếm song song (Parallel Waves)

### 6.1. Cơ chế `nextBatch` & Chạy song song (`PARALLEL_SEARCH=true`)
Thay vì gọi tuần tự từng engine khiến người dùng phải chờ cộng dồn thời gian, Orchestrator (`runSearch`) chia các engine thành các **Đợt (Wave)** qua hàm `nextBatch`:

| Chế độ (`mode`) | Đợt 1 (Chạy song song cùng lúc) | Đợt 2 (Chỉ chạy khi Đợt 1 chưa có kết quả mức `NGUỒN`) |
| :--- | :--- | :--- |
| **`auto`** | `saucenao` + `danbooru` (`danbooru` & `iqdb`) + `tracemoe` | `yandex` (`yandex_direct` → `brightdata` → `serpapi`) |
| **`anime`** | `tracemoe` + `saucenao` | `yandex` |
| **`art`** | `saucenao` + `danbooru` (`danbooru` & `iqdb`) | `yandex` |
| **`movie`** | `yandex` (`yandex_direct` → `brightdata` → `serpapi`) | `saucenao` (chỉ index Movies & Shows) |

- Ngay khi Đợt 1 hoàn tất và có ít nhất 1 kết quả đạt mức **`NGUỒN`** (`source`), bot **dừng sớm (early-stop)** và trả kết quả ngay mà không cần gọi Đợt 2.
- Nếu người dùng vẫn muốn đối chiếu thêm với Yandex sau khi bot đã dừng sớm ở Đợt 1, nút **"Tìm thêm bằng Yandex"** luôn sẵn sàng bên dưới tin nhắn.

### 6.2. Mức tin cậy & Danh sách Domain Nguồn (`KNOWN_SOURCE_DOMAINS`)
| Engine | `NGUỒN` (`source`) | `CÓ THỂ LÀ` (`maybe`) | `LIÊN QUAN` (`related`) |
| :--- | :--- | :--- | :--- |
| **SauceNAO** | `similarity ≥ 90` | `70 ≤ similarity < 90` | Không áp dụng |
| **trace.moe** | `similarity ≥ 0.92` | `0.85 ≤ similarity < 0.92` | Không áp dụng |
| **Danbooru / IQDB** | `score ≥ 90` | `70 ≤ score < 90` | Không áp dụng |
| **Yandex** | Không bao giờ | Thuộc `KNOWN_SOURCE_DOMAINS` (Pixiv, Twitter/X, Danbooru, Gelbooru, Yande.re, Konachan, Sankaku, Zerochan, Anime-Pictures, E-Hentai, ExHentai, Fakku, Kemono, Fantia, Fanbox, Booth, ArtStation, DeviantArt, Newgrounds,Rule34, E621, IMDb, TMDB, MAL, AniList) | Các trang web khác |

---

## 7. Nội dung người lớn (NSFW) & Quy tắc hiển thị theo kênh

Bot tách biệt hoàn toàn giữa **Khả năng tìm nguồn** và **Quy tắc hiển thị ảnh xem trước (`previewAllowed`)**:

1. **Khả năng tìm nguồn (Luôn bật 100% ở mọi kênh):**
   - Tất cả các engine luôn tìm kiếm bao gồm cả dữ liệu NSFW (`hide=0` trên SauceNAO, `family=no` trên Yandex, tất cả các sàn Booru trên IQDB, `anilist.isAdult` trên trace.moe) bất kể lệnh được gọi ở kênh thường hay kênh NSFW. Nhờ đó người dùng luôn nhận được tiêu đề và đường dẫn nguồn gốc chính xác.
2. **Quy tắc hiển thị ảnh/video xem trước (`previewAllowed` trong `src/discord/render.ts`):**

| Nguồn kết quả | Tại Kênh Thường (Non-NSFW) | Tại Kênh 18+ (NSFW / Age-Restricted) |
| :--- | :--- | :--- |
| **trace.moe** | Chỉ hiện ảnh & link video preview khi `adult === false`. Nếu `adult === true` (`isAdult`): **Ẩn hoàn toàn ảnh & video preview**, chỉ hiện tên anime, tập, mốc thời gian. | Hiển thị đầy đủ ảnh xem trước & link video đoạn cảnh. |
| **SauceNAO** | Chỉ hiện ảnh thumbnail khi `adult === false`. Nếu thuộc index 18+ hoặc bị đánh dấu nhạy cảm (`adult === true`): **Ẩn ảnh thumbnail**, chỉ hiện tên tác phẩm, tác giả và link nguồn. | Hiển thị đầy đủ ảnh thumbnail. |
| **Danbooru / IQDB** | Chỉ hiện ảnh xem trước khi rating là Safe/General (`rating === "g"` / `adult === false`). Với Questionable/Ero/Explicit (`adult === true`): **Ẩn ảnh xem trước**, chỉ hiện link nguồn. | Hiển thị đầy đủ ảnh xem trước. |
| **Yandex** | **Luôn ẩn ảnh thumbnail** ở kênh thường (`adult: null`), chỉ hiện tiêu đề trang và link nguồn. | Hiển thị đầy đủ ảnh thumbnail. |

---

## 8. Kiến trúc triển khai Docker & Cloudflare WARP

Để chạy ổn định 24/7 trên VPS (Linux/Windows) mà không bị Yandex, IQDB hay SauceNAO chặn IP datacenter:

```yaml
services:
  warp:
    image: caomingjun/warp:latest
    container_name: reverse-image-bot-warp
    restart: unless-stopped
    cap_add:
      - NET_ADMIN
    sysctls:
      - net.ipv6.conf.all.disable_ipv6=0
      - net.ipv4.conf.all.src_valid_mark=1

  bot:
    build: .
    depends_on:
      - warp
    env_file: .env
    environment:
      - HTTP_PROXY=http://warp:1080
      - HTTPS_PROXY=http://warp:1080
      - NO_PROXY=localhost,127.0.0.1,discord.com,discordapp.com,cdn.discordapp.com,media.discordapp.net,gateway.discord.gg
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

- Tiến trình Node 24 khởi chạy với cờ `--use-env-proxy` để mọi lệnh `fetch` tới các engine tìm kiếm tự động đi qua Cloudflare WARP (`http://warp:1080`), trong khi lưu lượng tải ảnh và WebSocket của Discord đi thẳng nhờ `NO_PROXY`.

---

## 9. Cấu hình biến môi trường (`.env`)

```dotenv
# Bắt buộc (Chỉ cần 3 biến Discord để chạy ngay)
DISCORD_TOKEN=
DISCORD_APPLICATION_ID=
DISCORD_GUILD_ID=

# Tùy chọn — Engine Keys (Bỏ trống bot vẫn chạy qua Web Fallback / IQDB / Yandex Direct)
SAUCENAO_API_KEY=
SAUCENAO_API_KEYS=
DANBOORU_LOGIN=
DANBOORU_API_KEY=
DANBOORU_USER_ID=
TRACEMOE_API_KEY=
BRIGHTDATA_API_KEY=
BRIGHTDATA_ZONE=
SERPAPI_API_KEY=

# Lưu trữ & Giới hạn xử lý ảnh
SQLITE_PATH=./data/bot.db
IMAGE_MAX_BYTES=10485760
IMAGE_MAX_PIXELS=20000000
ENGINE_TIMEOUT_MS=15000
JOB_DEADLINE_MS=60000
MAX_ACTIVE_JOBS=100

# Cấu hình Không giới hạn & Không độ trễ (Mặc định trong loadConfig)
USER_COOLDOWN_MS=0
USER_DAILY_SEARCHES=1000000
USER_DAILY_YANDEX=1000000
USER_DAILY_YANDEX_SERPAPI=1000000
UNLIMITED_GATES=true
PARALLEL_SEARCH=true
ALLOW_CONCURRENT_USER_SEARCHES=true

# Cache
CACHE_HIT_TTL_DAYS=30
CACHE_MISS_TTL_HOURS=24
```
