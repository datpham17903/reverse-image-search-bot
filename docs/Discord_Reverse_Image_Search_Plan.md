# Kế hoạch Discord Bot Reverse Image Search

> Phần thiết kế đã được thay bằng `docs/superpowers/specs/2026-10-27-discord-reverse-image-search-bot-design.md` (bỏ Google Lens; Yandex qua Bright Data và SerpApi). File này giữ lại để tham khảo.

- Phiên bản: 2.0, ngày 27/10/2026 (giờ Việt Nam).
- Mục tiêu: tìm nguồn ảnh anime, art và phim ngay trong server Discord; **0 đồng chi phí API**; nhiều người dùng cùng lúc vẫn được phục vụ.
- Ký hiệu: "đã xác minh" là đã kiểm tra trực tiếp ngày 27/10/2026; "chưa xác minh" phải đọc lại từ tài khoản hoặc response thật ở giai đoạn 0.

## Thay đổi so với bản 1.1

- **Rút về một process.** Bỏ hàng đợi bền vững, lease/heartbeat/fencing, checkpoint, input spool, lưu và mã hóa token, `/result`, proxy/IPv6 và phần HA nhiều máy. Mỗi job sống tối đa 60 giây; crash thì người dùng tìm lại.
- **Tăng quota theo cách hợp lệ:** cache dùng chung 30 ngày, thêm Danbooru IQDB, chia ngân sách tháng theo ngày, hạn mức theo người, deep link không giới hạn.
- **Đồng thời theo engine:** bỏ giới hạn 3 job; mỗi engine có limiter riêng; engine bận thì chuyển sang engine khác thay vì xếp hàng.
- **Bổ sung:** chặn SSRF ở ảnh embed, quy tắc NSFW cụ thể, ngưỡng khởi điểm để mode auto chạy được ngay.

## 1. Nguyên tắc

1. **0 đồng mặc định.** Chỉ dùng free tier, không thêm thẻ, không bật nạp tiền. Hết quota thì dùng cache và deep link.
2. **Không nhân quota bằng nhiều tài khoản hay nhiều IP/IPv6.** SauceNAO ghi rõ việc này có thể bị ban [E4]; Danbooru cấm vượt giới hạn [E8]; trace.moe tính quota theo IP [E2]. Bị ban là mất luôn free tier.
3. **Không có ngõ cụt.** Mọi phản hồi, kể cả khi hết quota, đều kèm deep link để người dùng tự tìm trên trình duyệt; bot không tốn quota cho việc này.
4. **Chỉ khẳng định khi có bằng chứng.** Tách bạch "nguồn", "có thể là", "liên quan", "không tìm thấy" và "chưa tìm vì hết quota hoặc lỗi".

## 2. Cách người dùng gửi ảnh

### 2.1. Lệnh /search

| Trường | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| image | ATTACHMENT (11), `file_types: ["image"]` | Có | Chọn/tải tệp trong ô của Discord; không gõ tên file hay URL |
| mode | STRING: auto, anime, art, movie | Không | Bỏ trống = auto |
| private | BOOLEAN | Không | true = chỉ người gọi thấy kết quả |

- `file_types` chỉ lọc theo đuôi file; nhóm `image` gồm .png .gif .jpg .jpeg .jfif .webp .avif. Bot vẫn phải kiểm tra bytes [D4].
- Lấy ảnh: `interaction.options.getAttachment("image", true)` [D3].

### 2.2. Context menu "Tìm nguồn ảnh"

Đây là cách chính khi ảnh đã nằm trong chat (menu tin nhắn → Apps → Tìm nguồn ảnh).

- Chỉ xét đúng tin nhắn được chọn; nội dung tin nhắn này không cần Message Content Intent [D5].
- Thứ tự lấy ảnh: attachment → embed image → embed thumbnail. **Ảnh embed chỉ tải qua `proxy_url`** (proxy của Discord), không tải `url` gốc, vì link preview hoặc webhook có thể trỏ `url` vào IP nội bộ [D6].
- Một ảnh: tìm ngay bằng auto. Nhiều ảnh: select menu chọn một ảnh trước khi tốn quota. Không có ảnh: hướng dẫn dùng /search.
- Mặc định trả kết quả ephemeral để không làm ồn kênh.

