# Spec: Bot Discord tìm nguồn ảnh

- Ngày: 27/10/2026 (giờ Việt Nam)
- Trạng thái: chờ chủ server duyệt
- Thay thế phần thiết kế trong `Discord_Reverse_Image_Search_Plan.md` (v2.0). Khác biệt chính: bỏ Google Lens; Yandex chạy tự động, lấy quota từ Bright Data (5.000 lượt/tháng) và SerpApi (250 lượt/tháng).

## 1. Mục đích

Thành viên trong một server Discord tiếng Việt thường gửi ảnh và hỏi nguồn: cảnh anime ở tập nào, phút nào; fanart do ai vẽ, đăng ở đâu; khung hình thuộc phim nào. Bot trả lời ngay trong Discord để không ai phải tự mở nhiều trang tìm kiếm.

Bot phục vụ cả server bằng một bộ quota miễn phí dùng chung, nên phải: không tốn tiền, chịu được nhiều người dùng cùng lúc, chia quota công bằng và luôn trả lời, kể cả khi đã hết lượt.

**Thành công** (theo chủ server): mọi người dùng bot thường xuyên, kết quả đúng nhiều hơn sai, hết quota bot vẫn trả lời có ích.

## 2. Mục tiêu, ngoài phạm vi, điều cấm

### 2.1. Mục tiêu

1. Tìm nguồn bằng `/search` (tải ảnh lên) và bằng menu tin nhắn "Tìm nguồn ảnh".
2. Bốn chế độ: auto (mặc định), anime, art, movie.
3. 0 đồng chi phí API: chỉ dùng free tier, không thêm thẻ, không bật nạp tiền.
4. Nhiều người dùng cùng lúc: phản hồi ban đầu dưới 3 giây cho mọi lệnh; mỗi lượt tìm kết thúc trong 60 giây.
5. Mọi phản hồi đều có ích: kết quả, hoặc lý do rõ ràng kèm link tự tìm tiếp.
6. Phân biệt "không tìm thấy" với "chưa tìm vì hết lượt hoặc nguồn lỗi".

### 2.2. Ngoài phạm vi bản này

- Nhiều server, global command, user-install, DM.
- `/search-url`, tự quét ảnh trong kênh, video.
- Google Lens (chủ server đã bỏ).
- Hàng đợi bền vững, tách process, nhiều máy, khôi phục lượt tìm sau crash.
- Lệnh admin chỉnh hạn mức (chỉnh bằng biến môi trường rồi khởi động lại).
- Cache ảnh gần giống (perceptual hash).
- Benchmark chất lượng trước khi mở bot (chỉnh ngưỡng dần sau khi mở, mục 14.3).

### 2.3. Điều cấm (thất bại dù bot vẫn chạy)

- Hiện ảnh người lớn trong kênh thường.
- Khẳng định chắc chắn một nguồn sai.
- Tiêu hết quota tháng trong vài ngày, hoặc để một người chiếm hết quota.
- Bị khóa tài khoản nhà cung cấp: không dùng nhiều tài khoản, không xoay IP, không gọi thẳng Yandex từ IP máy chủ, không vượt rate limit.
- Im lặng hoặc treo khi hết quota hay gặp lỗi.
- Phát sinh chi phí.

## 3. Ràng buộc kỹ thuật (đã chốt)

| Mục | Giá trị |
| --- | --- |
| Runtime | Node 24, chạy `.ts` trực tiếp (type stripping); dùng `fetch`, `node:sqlite`, `node:test`, `--env-file` có sẵn |
| Thư viện (đã cài, pin chính xác) | discord.js 14.27.0, sharp 0.35.5, zod 4.6.7; dev: typescript 7.0.2, @types/node 24.19.2 |
| TypeScript | `tsconfig.json` có sẵn: `erasableSyntaxOnly` (không `enum`, không `namespace`), import tương đối ghi đuôi `.ts`, typecheck bằng `npm run typecheck` |
| Dependency mới | Chỉ thêm khi thư viện chuẩn và ba gói trên không đủ |
| Triển khai | Một process, Docker (`node:24-slim`) trên VPS Linux, chạy 24/7, restart `unless-stopped`, volume cho SQLite |
| Phạm vi Discord | Một server; lệnh đăng ký theo guild; chỉ bật intent `Guilds` |
| Ngôn ngữ | Mọi chữ bot hiển thị bằng tiếng Việt; tên lệnh giữ tiếng Anh: `/search`, `/quota`, `/help` |

## 4. Trải nghiệm người dùng

### 4.1. `/search`

| Option | Kiểu | Bắt buộc | Ghi chú |
| --- | --- | --- | --- |
| image | ATTACHMENT, `file_types: ["image"]` | Có | `file_types` chỉ lọc theo đuôi file; bot vẫn kiểm tra bytes |
| mode | STRING choices: auto "Tự động", anime "Cảnh anime", art "Art / tranh", movie "Phim người đóng" | Không | Mặc định auto |
| private | BOOLEAN | Không | true: chỉ người gọi thấy kết quả |

Kết quả mặc định công khai trong kênh; `private: true` thì ephemeral.

### 4.2. Menu tin nhắn "Tìm nguồn ảnh"

- Lấy ảnh ứng viên từ đúng tin nhắn được chọn, theo thứ tự: attachment là ảnh → `embed.image` → `embed.thumbnail`. Ảnh embed chỉ dùng `proxy_url`, không bao giờ tải `url` gốc.
- Không có ảnh: trả ephemeral hướng dẫn dùng `/search`.
- Một ảnh: tìm ngay bằng chế độ auto.
- Nhiều ảnh: trả ephemeral select menu "Chọn ảnh cần tìm nguồn" (tối đa 25 mục; mỗi mục ghi số thứ tự, tên file hoặc "ảnh xem trước của link <domain>", kích thước nếu có). Người dùng chọn xong mới tìm.
- Kết quả luôn ephemeral.

### 4.3. `/quota` (chỉ admin)

- Admin là người có quyền Manage Server; lệnh đăng ký với `default_member_permissions` tương ứng; phản hồi ephemeral.
- Cho từng nguồn: đã dùng và còn lại (hôm nay và tháng này; trace.moe theo 24 giờ), trạng thái (bình thường, hết lượt, lỗi gần đây), và tình trạng đường Yandex qua Bright Data (đang dùng được hay đang tạm chuyển sang SerpApi).

### 4.4. `/help`

Ephemeral. Gồm cách dùng hai cách tìm, bốn chế độ, hạn mức mỗi người, và câu: "Ảnh bạn tìm sẽ được gửi tới trace.moe, SauceNAO, Danbooru và Yandex (qua Bright Data hoặc SerpApi)."

### 4.5. Hạn mức mỗi người (áp dụng cả admin)

- Tối đa 30 lượt tìm mỗi ngày; trong đó tối đa 10 lượt có gọi Yandex (tính cả lượt bot tự gọi và nút "Tìm thêm bằng Yandex"). Trong 10 lượt Yandex đó, tối đa 2 lượt chạy qua SerpApi, để một người không dùng hết phần SerpApi ít ỏi của cả server.
- Mỗi người chỉ có 1 lượt tìm đang chạy; cooldown 10 giây giữa hai lượt.
- Một lượt tìm là: một lần `/search`, một lần chọn ảnh từ menu tin nhắn, hoặc một lần "Đổi chế độ". Nút "Tìm thêm bằng Yandex" không tính thêm lượt tìm, chỉ tính lượt Yandex.
- Ngày tính theo giờ Việt Nam (00:00 Asia/Ho_Chi_Minh).
- Kiểm tra cooldown và hạn mức trước khi defer. Vi phạm thì trả ephemeral ngay, ví dụ "Đợi 6 giây nữa rồi thử lại" hoặc "Bạn đã dùng hết 30 lượt hôm nay" kèm link tự tìm.

### 4.6. Tin nhắn kết quả (kiểu C, chủ server đã chọn)

Một embed gồm:

1. Nhãn mức tin cậy: NGUỒN TÌM ĐƯỢC (viền xanh), CÓ THỂ LÀ (viền vàng), LIÊN QUAN (viền xám).
2. Tiêu đề: tên nguồn chính, có link tới trang nguồn.
3. Dòng chi tiết theo loại: anime "Tập 5 · 12:34"; art "Tác giả: X · Pixiv"; phim hoặc trang web "tên trang · domain". Kèm "khớp 96% · trace.moe" khi engine có điểm.
4. Ảnh xem trước lớn (embed image) của kết quả chính, nếu được phép theo mục 8.
5. "Ứng viên khác": tối đa 2 dòng; mỗi dòng có link, mô tả ngắn, điểm và engine, mức tin cậy.
6. "Tự tìm tiếp": link Yandex · SauceNAO · Google Lens · trace.moe · IQDB · ascii2d · Bing · TinEye, viết dạng markdown trong description (không dùng link button). Nếu description vượt giới hạn của Discord thì bỏ bớt link từ cuối danh sách này.
7. Footer: "Đã tìm: <các engine đã chạy> · Bạn còn N lượt hôm nay · Mã: <mã lượt tìm 4–6 ký tự>". Mã dùng để tra log khi có người báo kết quả sai.

Nút bấm (chỉ người tìm bấm được, hết hạn sau 10 phút):

- "Đổi chế độ": mở select menu bốn chế độ, rồi chạy lại lượt tìm với chế độ mới (dùng cache nếu có).
- "Tìm thêm bằng Yandex": chỉ hiện khi lượt tìm này chưa gọi Yandex và cả server lẫn người dùng còn lượt Yandex.
- Người khác bấm: ephemeral "Chỉ người tìm mới dùng được nút này". Phiên hết hạn hoặc bot đã khởi động lại: ephemeral "Phiên đã hết, hãy tìm lại".