### 2.3. Chưa làm trong MVP

- Không tự quét ảnh trong kênh; không tự lấy "ảnh gần nhất".
- /search-url để sau. Khi làm: chỉ HTTPS, chặn IP private/loopback/link-local/metadata, kiểm tra lại từng redirect, giới hạn dung lượng và thời gian.
- Đăng ký lệnh theo guild (một server, cập nhật ngay). Global command và user-install để sau; nhiều server sẽ dùng chung một bộ quota.

## 3. Nguồn tìm kiếm và quota miễn phí

| Nguồn | Free tier | Đồng thời / tốc độ | Mạnh nhất cho | Vai trò | Trạng thái |
| --- | --- | --- | --- | --- | --- |
| trace.moe | 100 lượt / 24 giờ trượt, theo IP | 1 request | Cảnh anime: tập, timestamp, preview | Auto có điều kiện; mode anime | Đã xác minh [E2][E3] |
| SauceNAO | Tài khoản free; nguồn bên thứ ba ghi khoảng 200/ngày và vài lượt/30 giây | Theo header `short_remaining` | Art, manga, anime, một phần phim/show | Engine đầu của auto và art | Chưa xác minh [E5][E6] |
| Danbooru IQDB | Không thấy quota ngày; giới hạn đọc chung 10 req/s; cần tài khoản free | Khuyến nghị khoảng 1 req/s | Art kiểu anime có trên Danbooru, kèm link nguồn gốc, artist, rating | Thay SauceNAO khi bận; mode art | Đã đọc docs và source, chưa gọi thử [E7][E9] |
| Google Lens qua Bright Data | 5.000 credit/tháng, 1 credit/request, reset ngày 1 | Cao (tài khoản chưa nạp: 1.000 req/phút) | Phim người đóng, poster, tranh, trang web chứa ảnh | Một lượt trong auto; mode movie | Đã xác minh [E10][E11] |
| SerpApi | 250 lượt/tháng, 50/giờ; chỉ tính lượt thành công | Thấp | Yandex reverse; dự phòng Lens | Nút "Tìm thêm bằng Yandex" | Đã xác minh [E14][E15] |
| Deep link | Không giới hạn | Không áp dụng | Mọi loại | Luôn kèm kết quả | Mẫu URL kiểm tra khi làm |

Ghi chú:

- trace.moe: `cutBorders` cắt viền đen, nhưng `cutBorders=2` có thể tốn 2 credit; `anilistInfo` trả tên anime và `isAdult` [E3].
- Lens: tab "Exact matches" là request riêng, thêm 1 credit [E11]. Mặc định chỉ gọi một tab; tab còn lại qua nút. Benchmark quyết định tab mặc định.
- Không dùng: Yandex Search API trực tiếp và TinEye API (trả phí) [E18][E19]; Bing Search API (ngừng từ 11/08/2025) [E20].
- Không thêm nhà cung cấp SERP khác chỉ để lấy quota: các bên khác chỉ có credit dùng một lần hoặc rất ít mỗi tháng; Bright Data là free tier Lens định kỳ lớn nhất tìm được [E13]. Có thể thêm sau làm dự phòng khi Bright Data lỗi.

## 4. Tăng quota hiệu dụng

### 4.1. Ước tính công suất mỗi ngày

| Nguồn | Lượt/ngày |
| --- | --- |
| trace.moe | ~100 |
| SauceNAO | ~100–200 (chờ xác minh) |
| Bright Data Lens | ~160 (5.000 ÷ 31) |
| SerpApi | ~8 |
| Danbooru IQDB | Theo rate limit; chỉ phủ ảnh có trên Danbooru |
| Deep link | Không giới hạn |

Với early-stop (trung bình 1,5–2 lượt engine mỗi lần tìm) và cache, bot tự động xử lý khoảng **200–300 lượt tìm mỗi ngày cho cả server**. Đây là ước tính, chưa đo. Vượt mức này, bot vẫn trả kết quả cache và deep link.

### 4.2. Cơ chế