Mọi tin nhắn của bot dùng `allowedMentions: { parse: [] }`.

### 4.7. Các trạng thái khác (đã duyệt mockup)

| Trạng thái | Nội dung |
| --- | --- |
| Đang tìm | Embed xám "ĐANG TÌM…", "Đã xong: …", "Đang hỏi: …", "Tối đa 60 giây"; cập nhật sau mỗi engine |
| Không tìm thấy | Embed xám "CHƯA XÁC ĐỊNH ĐƯỢC NGUỒN", các engine đã thử, link tự tìm, nút "Đổi chế độ" và "Tìm thêm bằng Yandex" (nếu đủ điều kiện) |
| Chưa tìm hết | Embed vàng "CHƯA TÌM HẾT": từng engine chưa chạy kèm lý do (hết lượt hôm nay của server, đang bận, lỗi), kết quả đã có (nếu có), link tự tìm |
| Bot bận | Đang có đủ 100 lượt tìm chạy: trả ngay "Bot đang bận, thử lại sau ít phút" kèm link tự tìm |
| Ảnh lỗi | "Không đọc được ảnh", "Ảnh lớn hơn 10 MB", "Ảnh lớn hơn 20 triệu điểm ảnh"; báo trước khi gọi engine |

Mockup tham khảo: `.superpowers/brainstorm/1023-1793102217/content/result-layout.html` (phương án C) và `result-states.html` trong cùng thư mục.

## 5. Nguồn tìm kiếm

| Engine | Tài khoản | Quota miễn phí | Cách gửi ảnh | Ghi chú |
| --- | --- | --- | --- | --- |
| trace.moe | Không cần (guest) | 100 lượt / 24 giờ trượt, theo IP máy chạy bot; 1 request đồng thời (đã xác minh) | POST bytes ảnh chuẩn hóa tới `https://api.trace.moe/search` với `anilistInfo` và cắt viền đen | Không dùng `cutBorders=2` (có thể tốn 2 lượt). Trả tập, `from`/`to`, ảnh và video xem trước, `anilist.isAdult` |
| SauceNAO | Tài khoản free và API key | Đọc từ response (`short_remaining`, `long_remaining`); nguồn bên thứ ba ghi khoảng 200/ngày và vài lượt/30 giây (chưa xác minh) | Upload bytes ảnh chuẩn hóa, `output_type=2` | Tham số `hide` ở kênh thường. Điều khoản cấm dùng nhiều tài khoản/IP để vượt giới hạn |
| Danbooru IQDB | Tài khoản free và API key (HTTP Basic) | Không thấy quota ngày; giới hạn đọc chung 10 request/giây; bot dùng tối đa 1 request/giây | `GET https://danbooru.donmai.us/iqdb_queries.json?url=<URL ảnh Discord>` | User-Agent riêng có tên bot và user ID Danbooru. Trả post (source, artist, rating) và điểm |
| Yandex qua Bright Data (đường chính) | API key và zone | 5.000 lượt/tháng, reset ngày 1; mỗi request 1 lượt (đã xác minh) | Bright Data tải trang `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url=<URL ảnh Discord>`; bot tự đọc HTML | **Chưa xác minh** Bright Data chấp nhận URL này; xem mục 13 |
| Yandex qua SerpApi (dự phòng) | API key | 250 lượt/tháng, 50 lượt/giờ; chỉ tính lượt thành công (đã xác minh) | `engine=yandex_images&url=<URL ảnh Discord>`, trả JSON | Dùng khi đường Bright Data hết lượt, lỗi hoặc đang bị đánh dấu hỏng |

Yandex là một engine có hai đường cung cấp. Bot thử Bright Data trước; nếu lỗi, hết lượt hoặc đang bị đánh dấu hỏng thì dùng SerpApi; nếu cả hai đều không dùng được thì Yandex được ghi là "chưa chạy" kèm lý do. Đọc HTML từ Bright Data thất bại 3 lần liên tiếp thì đánh dấu đường này hỏng trong 1 giờ (đi thẳng SerpApi) và hiện trong `/quota`. Nếu Bright Data chỉ đang bận (không có slot trong 5 giây) thì không chuyển sang SerpApi; Yandex được bỏ qua với lý do "đang bận".

## 6. Luồng tìm kiếm

### 6.1. Quy tắc chung

- Kiểm tra cache trước khi gọi mỗi engine.
- Mỗi engine có limiter riêng (đồng thời, cửa sổ thời gian, ngân sách ngày/tháng). Ngoài `MAX_ACTIVE_JOBS`, không có giới hạn chung cho số lượt tìm chạy cùng lúc.
- Engine kế tiếp chưa có slot trong 5 giây: nếu còn engine thay thế phù hợp thì chuyển sang engine đó; nếu không thì bỏ qua engine này với lý do "đang bận".
- Timeout mỗi engine 15 giây; deadline cả lượt tìm 60 giây tính từ lúc nhận lệnh; mỗi lần gọi bị giới hạn thêm bởi thời gian còn lại.
- Trong một lượt tìm, mỗi engine chỉ gọi một lần.
- Dừng sớm khi đã có kết quả mức NGUỒN.
- Cập nhật tin nhắn sau mỗi engine.

### 6.2. Thứ tự theo chế độ

| Chế độ | Thứ tự |
| --- | --- |
| auto | SauceNAO (bận hoặc hết lượt thì Danbooru) → trace.moe nếu SauceNAO cho thấy ảnh là anime nhưng chưa đủ tập và thời điểm → Yandex nếu chưa có kết quả NGUỒN → trace.moe nếu ảnh vẫn chưa rõ loại và còn phần quota dành cho ảnh chưa rõ loại |
| anime | trace.moe → SauceNAO → Yandex |
| art | SauceNAO → Danbooru → Yandex |
| movie | Yandex → SauceNAO (chỉ các index Movies và Shows) |

- "SauceNAO cho thấy ảnh là anime": có kết quả thuộc index anime với điểm từ ngưỡng CÓ THỂ LÀ trở lên. Nếu kết quả đó đã có tập và thời điểm với điểm từ ngưỡng NGUỒN trở lên thì dừng, không gọi trace.moe.
- "Ảnh vẫn chưa rõ loại": sau SauceNAO và Yandex vẫn chưa có kết quả nào từ mức CÓ THỂ LÀ trở lên.

### 6.3. Mức tin cậy

Ngưỡng khởi điểm do tôi đề xuất ở mức thận trọng, chưa có số liệu đo; đặt thành hằng số cấu hình trong code và chỉnh dần sau khi mở bot (mục 14.3).

| Engine | NGUỒN | CÓ THỂ LÀ |
| --- | --- | --- |
| SauceNAO | similarity ≥ 90 | 70 đến dưới 90 |
| trace.moe | similarity ≥ 0,92 | 0,85 đến dưới 0,92 |
| Danbooru IQDB | score ≥ 90 | 70 đến dưới 90 (thang điểm cần xác minh) |
| Yandex | Không bao giờ | Trang thuộc domain nguồn đã biết: pixiv.net, x.com, twitter.com, danbooru.donmai.us, gelbooru.com, artstation.com, deviantart.com, imdb.com, themoviedb.org, myanimelist.net, anilist.co |

- Kết quả dưới ngưỡng CÓ THỂ LÀ của engine có điểm: bỏ.
- Các kết quả Yandex còn lại: LIÊN QUAN.
- Không cộng hay lấy trung bình điểm giữa các engine.

### 6.4. Chọn kết quả hiển thị

- Kết quả chính: mức tin cậy cao nhất; cùng mức thì ưu tiên trace.moe, rồi SauceNAO, Danbooru, Yandex; cùng engine thì điểm cao hơn.
- Ứng viên khác: 2 kết quả kế tiếp, bỏ trùng theo URL nguồn.
- Thông tin hiển thị theo engine:
  - trace.moe: tên anime (romaji, thêm tên tiếng Anh nếu khác), tập, thời điểm `from` dạng mm:ss hoặc h:mm:ss, ảnh xem trước, link "Xem đoạn cảnh" tới video.
  - SauceNAO: tiêu đề, tác giả, link nguồn đầu tiên, ảnh thu nhỏ, tên index; với index anime thì thêm tập và thời điểm nếu response có.
  - Danbooru: artist, link source gốc (không có thì link post Danbooru), ảnh xem trước, rating.
  - Yandex: tiêu đề trang, link, domain.

## 7. Quota, hạn mức và đồng thời

### 7.1. Giới hạn khởi điểm

| Thành phần | Đồng thời | Cửa sổ | Ngân sách |
| --- | --- | --- | --- |
| trace.moe | 1 | Không | 100 / 24 giờ trượt; bước "ảnh chưa rõ loại" trong auto dùng tối đa 50% |
| SauceNAO | 2 cho tới khi có header, sau đó theo `short_remaining` | 30 giây | Theo `long_remaining` |
| Danbooru | 1 | 1 request/giây | Không |
| Yandex qua Bright Data | 8 | Không | 5.000/tháng, chia theo ngày |
| Yandex qua SerpApi | 1 | 50/giờ | 250/tháng, chia theo ngày |
| Giải mã ảnh | 2 | Không | Không |
| Toàn bot | 100 lượt tìm đang chạy (`MAX_ACTIVE_JOBS`) | Không | Không |

### 7.2. Chia ngân sách tháng