1. **Cache dùng chung trong server.** Khóa = SHA-256 bytes ảnh + engine + tham số. Có nguồn: giữ 30 ngày; không thấy: 24 giờ; lỗi hoặc hết quota: không cache. Lưu thêm `attachment_id → hash` để nhiều người bấm context menu trên cùng ảnh không phải tải lại.
2. **Gộp request trùng đang chạy** (cùng hash, engine, tham số) thành một lượt gọi, trả cho từng người.
3. **Early-stop:** đủ mạnh thì dừng; engine quota hiếm (Lens, Yandex) gọi sau cùng.
4. **Chia ngân sách tháng theo ngày** (Bright Data, SerpApi): hạn mức hôm nay = phần còn lại ÷ số ngày còn lại trong kỳ, để không tiêu hết trong vài ngày đầu.
5. **Hạn mức theo người:** mỗi người tối đa N lượt tìm, M lượt Lens, K lượt Yandex mỗi ngày; một job đang chạy; cooldown 10 giây.
6. **Giữ quota trace.moe cho anime:** auto chỉ được dùng tối đa 50% quota trace.moe cho ảnh chưa rõ loại.
7. **Đồng bộ quota với nhà cung cấp:** trace.moe `/me`, header SauceNAO, header `x-rate-limit` của Danbooru, Account API của SerpApi [E2][E7][E16]. Bộ đếm cục bộ chỉ để chặn trước. Timeout sau khi đã gửi request thì tính là đã tiêu một lượt và không tự retry.

### 4.3. Nếu sau này cần nhiều hơn (không bật mặc định)

- Nâng cấp hợp lệ: trace.moe cho người tài trợ quota cao hơn [E1]; Bright Data tính theo lượt (5.000 credit tương đương khoảng 7,50 USD, tức khoảng 1,5 USD cho 1.000 lượt Lens) [E10]; SauceNAO có gói nâng cấp [E4].
- Người dùng tự liên kết key SauceNAO của chính họ: chỉ làm sau khi hỏi SauceNAO, vì điều khoản cấm chia sẻ tài khoản [E4].

## 5. Luồng tìm kiếm

### 5.1. Quy tắc chung

- Mỗi engine có limiter riêng: số request đồng thời, cửa sổ thời gian, ngân sách ngày/tháng.
- **Không đứng chờ khi còn lựa chọn khác:** engine kế tiếp chưa có slot trong 5 giây mà còn engine thay thế phù hợp thì chuyển sang engine đó; hết engine thì trả kết quả hiện có kèm deep link.
- Timeout mỗi engine 15 giây (đo lại cho Lens ở giai đoạn 0); deadline cả job 60 giây; cập nhật kết quả từng phần sau mỗi engine.
- Không gọi lại engine đã chạy trong cùng lượt tìm hoặc đã có cache.

### 5.2. mode:auto

1. Kiểm tra cache; đủ mạnh thì trả ngay.
2. Gọi SauceNAO; nếu SauceNAO bận hoặc hết lượt thì gọi Danbooru IQDB.
   - Có nguồn artwork đủ mạnh: dừng.
   - Kết quả thuộc index anime: nếu response đã có tập và thời điểm với điểm cao thì dừng, thiếu thì sang bước 3.
3. Gọi trace.moe (nếu còn quota) để lấy tập, timestamp, preview.
4. Chưa có nguồn tốt: gọi Lens một lượt (trong ngân sách ngày và hạn mức người).
5. Vẫn chưa rõ: gọi trace.moe trong phần quota dành cho ảnh chưa rõ loại.
6. Trả kết quả tốt nhất kèm deep link và các nút: Kết quả khác, Đổi mode, Tìm thêm (Yandex, Exact matches).

### 5.3. Mode chỉ định

| mode | Thứ tự |
| --- | --- |
| anime | trace.moe → SauceNAO → Lens |
| art | SauceNAO → Danbooru IQDB → Lens |
| movie | Lens → SauceNAO (Movies/Shows); Yandex qua nút |

### 5.4. Ngưỡng khởi điểm

Đây là giá trị đề xuất để mode auto chạy được ngay, **chưa có số liệu đo**. Đặt trong config, log điểm gốc của từng engine và hiệu chỉnh ở giai đoạn 3.

| Engine | "Nguồn" | "Có thể là" |
| --- | --- | --- |
| SauceNAO | similarity ≥ 85 | 70–85 |
| trace.moe | similarity ≥ 0,90 | 0,85–0,90 |
| Danbooru IQDB | score ≥ 85 | 70–85 |
| Lens, Yandex | Không có điểm: trang thuộc domain nguồn đã biết (pixiv, x.com, danbooru, artstation, imdb…) và ảnh khớp | Không áp dụng; còn lại là "liên quan" |

Không cộng hay lấy trung bình điểm giữa các engine.

## 6. Hiển thị kết quả

- Mặc định 3 kết quả, ghi rõ engine và điểm gốc.
- Anime: tên, tập, timestamp. Art: tác phẩm, tác giả (khi có metadata), link nguồn. Phim: tên ứng viên và trang nguồn. Không đoán tập, thời điểm hay tác giả.
- Tắt mention trong mọi phản hồi (`allowedMentions: { parse: [] }`).
- /search mặc định công khai (option `private` để ẩn); context menu mặc định ephemeral. Chế độ ephemeral được chốt lúc `deferReply`, nên phải quyết định trước khi tìm.

### 6.1. Nội dung người lớn

Ở kênh thường (không bật `nsfw`):

- SauceNAO: dùng tham số `hide` để ẩn kết quả explicit; giá trị chính xác phải thử với key thật vì tài liệu chính thức sơ sài [E6].
- trace.moe: `anilist.isAdult = true` thì không hiện preview [E3].
- Danbooru: chỉ hiện thumbnail khi rating là `g`; còn lại chỉ hiện link.
- Lens và Yandex: không hiện thumbnail vì không có nhãn; chỉ hiện link.

Kênh `nsfw` hiện đầy đủ.

### 6.2. Deep link

Thay `{u}` bằng URL ảnh Discord đã encode. Kiểm tra từng mẫu khi triển khai.

| Engine | Mẫu |
| --- | --- |
| Google Lens | `https://lens.google.com/uploadbyurl?url={u}` |
| Yandex | `https://yandex.com/images/search?rpt=imageview&url={u}` |
| Bing | `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{u}` |
| SauceNAO | `https://saucenao.com/search.php?url={u}` |
| trace.moe | `https://trace.moe/?url={u}` |
| IQDB | `https://iqdb.org/?url={u}` |
| ascii2d | `https://ascii2d.net/search/url/{u}` |
| TinEye | `https://tineye.com/search?url={u}` |

Link button có giới hạn độ dài URL (512 ký tự, cần kiểm tra lại); URL dài hơn thì đưa vào phần mô tả embed dưới dạng markdown link.

## 7. Xử lý ảnh

1. `deferReply` ngay khi nhận interaction (mục tiêu dưới 1 giây; hạn chót của Discord là 3 giây, token sống 15 phút) [D2].
2. Chỉ tải từ host Discord (`cdn.discordapp.com`, `media.discordapp.net`), giữ nguyên query ký số `ex`, `is`, `hm`. Tham số `ex` là hex timestamp hết hạn, đọc trực tiếp để biết URL còn dùng được đến khi nào [D4].
3. Tải dạng stream, dừng khi vượt 10 MiB; timeout 10 giây.
4. Giải mã bằng sharp với `limitInputPixels: 20_000_000`, xoay theo EXIF, GIF lấy frame đầu. Nhận đủ nhóm `image` (PNG, JPEG, WebP, GIF, AVIF). Giải mã lỗi thì báo rõ và không gọi engine.
5. Tạo bản chuẩn hóa (cạnh dài tối đa 2048 px, JPEG) để upload cho trace.moe và SauceNAO. Engine chỉ nhận URL (Lens, Yandex, Danbooru) dùng URL Discord gốc.
6. Giữ bản chuẩn hóa trong RAM cho phiên nút 10 phút, tổng tối đa khoảng 128 MiB (bỏ phiên cũ nhất khi đầy). Không ghi ảnh ra đĩa; cache chỉ lưu hash và metadata kết quả.
7. Attachment của /search không gắn với tin nhắn nên không lấy lại URL mới được; phải tải ngay ở bước 2. Với context menu, URL hết hạn thì fetch lại tin nhắn để lấy URL mới [D4].

## 8. Kiến trúc: một process