`hạn mức hôm nay = phần còn lại của tháng ÷ số ngày còn lại trong tháng (tính cả hôm nay)`, làm tròn xuống, tối thiểu 1. Phần chưa dùng của hôm nay tự dồn sang các ngày sau qua công thức này. Bright Data reset ngày 1 hàng tháng; kỳ của SerpApi lấy từ Account API.

### 7.3. Đồng bộ với nhà cung cấp

| Nguồn | Cách đồng bộ |
| --- | --- |
| trace.moe | `GET https://api.trace.moe/me` lúc khởi động và mỗi 10 phút; dùng `quota` và `quotaUsed` |
| SauceNAO | Header trong mỗi response |
| Danbooru | Header `x-rate-limit` |
| SerpApi | Account API lúc khởi động và mỗi giờ |
| Bright Data | Bộ đếm cục bộ trong SQLite (chưa xác minh có API xem usage) |

- Luôn kiểm tra bộ đếm cục bộ trước khi gọi.
- Timeout sau khi đã gửi request: tính là đã dùng 1 lượt, không retry.
- Chỉ retry 1 lần với lỗi kết nối xảy ra trước khi request được gửi đi.

### 7.4. Trạng thái engine trả về

`ok`, `no_match`, `quota_exhausted`, `rate_limited`, `timeout`, `invalid_input`, `unavailable`. Response không khớp schema zod thì trả `unavailable`, ghi log, không làm bot crash.

## 8. Nội dung người lớn

Kênh thường là kênh không bật NSFW (age-restricted). Kết quả ephemeral áp dụng theo loại kênh nơi lệnh được gọi.

| Nguồn | Kênh thường | Kênh NSFW |
| --- | --- | --- |
| SauceNAO | Gửi kèm tham số `hide` để ẩn kết quả explicit (giá trị chốt ở giai đoạn 0) | Không ẩn |
| trace.moe | `anilist.isAdult = true`: không hiện ảnh/video xem trước, chỉ hiện chữ | Hiện |
| Danbooru | Chỉ hiện ảnh xem trước khi rating là `g`; còn lại chỉ hiện link | Hiện |
| Yandex | Không hiện ảnh xem trước | Hiện |

## 9. Xử lý ảnh

1. Kiểm tra cooldown và hạn mức, rồi `deferReply` (đúng chế độ công khai hoặc ephemeral) ngay khi nhận interaction; mục tiêu dưới 1 giây.
2. Chỉ tải từ host Discord: `cdn.discordapp.com`, `media.discordapp.net`. Giữ nguyên query ký số `ex`, `is`, `hm`. Đọc `ex` (hex timestamp hết hạn) để biết URL còn dùng được tới khi nào.
3. Tải dạng stream, dừng khi vượt 10 MiB; timeout tải 10 giây.
4. Giải mã bằng sharp với `limitInputPixels: 20_000_000`, xoay theo EXIF, GIF lấy frame đầu. Nhận đủ nhóm `image` của Discord: PNG, JPEG, WebP, GIF, AVIF. Giải mã lỗi thì báo và không gọi engine.
5. Tạo bản chuẩn hóa: cạnh dài tối đa 2048 px, JPEG, dùng để upload cho trace.moe và SauceNAO. Engine nhận URL (Danbooru, Yandex) dùng URL ảnh Discord gốc.
6. Attachment của `/search` không gắn với tin nhắn nên không lấy lại URL mới được: phải tải ngay. Với menu tin nhắn, URL hết hạn thì fetch lại tin nhắn để lấy URL mới.
7. Phiên của nút giữ bản chuẩn hóa trong RAM 10 phút; tổng tối đa 128 MiB, đầy thì bỏ phiên cũ nhất. Không ghi ảnh ra đĩa.

## 10. Cache

- Khóa: SHA-256 của bytes ảnh tải về + engine + mọi tham số ảnh hưởng kết quả (chế độ, giá trị `hide`, index giới hạn, phiên bản parser).
- Thời hạn: kết quả có nguồn hoặc ứng viên giữ 30 ngày; `no_match` giữ 24 giờ; lỗi, timeout, hết lượt: không cache.
- Lưu thêm `attachment_id → SHA-256` (30 ngày) để nhiều người tìm cùng một attachment không phải tải lại.
- Gộp request trùng đang chạy (cùng khóa) thành một lần gọi engine; trả kết quả cho từng người.
- Cache dùng chung trong server; khóa có kèm guild id để sau này mở rộng không lẫn dữ liệu.
- Xóa bản ghi hết hạn định kỳ (mỗi giờ).

## 11. Kiến trúc

### 11.1. Một process