~~~text
src/
  index.ts       khởi động, đăng ký lệnh guild, tắt có kiểm soát
  config.ts      đọc env, kiểm tra bằng zod
  discord/       /search, context menu, nút, select menu, render embed
  search/        orchestrator: luồng theo mode, deadline, kết quả từng phần
  engines/       tracemoe, saucenao, danbooru, lens-brightdata, yandex-serpapi
  limits/        limiter từng engine, ngân sách ngày/tháng, hạn mức người dùng
  images/        tải an toàn, sharp
  store/         node:sqlite: cache, usage, bộ đếm người dùng
~~~

- Adapter trả trạng thái thống nhất: `ok`, `no_match`, `quota_exhausted`, `rate_limited`, `timeout`, `invalid_input`, `unavailable`, kèm điểm gốc và thông tin quota nếu có. Response kiểm tra bằng zod; dữ liệu lạ trả `unavailable`, không làm bot crash.
- Không có giới hạn chung cho số job chạy cùng lúc; job chờ ở limiter của từng engine. Tổng số job đang xử lý tối đa 100 (mỗi người một job nên tự công bằng); quá mức thì trả ngay deep link kèm thông báo bot đang bận.
- SQLite (WAL) chỉ lưu cache, lượng dùng theo engine/kỳ và bộ đếm người dùng theo ngày, nên process chết không mất các số liệu này.
- Tắt có kiểm soát (SIGTERM): ngừng nhận lệnh mới (trả "bot đang khởi động lại"), chờ job đang chạy tối đa 60 giây rồi thoát. Crash: job đang chạy bị mất, người dùng tìm lại.
- Phiên nút nằm trong RAM; bấm nút cũ sau restart thì báo "phiên đã hết, hãy tìm lại".
- Docker: image `node:24-slim`, chạy `npm ci --omit=dev` bên trong image (không copy `node_modules` từ Windows), volume cho SQLite, restart `unless-stopped` [O1].
- Chỉ tách process hoặc thêm máy khi số đo cho thấy cần; ranh giới module ở trên cho phép tách sau.

### 8.1. Giới hạn khởi điểm

| Thành phần | Giá trị |
| --- | --- |
| trace.moe | 1 request đồng thời; ngân sách theo `/me` |
| SauceNAO | Theo `short_remaining`/`long_remaining`; trước khi có header: 2 đồng thời |
| Danbooru IQDB | 1 request/giây |
| Bright Data Lens | 4 đồng thời; ngân sách ngày theo mục 4.2 |
| SerpApi | 1 đồng thời; tối đa 50/giờ; ngân sách ngày |
| Giải mã ảnh | 2 đồng thời |
| Mỗi người dùng | 1 job đang chạy; cooldown 10 giây |

## 9. Riêng tư và bảo mật

- /help ghi rõ ảnh được gửi tới trace.moe, SauceNAO, Danbooru, Google (qua Bright Data) và Yandex (qua SerpApi).
- Không log token, API key, URL có chữ ký (cắt query trước khi log) hay bytes ảnh.
- Chỉ bật intent `Guilds`; không cần Message Content.
- Danbooru: gửi User-Agent riêng có tên bot và user ID theo yêu cầu của Danbooru [E7].
- Secret nằm trong `.env`, chạy bằng `node --env-file=.env`; `.env` không đưa vào git.

## 10. Stack (dependency đã cài)

| Thành phần | Lựa chọn |
| --- | --- |
| Runtime | Node 24: chạy `.ts` trực tiếp; có sẵn `fetch`, `node:sqlite`, `node:test`, `--env-file` |
| Discord | discord.js 14.27.0 |
| Ảnh | sharp 0.35.5 |
| Kiểm tra dữ liệu | zod 4.6.7 |
| Typecheck | typescript 7.0.2 (`npm run typecheck`), @types/node 24.19.2 |

Phiên bản được pin chính xác trong `package.json`. `tsconfig.json` bật `erasableSyntaxOnly`: không dùng `enum` hay `namespace`; import tương đối phải ghi đuôi `.ts`.

## 11. Cấu hình