~~~text
src/
  index.ts       khởi động, đăng ký lệnh guild, tắt có kiểm soát
  config.ts      đọc env, kiểm tra bằng zod
  discord/       /search, menu tin nhắn, /quota, /help, nút, select menu, render embed
  search/        orchestrator: thứ tự theo chế độ, deadline, kết quả từng phần, chọn kết quả
  engines/       tracemoe, saucenao, danbooru, yandex (đường bright data, đường serpapi, parser HTML)
  limits/        limiter từng engine, ngân sách ngày/tháng, hạn mức người dùng
  images/        tải an toàn, sharp
  store/         node:sqlite: cache, usage, bộ đếm người dùng, trạng thái nhà cung cấp
~~~

Ranh giới module trên là định hướng; người triển khai được chỉnh nếu có lý do.

### 11.2. Hợp đồng engine

Mỗi engine nhận ảnh (bytes chuẩn hóa hoặc URL Discord), chế độ, cờ NSFW của kênh, và thời hạn còn lại; trả về trạng thái (mục 7.4), danh sách kết quả đã chuẩn hóa (tiêu đề, link, chi tiết, điểm gốc nếu có, ảnh xem trước, cờ người lớn nếu biết, mức tin cậy) và ảnh chụp quota nếu nhà cung cấp trả về.

### 11.3. Dữ liệu lưu trong SQLite (WAL)

- Cache kết quả (mục 10) và ánh xạ `attachment_id → SHA-256`.
- Lượng đã dùng của từng nhà cung cấp theo kỳ (ngày, tháng).
- Ảnh chụp trạng thái nhà cung cấp: trace.moe `/me`, SauceNAO còn lại, SerpApi Account API, tình trạng đường Yandex qua Bright Data.
- Bộ đếm mỗi người mỗi ngày: số lượt tìm, số lượt Yandex.

Cooldown, lượt tìm đang chạy và phiên nút chỉ nằm trong RAM. Schema cụ thể do người triển khai quyết định.

### 11.4. Vận hành

- Tắt có kiểm soát khi nhận SIGTERM: ngừng nhận lệnh mới (trả "Bot đang khởi động lại, thử lại sau ít giây"), chờ các lượt tìm đang chạy tối đa 60 giây rồi thoát.
- Crash: các lượt tìm đang chạy bị mất; người dùng tìm lại.
- Log dạng JSON một dòng ra stdout; không bao giờ ghi token, API key, query ký số của URL Discord hay bytes ảnh. Mỗi lượt tìm ghi một dòng tổng kết: mã lượt tìm, chế độ, kênh có NSFW không, các engine đã gọi kèm trạng thái và điểm gốc, mức tin cậy đã gán, kết quả chính và ứng viên đã hiển thị.
- Docker: image `node:24-slim`, `npm ci --omit=dev` bên trong image (không copy `node_modules` từ Windows), chạy `node src/index.ts`, volume `./data`, `env_file: .env`, restart `unless-stopped`.

## 12. Cấu hình (biến môi trường)

~~~text
DISCORD_TOKEN
DISCORD_APPLICATION_ID
DISCORD_GUILD_ID
SAUCENAO_API_KEY
DANBOORU_LOGIN
DANBOORU_API_KEY
BRIGHTDATA_API_KEY
BRIGHTDATA_ZONE
SERPAPI_API_KEY
SQLITE_PATH=./data/bot.db
BRIGHTDATA_MONTHLY_CREDITS=5000
SERPAPI_MONTHLY_SEARCHES=250
IMAGE_MAX_BYTES=10485760
IMAGE_MAX_PIXELS=20000000
ENGINE_TIMEOUT_MS=15000
JOB_DEADLINE_MS=60000
MAX_ACTIVE_JOBS=100
USER_COOLDOWN_MS=10000
USER_DAILY_SEARCHES=30
USER_DAILY_YANDEX=10
USER_DAILY_YANDEX_SERPAPI=2
TRACE_UNKNOWN_SHARE=0.5
CACHE_HIT_TTL_DAYS=30
CACHE_MISS_TTL_HOURS=24
~~~

Thiếu biến bắt buộc hoặc giá trị sai kiểu thì bot dừng ngay lúc khởi động với thông báo rõ ràng.

## 13. Giai đoạn 0: xác minh trước khi viết adapter

Chạy bằng script thủ công với key thật; lưu response mẫu (đã xóa thông tin nhạy cảm) làm fixture cho test.

Phân công:

- **Chủ server chuẩn bị:** tài khoản và key (Discord app đã mời bot vào server, SauceNAO, Danbooru, SerpApi, Bright Data kèm zone) điền vào `.env`; VPS Linux; một kênh thử thường và một kênh thử NSFW; ít nhất 2 tài khoản Discord để thử nút; vài ảnh mẫu (gồm ảnh nhạy cảm) để chọn giá trị `hide` của SauceNAO.
- **Người triển khai:** viết script giai đoạn 0 và hướng dẫn chạy; chạy script khi `.env` đã có key (riêng trace.moe `/me` chạy trên VPS); lưu fixture.
- **Thứ tự làm:** các phần không cần key làm trước (xử lý ảnh, store, limits, orchestrator với engine giả, lớp Discord). Adapter viết theo tài liệu và chỉ coi là xong khi đã chạy đúng với fixture và key thật.
- Triển khai chỉ bắt đầu sau khi spec này được duyệt.

1. **Yandex qua Bright Data:** loại zone nào (SERP API hay Web Unlocker) chấp nhận URL tìm ảnh của Yandex; response có phải HTML đọc được, không bị captcha; Yandex có tải được URL ảnh Discord không.
2. **Yandex qua SerpApi:** dạng JSON trả về với URL ảnh Discord.
3. **SauceNAO:** hạn mức thật trong header; giá trị `hide` phù hợp; mã index của anime, Movies, Shows.
4. **Danbooru IQDB:** gọi được bằng tài khoản free và API key; tham số `url`; dạng response; thang điểm.
5. **trace.moe:** `/me` từ VPS; POST ảnh JPEG chuẩn hóa chạy đúng.
6. **Discord:** đăng ký được `file_types` (nếu builder của discord.js chưa hỗ trợ thì đăng ký bằng JSON thô); URL attachment của `/search` có tải được từ Yandex và Danbooru không.

Phương án dự phòng:

- Bright Data không dùng được cho Yandex: Yandex chỉ còn SerpApi (khoảng 8 lượt/ngày); dừng lại hỏi chủ server có bật lại Google Lens bằng 5.000 lượt của Bright Data không.
- URL attachment của `/search` không tải được từ bên ngoài: Danbooru và Yandex trả `invalid_input` cho ảnh tải lên bằng `/search` (ảnh từ menu tin nhắn vẫn chạy); báo chủ server.

## 14. Kiểm thử và nghiệm thu

### 14.1. Cách kiểm thử

- Dùng `node:test`. Unit test cho: parser từng engine (từ fixture giai đoạn 0, kể cả HTML Yandex), phân loại mức tin cậy, chọn kết quả, limiter và công thức chia ngân sách, khóa cache, tạo link tự tìm (kể cả giới hạn độ dài), lấy ảnh ứng viên từ tin nhắn (kể cả embed chỉ dùng `proxy_url`), quy tắc NSFW, render embed trong giới hạn Discord.
- Kiểm thử tải và lỗi bằng engine giả, không tốn quota thật.
- Smoke test số lượng nhỏ với API thật sau khi xong từng engine.

### 14.2. Tiêu chí nghiệm thu

| Ca thử | Kết quả mong đợi |
| --- | --- |
| Chọn ảnh qua `image`, bỏ trống mode | Nhận đúng attachment, chạy auto |
| Menu tin nhắn: một ảnh, nhiều ảnh, không có ảnh | Tìm ngay; chọn ảnh trước; hướng dẫn |
| Embed có `url` trỏ vào IP nội bộ | Chỉ tải qua `proxy_url` |
| Đuôi file giả, ảnh hỏng, trên 10 MiB, trên 20 triệu điểm ảnh | Báo lỗi trước khi gọi engine |
| 20 rồi 50 người gửi cùng lúc (engine giả) | Tất cả được phản hồi ban đầu trong 3 giây; không vượt limiter; mỗi người nhận kết quả hoặc link tự tìm trong 60 giây |
| SauceNAO hết lượt trong cửa sổ 30 giây | Auto chuyển sang Danbooru, không đứng chờ |
| Đường Bright Data lỗi đọc HTML 3 lần | Chuyển sang SerpApi trong 1 giờ; `/quota` hiện trạng thái |
| Một engine hết quota ngày | Bỏ qua, ghi "chưa tìm vì hết lượt" |
| Hết toàn bộ quota | Vẫn trả cache và link tự tìm |
| Một người gửi liên tục | Cooldown và hạn mức chặn; người khác không bị ảnh hưởng |
| Hai người tìm cùng một ảnh | Mỗi engine chỉ gọi một lần; lần sau trúng cache |
| Timeout sau khi đã gửi request | Tính một lượt đã dùng; không retry |
| Ngân sách Bright Data trong tháng | Không vượt hạn mức ngày đã chia |
| Kênh thường và kênh NSFW | Ẩn/hiện ảnh xem trước đúng mục 8 |
| Người khác bấm nút; bấm sau 10 phút | Báo đúng thông điệp, không tốn quota |
| SIGTERM khi đang tìm | Lượt đang chạy hoàn tất; lệnh mới nhận thông báo khởi động lại |

### 14.3. Chỉnh ngưỡng sau khi mở bot

Chủ server chọn mở bot ngay với ngưỡng thận trọng, không chạy benchmark trước.

- Mỗi lượt tìm có mã hiện ở footer và một dòng log tổng kết (mục 11.4).
- Khi có người báo kết quả sai, admin dùng mã để tra log.
- Sau khoảng 2 tuần, hoặc khi đã có vài báo sai, chỉnh ngưỡng ở mục 6.3 dựa trên điểm gốc trong log. Việc này không tốn thêm quota.