~~~text
DISCORD_TOKEN
DISCORD_APPLICATION_ID
DISCORD_GUILD_ID
SAUCENAO_API_KEY
DANBOORU_LOGIN
DANBOORU_API_KEY
BRIGHTDATA_API_KEY
BRIGHTDATA_SERP_ZONE
SERPAPI_API_KEY
SQLITE_PATH=./data/bot.db
IMAGE_MAX_BYTES=10485760
IMAGE_MAX_PIXELS=20000000
ENGINE_TIMEOUT_MS=15000
JOB_DEADLINE_MS=60000
MAX_ACTIVE_JOBS=100
USER_COOLDOWN_MS=10000
USER_DAILY_SEARCHES=30
USER_DAILY_LENS=10
USER_DAILY_YANDEX=2
TRACE_UNKNOWN_SHARE=0.5
CACHE_HIT_TTL_DAYS=30
CACHE_MISS_TTL_HOURS=24
~~~

Các giá trị là điểm khởi đầu, chỉnh theo số đo thực tế.

## 12. Kế hoạch thực hiện

| Giai đoạn | Nội dung | Ước lượng |
| --- | --- | --- |
| 0. Xác minh | Tạo tài khoản và key free (không thêm thẻ); gọi thử từng engine bằng URL ảnh Discord thật; đọc quota SauceNAO từ header, trace.moe `/me`, Danbooru `x-rate-limit`; đo độ trễ Lens | 0,5–1 ngày |
| 1. MVP | /search, context menu, xử lý ảnh, adapter trace.moe + SauceNAO + Lens, orchestrator, limiter và usage trong SQLite, cache, deep link, quy tắc NSFW, hiển thị | 4–6 ngày |
| 2. Mở rộng quota | Danbooru IQDB, nút Yandex và Exact matches, hạn mức người dùng, chia ngân sách theo ngày, gộp request trùng, tắt có kiểm soát, Docker | 2–3 ngày |
| 3. Chất lượng và tải | Benchmark ít nhất 60 ảnh, hiệu chỉnh ngưỡng, load test bằng adapter giả (20 và 50 người cùng lúc), chạy thử trong server | 2–3 ngày |

Ước lượng cho một người làm, chưa kiểm chứng.

Sau MVP, khi có nhu cầu: /search-url, cache ảnh gần giống (dHash, tắt mặc định vì dễ trả nhầm), lệnh admin chỉnh hạn mức, user-install, tách process.

## 13. Kiểm thử nghiệm thu

Dùng `node:test`. Kiểm thử tải và lỗi bằng adapter giả để không tốn quota thật; chỉ smoke test số lượng nhỏ với API thật.

| Ca thử | Kết quả mong đợi |
| --- | --- |
| Chọn ảnh qua `image`, bỏ trống mode | Nhận đúng attachment, chạy auto |
| Context menu: một ảnh / nhiều ảnh / không có ảnh | Tìm ngay / chọn ảnh trước / hướng dẫn |
| Embed có `url` trỏ vào IP nội bộ | Chỉ tải qua `proxy_url`, không chạm `url` gốc |
| Đuôi file giả, ảnh hỏng, trên 10 MiB, trên 20 triệu pixel | Báo lỗi rõ trước khi gọi engine |
| 20 rồi 50 người gửi cùng lúc | Tất cả được ACK trong 3 giây; không vượt limiter; mỗi người nhận kết quả hoặc deep link trong deadline |
| SauceNAO hết lượt trong cửa sổ 30 giây | Auto chuyển sang Danbooru, không đứng chờ |
| Một engine hết quota ngày | Bỏ qua engine đó, ghi "chưa tìm vì hết quota" |
| Hết toàn bộ quota | Vẫn trả cache và deep link |
| Một người gửi liên tục | Cooldown và hạn mức chặn; người khác không bị ảnh hưởng |
| Hai người tìm cùng một ảnh | Mỗi engine chỉ gọi một lần; lần sau trúng cache |
| Timeout sau khi đã gửi request | Tính một lượt đã dùng; không retry |
| Ngân sách Bright Data trong tháng | Không vượt hạn mức ngày đã chia |
| Kênh thường và kênh NSFW | Ẩn/hiện preview đúng mục 6.1 |
| SIGTERM khi đang tìm | Job đang chạy hoàn tất; lệnh mới nhận thông báo khởi động lại |