## 15. Quyết định

### 15.1. Chủ server đã chốt

- Dùng discord.js.
- Một server, giao diện tiếng Việt, chạy 24/7 trên VPS Linux bằng Docker.
- Ở kênh thường bot tự ẩn ảnh người lớn.
- Thành công là mọi người dùng thường xuyên, đúng nhiều hơn sai, hết quota vẫn trả lời.
- Tin nhắn kết quả kiểu C và các trạng thái như mockup.
- `/search` công khai (có tùy chọn riêng tư); menu tin nhắn chỉ người bấm thấy.
- 30 lượt tìm mỗi người mỗi ngày; admin cũng bị giới hạn.
- Có `/quota` cho admin; tên lệnh `/search`.
- Chỉ dùng Yandex, bỏ Google Lens; Yandex chạy tự động; quota Yandex lấy từ Bright Data và SerpApi.
- 0 đồng; không nhiều tài khoản, không xoay IP; một process (từ plan v2.0).
- Mở bot ngay với ngưỡng thận trọng rồi chỉnh dần theo log; không chạy benchmark trước.

### 15.2. Tôi quyết định (chủ server xem lại khi đọc)

1. Giới hạn Yandex mỗi người 10 lượt/ngày (trước đây là 2 khi Yandex chỉ có khoảng 8 lượt/ngày).
2. Giữ link Google Lens trong "Tự tìm tiếp" vì không tốn quota.
3. Kết quả Yandex cao nhất chỉ là CÓ THỂ LÀ, không bao giờ là NGUỒN.
4. Bright Data là đường Yandex chính, SerpApi là dự phòng.
5. Ngày tính theo giờ Việt Nam; admin là người có quyền Manage Server.
6. Có thêm `/help`.
7. Ngưỡng NGUỒN ở mức thận trọng (SauceNAO 90, trace.moe 0,92, Danbooru 90); thời hạn cache 30 ngày và 24 giờ.
8. Chế độ movie giới hạn SauceNAO ở index Movies và Shows.
9. Kết quả ephemeral vẫn theo quy tắc NSFW của kênh nơi gọi lệnh.
10. Bright Data chỉ đang bận thì bỏ qua Yandex, không dùng SerpApi; giới hạn đồng thời của Bright Data là 8.
11. Mỗi người tối đa 2 lượt Yandex mỗi ngày qua SerpApi (trong tổng 10).
12. Phân công giai đoạn 0 và thứ tự làm như mục 13.
13. Footer có mã lượt tìm; log ghi điểm gốc của mỗi lượt để chỉnh ngưỡng.

### 15.3. Để người triển khai tự quyết

Cấu trúc chi tiết trong từng module, schema SQLite, cách đọc HTML Yandex, cách hiện thực limiter, câu chữ tiếng Việt cụ thể, định dạng log, nội dung Dockerfile và compose, cách tổ chức test.

## 16. Tham khảo

- Discord Application Commands (`file_types`, contexts): https://docs.discord.com/developers/interactions/application-commands
- Discord Receiving and Responding (3 giây, token 15 phút): https://docs.discord.com/developers/interactions/receiving-and-responding
- Discord Reference (lọc file, URL CDN có chữ ký): https://docs.discord.com/developers/reference
- Discord Message resource (Attachment, Embed, `proxy_url`): https://docs.discord.com/developers/resources/message
- trace.moe `/me`: https://api.trace.moe/me
- trace.moe API swagger: https://github.com/soruly/trace.moe-api/blob/master/swagger.yaml
- trace.moe About (người tài trợ có quota cao hơn): https://trace.moe/about
- SauceNAO Terms: https://saucenao.com/legal.html
- Tham số SauceNAO (bên thứ ba): https://kituin.github.io/wiki/picimagesearch/SauceNAO/DataStructure/
- Danbooru API: https://danbooru.donmai.us/wiki_pages/help:api
- Danbooru Terms of Service: https://danbooru.donmai.us/terms_of_service
- Danbooru IQDB controller: https://github.com/danbooru/danbooru/blob/master/app/controllers/iqdb_queries_controller.rb
- Bright Data Free Tier: https://docs.brightdata.com/general/account/billing-and-pricing/free-tier
- Bright Data SERP API: https://github.com/luminati-io/serp-api
- SerpApi Pricing: https://serpapi.com/pricing
- SerpApi Yandex Reverse Image: https://serpapi.com/yandex-reverse-image-api
- SerpApi Account API: https://serpapi.com/account-api
- PicImageSearch (cách gọi Yandex tìm bằng ảnh): https://github.com/kitUIN/PicImageSearch
- Docker restart policies: https://docs.docker.com/engine/containers/start-containers-automatically/