Benchmark chất lượng: 60 ảnh đã biết nguồn (20 cảnh anime, 20 art, 20 phim) và một bộ ảnh không có nguồn; có biến thể nén, crop, chữ đè, viền đen. Đo top-1/top-3, tỷ lệ trả nhầm, số lượt engine mỗi lần tìm, độ trễ p50/p95, tỷ lệ trúng cache.

## 14. Còn phải xác nhận

1. Hạn mức thực tế của tài khoản SauceNAO free (đọc từ header).
2. Danbooru IQDB: gọi được bằng tài khoản free và API key; tham số `url`, dạng response, thang điểm.
3. Bright Data Lens và SerpApi Yandex tải được URL ảnh Discord, kể cả attachment của /search; độ trễ của Lens.
4. Giá trị `hide` phù hợp của SauceNAO.
5. Mẫu deep link và giới hạn độ dài URL của link button.
6. Ngưỡng ở mục 5.4 sau benchmark.
7. RAM và CPU của máy chạy khi giải mã 2 ảnh cùng lúc.

## 15. Nguồn

### Discord

- [D1] Application Commands (option type, `file_types`, contexts): https://docs.discord.com/developers/interactions/application-commands
- [D2] Receiving and Responding (3 giây, token 15 phút): https://docs.discord.com/developers/interactions/receiving-and-responding
- [D3] discord.js `getAttachment`: https://discord.js.org/docs/packages/discord.js/main/CommandInteractionOptionResolver%3AClass
- [D4] Reference (lọc file, URL CDN có chữ ký): https://docs.discord.com/developers/reference
- [D5] Message Content Intent và ngoại lệ context menu: https://docs.discord.com/developers/events/gateway#message-content-intent
- [D6] Message resource (Attachment, Embed, `proxy_url`): https://docs.discord.com/developers/resources/message

### Engine và nhà cung cấp

- [E1] trace.moe About (người tài trợ có quota cao hơn): https://trace.moe/about
- [E2] trace.moe `/me`: https://api.trace.moe/me
- [E3] trace.moe API swagger (quota 24 giờ trượt, `cutBorders`, `anilistInfo`): https://github.com/soruly/trace.moe-api/blob/master/swagger.yaml
- [E4] SauceNAO Terms (nhiều tài khoản/IP, chia sẻ tài khoản): https://saucenao.com/legal.html
- [E5] SauceNAO API (cần đăng nhập): https://saucenao.com/user.php?page=search-api
- [E6] Tài liệu bên thứ ba về tham số và hạn mức SauceNAO: https://kituin.github.io/wiki/picimagesearch/SauceNAO/DataStructure/ và https://pypi.org/project/saucenao-api/
- [E7] Danbooru API (rate limit, User-Agent, endpoint IQDB): https://danbooru.donmai.us/wiki_pages/help:api
- [E8] Danbooru Terms of Service: https://danbooru.donmai.us/terms_of_service
- [E9] Danbooru source, IQDB controller và policy: https://github.com/danbooru/danbooru/blob/master/app/controllers/iqdb_queries_controller.rb và https://github.com/danbooru/danbooru/blob/master/app/policies/iqdb_client_policy.rb
- [E10] Bright Data Free Tier: https://docs.brightdata.com/general/account/billing-and-pricing/free-tier
- [E11] Bright Data Lens bằng URL ảnh: https://docs.brightdata.com/api-reference/serp/google-lens/image-url
- [E12] Bright Data Lens upload file: https://docs.brightdata.com/api-reference/serp/google-lens/upload-file
- [E13] Bright Data Google Lens (5.000 request/tháng miễn phí): https://brightdata.com/products/serp-api/google-search/lens
- [E14] SerpApi Pricing: https://serpapi.com/pricing
- [E15] SerpApi Yandex Reverse Image: https://serpapi.com/yandex-reverse-image-api
- [E16] SerpApi Account API: https://serpapi.com/account-api
- [E17] SerpApi Status and Error Codes: https://serpapi.com/api-status-and-error-codes
- [E18] Yandex Search API Pricing: https://aistudio.yandex.ru/en/docs/search-api/pricing
- [E19] TinEye free và API: https://help.tineye.com/article/239-is-tineye-free-to-use
- [E20] Microsoft Bing Search APIs retirement: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement

### Vận hành

- [O1] Docker restart policies: https://docs.docker.com/engine/containers/start-containers-automatically/
