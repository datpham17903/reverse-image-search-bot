# Bot Discord tìm nguồn ảnh — Implementation Plan (v3.0 Updated)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây dựng bot Discord tìm nguồn ảnh (Anime, Art/Manga/Doujinshi 2D, Phim/Cosplay/3D, hỗ trợ đầy đủ cả SFW & NSFW) bằng `trace.moe`, `SauceNAO` (Multi-key + Web HTML Fallback), `Danbooru + IQDB.org` và `Yandex Images` (Direct + Bright Data / SerpApi), hoạt động **Free 100%, Không giới hạn (Unlimited) và Không độ trễ (Zero-Delay Parallel Waves)**.

**Architecture:** Một process Node 24 chạy `discord.js` qua Gateway (kèm `--use-env-proxy` kết nối với sidecar Cloudflare WARP khi chạy Docker). `/search`, menu tin nhắn và các nút đi qua một luồng chung: kiểm tra hạn mức → defer → tải và chuẩn hóa ảnh → orchestrator chạy song song theo đợt (`nextBatch`: Đợt 1 gồm `saucenao`, `danbooru/iqdb`, `tracemoe`; Đợt 2 gồm `yandex`) → runner gọi engine qua cache, gộp request, gate từng nhà cung cấp → render embed kiểu C với kiểm soát ẩn/hiện preview NSFW theo loại kênh (`previewAllowed`). SQLite (`node:sqlite`) giữ cache, lượng dùng và bộ đếm người dùng; phiên nút và lượt tìm đang chạy nằm trong RAM.

**Tech Stack:** Node 24 (type stripping, `--use-env-proxy`, `fetch`, `node:sqlite`, `node:test`), TypeScript 7.0.2 (chỉ typecheck), discord.js 14.27.0, sharp 0.35.5, zod 4.6.7, Docker + Cloudflare WARP (`caomingjun/warp`).

**Spec:** `docs/superpowers/specs/2026-10-27-discord-reverse-image-search-bot-design.md`

## Global Constraints

- Node 24, chạy `.ts` trực tiếp (type stripping); dùng `fetch`, `node:sqlite`, `node:test`, `--env-file-if-exists`, `--use-env-proxy` có sẵn.
- Thư viện pin chính xác: discord.js 14.27.0, sharp 0.35.5, zod 4.6.7; dev: typescript 7.0.2, @types/node 24.19.2. Chỉ thêm dependency khi thư viện chuẩn và ba gói trên không đủ.
- `tsconfig.json`: `erasableSyntaxOnly` (không `enum`, không `namespace`, không parameter properties), import tương đối ghi đuôi `.ts`, typecheck bằng `npm run typecheck`.
- Một process; Docker `node:24-slim` đi kèm sidecar `caomingjun/warp:latest`; restart `unless-stopped`; volume cho SQLite.
- Một server; lệnh đăng ký theo guild; chỉ bật intent `Guilds`.
- Mọi chữ bot hiển thị bằng tiếng Việt; tên lệnh `/search`, `/quota`, `/help`; menu tin nhắn "Tìm nguồn ảnh".
- Mọi tin nhắn của bot dùng `allowedMentions: { parse: [] }`.
- 0 đồng & Không bắt buộc API key bên thứ ba: chỉ yêu cầu 3 biến Discord (`DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`); các key khác là tùy chọn.
- Hỗ trợ tìm nguồn NSFW ở mọi kênh nhưng tự động ẩn ảnh/video preview nhạy cảm ở kênh thường (`previewAllowed`).
- Log JSON một dòng ra stdout; không bao giờ ghi token, API key, query ký số của URL Discord hay bytes ảnh.
- Chỉ tải ảnh từ `https://cdn.discordapp.com` và `https://media.discordapp.net`; ảnh embed chỉ dùng `proxy_url`.
- Phản hồi ban đầu dưới 3 giây; mỗi lượt tìm kết thúc trong `JOB_DEADLINE_MS` (60 giây).
- Test: `node:test` + `node:assert/strict`, file `test/**/*.test.ts`, chạy bằng `npm test`. Unit test không bao giờ gọi mạng thật.

## Review Focus

1. Tiêu đề hoặc tên tác giả từ bên thứ ba có markdown, `@everyone`, dấu `[` `]` `(` `)`: phải hiện nguyên văn, không ping ai, không tạo link giả (Task 12, test "third-party text is escaped").
2. URL ảnh Discord rất dài (tên file dài): embed vẫn trong giới hạn 4096 ký tự description bằng cách bỏ bớt link tự tìm từ cuối (Task 12, test "long image URL").
3. Nhà cung cấp trả HTTP 200 nhưng JSON hoặc HTML lạ (đổi schema, captcha): engine đó báo "lỗi", engine khác vẫn chạy, bot không crash (Task 14–18, test "unexpected payload"; Task 18 test captcha).
4. Attachment không có `contentType` hoặc đuôi viết hoa (`IMG_0001.JPG`), file không phải ảnh, embed không có `proxyURL`: danh sách ảnh ứng viên đúng (Task 8, test "candidates").
5. Bấm nút cũ sau khi bot khởi động lại, phiên bị đẩy khỏi RAM, hoặc người khác bấm: trả ephemeral đúng thông điệp, không tốn quota, không đổi bộ đếm (Task 19, test "stale or foreign component").

---

## Cấu trúc file

```text
src/
  config.ts                 Task 1   đọc env bằng zod
  log.ts                    Task 2   log JSON + redact
  util/time.ts              Task 2   khóa ngày VN/UTC, số ngày còn lại, định dạng mm:ss
  util/code.ts              Task 2   mã lượt tìm 6 ký tự
  util/discord-url.ts       Task 2   kiểm tra host Discord, đọc `ex`, cắt query
  engines/types.ts          Task 4   kiểu dùng chung (Engine, Match, Outcome…)
  store/db.ts               Task 4   mở SQLite, PRAGMA, tạo bảng
  store/cache.ts            Task 4   cache kết quả + attachment_id → sha256
  store/usage.ts            Task 4   bảng calls (lượng dùng) + provider_state
  store/user-counters.ts    Task 4   bộ đếm người dùng theo ngày
  limits/semaphore.ts       Task 5
  limits/window.ts          Task 5   cửa sổ trượt
  limits/budget.ts          Task 5   chia ngân sách tháng theo ngày
  limits/health.ts          Task 5   đánh dấu hỏng đường Bright Data
  limits/gates.ts           Task 6   gate + ngân sách từng nhà cung cấp
  limits/user-limits.ts     Task 7   cooldown, 1 lượt đang chạy, hạn mức ngày
  images/candidates.ts      Task 8   lấy ảnh ứng viên từ tin nhắn
  images/download.ts        Task 8   tải an toàn
  images/normalize.ts       Task 8   sharp: kiểm tra, xoay, thu nhỏ, JPEG
  images/load.ts            Task 8   tải hoặc dùng lại hash theo attachment
  search/tiers.ts           Task 9   ngưỡng và mức tin cậy
  search/select.ts          Task 9   chọn kết quả chính + 2 ứng viên
  search/deeplinks.ts       Task 9   link tự tìm
  search/runner.ts          Task 10  gọi một engine: cache, gộp, gate, usage, health
  search/flow.ts            Task 11  hàm quyết định engine tiếp theo
  search/orchestrator.ts    Task 11  chạy cả lượt tìm
  discord/messages.ts       Task 12  toàn bộ chữ tiếng Việt
  discord/render.ts         Task 12  dựng embed/component cho mọi trạng thái
  discord/custom-id.ts      Task 12
  discord/nsfw.ts           Task 12
  discord/sessions.ts       Task 13  phiên 10 phút, giới hạn 128 MiB
  discord/jobs.ts           Task 13  số lượt đang chạy, drain khi tắt
  app.ts                    Task 13  ghép các phần lại
  discord/start-search.ts   Task 13  luồng chung cho mọi cách tìm
  engines/http.ts           Task 14  retry 1 lần lỗi kết nối trước khi gửi
  engines/tracemoe.ts       Task 14
  engines/saucenao.ts       Task 15
  engines/danbooru.ts       Task 16
  engines/yandex/serpapi.ts Task 17
  engines/yandex/parse-html.ts, brightdata.ts, index.ts   Task 18
  engines/index.ts          Task 19  createEngines
  discord/commands.ts, responders.ts, router.ts           Task 19
  index.ts                  Task 19  entry point
scripts/phase0/*.ts         Task 3   script xác minh (chủ server chạy với key thật)
scripts/smoke-engine.ts     Task 14  gọi thử một engine thật
test/                       mirror src; fixtures trong test/fixtures/<engine>/
Dockerfile, docker-compose.yml, .dockerignore, .claude/skills/*   Task 20
```

## Điều kiện từ chủ server

- Unit test không cần key. Các bước cần tài khoản, key, VPS và kênh thử do chủ server chuẩn bị (spec mục 13): chạy script ở Task 3, smoke test ở Task 14–18, chạy thử trong server ở Task 19, VPS ở Task 20. Nếu chưa có, làm tiếp các task không cần key rồi quay lại.
- Task 18 bị chặn cho tới khi có `test/fixtures/yandex/brightdata-sites.html` thật từ Task 3. Nếu Bright Data không trả được trang Yandex: dừng và hỏi chủ server có bật lại Google Lens không (spec mục 13).
- Task 14–17 viết theo tài liệu với fixture tạm; khi Task 3 đã chạy thì dùng fixture thật và chỉnh mapping cho khớp.

---

### Task 1: Khởi tạo repo, test runner và cấu hình

**Files:**
- Create: `.gitignore`, `.env.example`, `src/config.ts`, `test/helpers.ts`, `test/config.test.ts`
- Modify: `package.json` (scripts), `tsconfig.json` (`include`)

**Interfaces:**
- Produces:
  - `interface Config { discordToken, discordApplicationId, discordGuildId, saucenaoApiKey, danbooruLogin, danbooruApiKey, danbooruUserId, brightdataApiKey, brightdataZone, serpapiApiKey, sqlitePath: string; brightdataMonthlyCredits, serpapiMonthlySearches, imageMaxBytes, imageMaxPixels, engineTimeoutMs, jobDeadlineMs, maxActiveJobs, userCooldownMs, userDailySearches, userDailyYandex, userDailyYandexSerpapi, cacheHitTtlDays, cacheMissTtlHours: number; traceUnknownShare: number }`
  - `class ConfigError extends Error { readonly problems: string[] }`
  - `function loadConfig(env: Record<string, string | undefined>): Config`
  - `test/helpers.ts`: `REQUIRED_ENV: Record<string, string>`, `testConfig(over?: Partial<Config>): Config`, `fakeClock(start?: number): { now(): number; set(t: number): void; advance(ms: number): void }`

- [ ] **Step 1: Khởi tạo git và scripts**

`git init`. `.gitignore`:

```text
node_modules/
.env
data/
.superpowers/
```

`package.json` scripts (giữ `typecheck`):

```json
"scripts": {
  "typecheck": "tsc --noEmit",
  "test": "node --test \"test/**/*.test.ts\"",
  "start": "node --env-file-if-exists=.env src/index.ts"
}
```

`tsconfig.json`: `"include": ["src", "test", "scripts"]`.

- [ ] **Step 2: Viết test thất bại `test/config.test.ts`**

```ts
test("applies spec defaults", () => {
  const c = loadConfig(REQUIRED_ENV);
  assert.equal(c.sqlitePath, "./data/bot.db");
  assert.equal(c.brightdataMonthlyCredits, 5000);
  assert.equal(c.serpapiMonthlySearches, 250);
  assert.equal(c.imageMaxBytes, 10485760);
  assert.equal(c.imageMaxPixels, 20000000);
  assert.equal(c.engineTimeoutMs, 15000);
  assert.equal(c.jobDeadlineMs, 60000);
  assert.equal(c.maxActiveJobs, 100);
  assert.equal(c.userCooldownMs, 10000);
  assert.equal(c.userDailySearches, 30);
  assert.equal(c.userDailyYandex, 10);
  assert.equal(c.userDailyYandexSerpapi, 2);
  assert.equal(c.traceUnknownShare, 0.5);
  assert.equal(c.cacheHitTtlDays, 30);
  assert.equal(c.cacheMissTtlHours, 24);
});

test("reports every missing required variable and never echoes values", () => {
  assert.throws(() => loadConfig({ DISCORD_TOKEN: "secret-token" }), (e: unknown) =>
    e instanceof ConfigError &&
    e.problems.includes("DISCORD_APPLICATION_ID") &&
    e.problems.includes("DANBOORU_USER_ID") &&
    !e.message.includes("secret-token"));
});

test("rejects invalid numbers", () => {
  assert.throws(() => loadConfig({ ...REQUIRED_ENV, MAX_ACTIVE_JOBS: "abc" }), /MAX_ACTIVE_JOBS/);
  assert.throws(() => loadConfig({ ...REQUIRED_ENV, TRACE_UNKNOWN_SHARE: "1.5" }), /TRACE_UNKNOWN_SHARE/);
});
```

`REQUIRED_ENV` gán giá trị không rỗng cho đủ 10 biến bắt buộc: `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID`, `SAUCENAO_API_KEY`, `DANBOORU_LOGIN`, `DANBOORU_API_KEY`, `DANBOORU_USER_ID`, `BRIGHTDATA_API_KEY`, `BRIGHTDATA_ZONE`, `SERPAPI_API_KEY`.

- [ ] **Step 3: Chạy `npm test`** — Expected: FAIL, không tìm thấy `../src/config.ts`.

- [ ] **Step 4: Implement `loadConfig` trong `src/config.ts`**

Schema zod: 10 biến bắt buộc là chuỗi không rỗng; các biến số dùng `z.coerce.number().int().positive()` với default đúng spec mục 12; `TRACE_UNKNOWN_SHARE` là số trong [0, 1]. Lỗi gom thành `ConfigError` với `problems` là tên biến, message chỉ chứa tên. `DANBOORU_USER_ID` là quyết định của plan: Danbooru yêu cầu User-Agent có user ID dạng số.

`.env.example` liệt kê mọi biến của spec mục 12 cộng `DANBOORU_USER_ID=`; biến bắt buộc để trống, biến có default ghi đúng default.

- [ ] **Step 5: Chạy `npm test`** — Expected: PASS. **Chạy `npm run typecheck`** — Expected: không lỗi.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: init repo, test runner and config"
```

---

### Task 2: Log và tiện ích

**Files:**
- Create: `src/log.ts`, `src/util/time.ts`, `src/util/code.ts`, `src/util/discord-url.ts`
- Test: `test/util.test.ts`, `test/log.test.ts`

**Interfaces:**
- Produces:
  - `log(level: "info" | "warn" | "error", event: string, fields?: Record<string, unknown>): void` — một dòng `JSON.stringify({ ts, level, event, ...redact(fields) })`
  - `redact(value: unknown): unknown` — đệ quy; khóa khớp `/token|key|secret|password|authorization/i` thành `"[redacted]"`; chuỗi bắt đầu bằng `http` thì cắt query
  - `vnDayKey(ms: number): string` (UTC+7, không DST), `utcDayKey(ms)`, `utcMonthKey(ms)`, `startOfUtcDay(ms): number`, `startOfUtcMonth(ms): number`, `utcDaysLeftInMonth(ms): number` (tính cả hôm nay), `formatTimestamp(seconds: number): string`
  - `newCode(length = 6): string` — ký tự `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, dùng `crypto.randomInt`
  - `isDiscordImageUrl(url: string): boolean`, `signedUrlExpiresAt(url: string): number | null`, `stripQuery(url: string): string`

- [ ] **Step 1: Viết test thất bại**

```ts
test("vnDayKey rolls over at 17:00 UTC", () => {
  assert.equal(vnDayKey(Date.UTC(2026, 9, 27, 16, 59)), "2026-10-27");
  assert.equal(vnDayKey(Date.UTC(2026, 9, 27, 17, 0)), "2026-10-28");
});
test("utcDaysLeftInMonth counts today", () => {
  assert.equal(utcDaysLeftInMonth(Date.UTC(2026, 9, 1)), 31);
  assert.equal(utcDaysLeftInMonth(Date.UTC(2026, 9, 31, 23)), 1);
});
test("formatTimestamp", () => {
  assert.equal(formatTimestamp(754.6), "12:34");
  assert.equal(formatTimestamp(3725), "1:02:05");
});
test("newCode", () => assert.match(newCode(), /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/));
test("isDiscordImageUrl allows only https Discord hosts", () => {
  assert.ok(isDiscordImageUrl("https://cdn.discordapp.com/attachments/1/2/a.png?ex=1&is=2&hm=3"));
  assert.ok(isDiscordImageUrl("https://media.discordapp.net/external/abc/https/x.com/a.png"));
  assert.ok(!isDiscordImageUrl("http://cdn.discordapp.com/a.png"));
  assert.ok(!isDiscordImageUrl("https://cdn.discordapp.com.evil.com/a.png"));
  assert.ok(!isDiscordImageUrl("https://169.254.169.254/latest/meta-data"));
});
test("signedUrlExpiresAt parses hex ex", () => {
  assert.equal(signedUrlExpiresAt("https://cdn.discordapp.com/a.png?ex=6720f0a0&is=1&hm=2"), 0x6720f0a0 * 1000);
  assert.equal(signedUrlExpiresAt("https://cdn.discordapp.com/a.png"), null);
});
test("redact hides secrets and URL queries", () => {
  assert.deepEqual(
    redact({ apiKey: "k", token: "t", imageUrl: "https://cdn.discordapp.com/a.png?ex=1&hm=2", nested: { authorization: "Bearer x" }, n: 3 }),
    { apiKey: "[redacted]", token: "[redacted]", imageUrl: "https://cdn.discordapp.com/a.png", nested: { authorization: "[redacted]" }, n: 3 });
});
```

- [ ] **Step 2: Chạy `npm test`** — Expected: FAIL (module chưa có).
- [ ] **Step 3: Implement các hàm trên** đúng signature ở Interfaces.
- [ ] **Step 4: Chạy `npm test`** — Expected: PASS; `npm run typecheck` sạch.
- [ ] **Step 5: Commit** — `feat: logging and utilities`

---

### Task 3: Script xác minh giai đoạn 0

Chủ server chạy các script này với key thật; kết quả làm fixture cho Task 14–18.

**Files:**
- Create: `scripts/phase0/lib.ts`, `scripts/phase0/tracemoe.ts`, `scripts/phase0/saucenao.ts`, `scripts/phase0/danbooru.ts`, `scripts/phase0/yandex-brightdata.ts`, `scripts/phase0/yandex-serpapi.ts`
- Test: `test/phase0-lib.test.ts`

**Interfaces:**
- Consumes: `isDiscordImageUrl` (Task 2)
- Produces:
  - `requireEnv(names: string[]): Record<string, string>` — thoát với danh sách biến thiếu
  - `saveFixture(relPath: string, body: string, secrets: string[]): string` — thay mọi chuỗi bí mật bằng `REDACTED`, ghi vào `test/fixtures/<relPath>`, trả đường dẫn
  - `downloadBytes(url: string): Promise<Buffer>` — từ chối URL không phải ảnh Discord

- [ ] **Step 1: Viết test thất bại** `saveFixture replaces every secret`: ghi `{"k":"abc","u":"x?api_key=abc"}` với secrets `["abc"]` vào `test/fixtures/tmp/x.json`, đọc lại, assert không còn `abc`, xóa thư mục `tmp`.
- [ ] **Step 2: Chạy `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement `lib.ts`** rồi chạy lại — Expected: PASS.
- [ ] **Step 4: Viết các script** (mỗi script: `node --env-file=.env scripts/phase0/<tên>.ts <url ảnh Discord>`; in tóm tắt, lưu fixture qua `saveFixture` với secrets là các key đang dùng):

| Script | Gọi | Lưu | In ra |
| --- | --- | --- | --- |
| `tracemoe.ts` | `GET https://api.trace.moe/me`; tải ảnh rồi `POST https://api.trace.moe/search?anilistInfo&cutBorders=1` (body là bytes, `content-type` của ảnh) | `tracemoe/me.json` (thay `id` bằng `REDACTED`), `tracemoe/search.json` | `quota`, `quotaUsed`, HTTP status, similarity cao nhất |
| `saucenao.ts <url> [hide] [--movies]` | `POST https://saucenao.com/search.php?output_type=2&numres=8&api_key=…` kèm `db=999` hoặc `dbmask=25165824` khi `--movies`, `hide` nếu truyền; multipart field `file` | `saucenao/search-hide<h>.json` hoặc `saucenao/search-movies.json` | header `short_limit`, `long_limit`, `short_remaining`, `long_remaining`; mỗi kết quả: `index_id`, `index_name`, `similarity`, `hidden` |
| `danbooru.ts` | `GET https://danbooru.donmai.us/iqdb_queries.json?url=<enc>&limit=5`, Basic auth `login:apiKey`, `User-Agent: TimNguonBot/1.0 (user #<DANBOORU_USER_ID>)` | `danbooru/iqdb.json` | status, các `score`, `rating`, header `x-rate-limit` |
| `yandex-brightdata.ts` | `POST https://api.brightdata.com/request`, `Authorization: Bearer`, JSON `{ zone, url: "https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url=<enc>", format: "raw" }` | `yandex/brightdata-sites.html` | status, độ dài, có chuỗi `showcaptcha`/`SmartCaptcha` không |
| `yandex-serpapi.ts` | `GET https://serpapi.com/search.json?engine=yandex_images&url=<enc>&api_key=…`; `GET https://serpapi.com/account.json?api_key=…` | `yandex/serpapi.json`, `yandex/serpapi-account.json` (thay email) | các khóa cấp cao nhất; `total_searches_left`, `this_month_usage` |

- [ ] **Step 5: `npm run typecheck`** — Expected: sạch.
- [ ] **Step 6: Commit** — `git add scripts test && git commit -m "feat: phase 0 verification scripts"`
- [ ] **Step 7 (chủ server, cần key):** chuẩn bị theo spec mục 13 (tài khoản, `.env`, VPS, kênh thường và kênh NSFW thử, 2 tài khoản Discord, ảnh mẫu: một cảnh anime, một fanart, một khung phim, một ảnh nhạy cảm). Chạy từng script; `tracemoe.ts` chạy trên VPS. Chạy `saucenao.ts` với ảnh nhạy cảm ở `hide` 0, 1, 2, 3.
- [ ] **Step 8: Ghi kết quả** vào cuối spec thành mục `## 17. Kết quả giai đoạn 0`: zone Bright Data dùng được (SERP hay Web Unlocker) và có ra HTML không captcha; tên mảng kết quả trong JSON SerpApi; hạn mức SauceNAO thật; giá trị `hide` chọn (nhỏ nhất mà ẩn được kết quả explicit của ảnh mẫu); mã index anime, Movies, Shows; thang điểm Danbooru; `/me` trên VPS. Commit fixture và spec: `git commit -m "docs: phase 0 results and fixtures"`.

---

### Task 4: Kiểu dùng chung và SQLite store

**Files:**
- Create: `src/engines/types.ts`, `src/store/db.ts`, `src/store/cache.ts`, `src/store/usage.ts`, `src/store/user-counters.ts`
- Test: `test/store.test.ts`

**Interfaces:**
- Produces (`src/engines/types.ts`, chỉ có kiểu và một hằng):

```ts
export type EngineId = "tracemoe" | "saucenao" | "danbooru" | "yandex";
export type ProviderId = "tracemoe" | "saucenao" | "danbooru" | "brightdata" | "serpapi";
export type Mode = "auto" | "anime" | "art" | "movie";
export type Tier = "source" | "maybe" | "related";
export type CallPurpose = "primary" | "anime_followup" | "unknown_check" | "extra";
export type EngineStatus = "ok" | "no_match" | "quota_exhausted" | "rate_limited" | "timeout" | "invalid_input" | "unavailable";
export type OutcomeStatus = EngineStatus | "busy" | "server_quota" | "user_quota" | "deadline";
export interface Match {
  engine: EngineId; title: string; url: string; detail?: string; score?: number;
  previewUrl?: string; videoUrl?: string; adult: boolean | null; rating?: "g" | "s" | "q" | "e";
  isAnime?: boolean; hasEpisodeAndTime?: boolean; domain?: string;
}
export interface ImageSource { url: string; sha256: string; jpeg(): Promise<Buffer> }
export interface EngineInput { image: ImageSource; mode: Mode; nsfwChannel: boolean; signal: AbortSignal }
export interface EngineResponse {
  status: EngineStatus; matches: Match[]; sent: boolean; parseFailed?: boolean;
  quota?: { shortRemaining?: number; longRemaining?: number };
}
export interface Engine {
  id: EngineId; providers: readonly ProviderId[]; version: number;
  cacheParams(o: { mode: Mode; nsfwChannel: boolean }): string;
  search(input: EngineInput, provider: ProviderId): Promise<EngineResponse>; // không bao giờ throw
}
export interface EngineOutcome { engine: EngineId; status: OutcomeStatus; matches: Match[]; via?: ProviderId; fromCache?: boolean }
export interface TieredMatch extends Match { tier: Tier }
export const ENGINE_LABEL: Record<EngineId, string> = { tracemoe: "trace.moe", saucenao: "SauceNAO", danbooru: "Danbooru", yandex: "Yandex" };
```

- Produces (store):
  - `type Db = DatabaseSync`; `openDb(path: string): Db` — tạo thư mục cha (trừ `:memory:`), `PRAGMA journal_mode = WAL`, `PRAGMA busy_timeout = 5000`, tạo bảng
  - `class ResultCache { constructor(db: Db, now: () => number); get(key): { engine: EngineId; status: "ok" | "no_match"; payload: string } | undefined; put(key, engine, status, payload, ttlMs): void; getAttachmentHash(id): string | undefined; putAttachmentHash(id, sha256, ttlMs): void; purgeExpired(): number }`
  - `class UsageStore { constructor(db: Db); record(provider: ProviderId, purpose: CallPurpose, ts: number): void; count(provider, fromTs, toTs, purpose?): number /* fromTs ≤ ts < toTs */; purgeBefore(ts): void; getState<T>(key: string): { value: T; updatedAt: number } | undefined; setState(key: string, value: unknown, now: number): void }`
  - `class UserCounters { constructor(db: Db); get(userId, day): { searches: number; yandex: number; yandexSerpapi: number }; increment(userId, day, field: "searches" | "yandex" | "yandex_serpapi"): void }`

DDL:

```sql
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, engine TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attachment_hash (attachment_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS calls (provider TEXT NOT NULL, purpose TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS calls_provider_ts ON calls (provider, ts);
CREATE TABLE IF NOT EXISTS provider_state (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, searches INTEGER NOT NULL DEFAULT 0, yandex INTEGER NOT NULL DEFAULT 0, yandex_serpapi INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
```

- [ ] **Step 1: Viết test thất bại** (DB `:memory:`, `fakeClock`):

```ts
test("cache entry visible until expiry", () => {
  const clk = fakeClock(1000); const c = new ResultCache(openDb(":memory:"), clk.now);
  c.put("k", "saucenao", "ok", '{"m":1}', 500);
  assert.equal(c.get("k")?.payload, '{"m":1}');
  clk.set(1500); assert.equal(c.get("k"), undefined);
});
test("purgeExpired deletes only expired rows", ...);            // 2 hàng, 1 hết hạn → trả 1
test("attachment hash round-trips and expires", ...);
test("usage counts by provider, purpose and range", () => {
  const u = new UsageStore(openDb(":memory:"));
  u.record("brightdata", "primary", 100); u.record("brightdata", "extra", 200); u.record("serpapi", "primary", 150);
  assert.equal(u.count("brightdata", 0, 1000), 2);
  assert.equal(u.count("brightdata", 0, 1000, "extra"), 1);
  assert.equal(u.count("brightdata", 150, 1000), 1);
});
test("provider state round-trips JSON", ...);
test("user counters are per user and day", () => {
  const uc = new UserCounters(openDb(":memory:"));
  uc.increment("u1", "2026-10-27", "searches"); uc.increment("u1", "2026-10-27", "yandex_serpapi");
  assert.deepEqual(uc.get("u1", "2026-10-27"), { searches: 1, yandex: 0, yandexSerpapi: 1 });
  assert.deepEqual(uc.get("u1", "2026-10-28"), { searches: 0, yandex: 0, yandexSerpapi: 0 });
});
test("file database uses WAL", ...);  // file tạm trong os.tmpdir(); PRAGMA journal_mode trả "wal"
```

- [ ] **Step 2: Chạy `npm test`** — Expected: FAIL.
- [ ] **Step 3: Implement** theo Interfaces và DDL.
- [ ] **Step 4: Chạy `npm test`** — PASS; `npm run typecheck` sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: shared types and sqlite store"`

---

### Task 5: Primitive giới hạn và health

**Files:**
- Create: `src/limits/semaphore.ts`, `src/limits/window.ts`, `src/limits/budget.ts`, `src/limits/health.ts`
- Test: `test/limits.test.ts`

**Interfaces:**
- Consumes: `UsageStore`, `ProviderId` (Task 4)
- Produces:
  - `class Semaphore { constructor(max: number); acquire(waitMs: number): Promise<(() => void) | null>; readonly inUse: number }` — `null` khi không có slot trong `waitMs`; release trao slot cho người chờ đầu tiên
  - `class SlidingWindow { constructor(limit: number, windowMs: number, now: () => number); msUntilFree(): number; record(): void }`
  - `dailyAllowance(monthlyLimit: number, usedBeforeToday: number, daysLeftIncludingToday: number): number` — còn lại ≤ 0 thì 0, ngược lại `max(1, floor(còn lại / số ngày))`
  - `class ProviderHealth { constructor(usage: UsageStore, now: () => number); isHealthy(p: ProviderId): boolean; noteParseFailure(p): void; noteSuccess(p): void; snapshot(): Record<ProviderId, { healthy: boolean; failures: number; unhealthyUntil: number | null }> }` — 3 lần lỗi đọc liên tiếp thì hỏng 3 600 000 ms; lưu qua `usage.setState("health", …)` và đọc lại khi khởi tạo

- [ ] **Step 1: Viết test thất bại**

```ts
test("semaphore gives up after waitMs", async () => {
  const s = new Semaphore(1); const r1 = await s.acquire(0); assert.ok(r1);
  assert.equal(await s.acquire(30), null);
  r1!(); assert.ok(await s.acquire(0));
});
test("semaphore hands the slot to a waiter", async () => {
  const s = new Semaphore(1); const r1 = await s.acquire(0);
  const waiting = s.acquire(1000); r1!(); assert.ok(await waiting);
});
test("sliding window", () => {
  const clk = fakeClock(0); const w = new SlidingWindow(2, 1000, clk.now);
  assert.equal(w.msUntilFree(), 0); w.record(); w.record();
  assert.equal(w.msUntilFree(), 1000); clk.set(400); assert.equal(w.msUntilFree(), 600);
  clk.set(1000); assert.equal(w.msUntilFree(), 0);
});
test("dailyAllowance", () => {
  assert.equal(dailyAllowance(5000, 0, 31), 161);
  assert.equal(dailyAllowance(5000, 4999, 10), 1);
  assert.equal(dailyAllowance(5000, 5000, 10), 0);
  assert.equal(dailyAllowance(250, 100, 15), 10);
});
test("3 consecutive parse failures make a provider unhealthy for 1 hour", () => {
  const clk = fakeClock(0); const h = new ProviderHealth(new UsageStore(openDb(":memory:")), clk.now);
  h.noteParseFailure("brightdata"); h.noteParseFailure("brightdata"); assert.ok(h.isHealthy("brightdata"));
  h.noteParseFailure("brightdata"); assert.ok(!h.isHealthy("brightdata"));
  clk.set(3_600_000); assert.ok(h.isHealthy("brightdata"));
});
test("a success resets the failure streak", ...);
```

- [ ] **Step 2: Chạy `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: limiter primitives and provider health"`

---

### Task 6: Gate và ngân sách từng nhà cung cấp

**Files:**
- Create: `src/limits/gates.ts`
- Test: `test/gates.test.ts`

**Interfaces:**
- Consumes: `Config` (Task 1); `UsageStore` (Task 4); `Semaphore`, `SlidingWindow`, `dailyAllowance` (Task 5); `startOfUtcDay`, `startOfUtcMonth`, `utcDaysLeftInMonth` (Task 2)
- Produces:

```ts
export type Acquired = { release: () => void } | { busy: true };
export interface ProviderStats {
  provider: ProviderId; usedToday: number; allowanceToday: number | null;
  usedPeriod: number; periodLimit: number | null; remaining?: number; blocked: boolean;
}
export interface Gates {
  acquire(provider: ProviderId, waitMs: number): Promise<Acquired>;
  budget(provider: ProviderId, purpose: CallPurpose): "ok" | "server_quota";
  noteSaucenaoHeader(q: { shortRemaining?: number; longRemaining?: number }): void;
  noteTraceMe(me: { quota: number; quotaUsed: number }): void;
  noteSerpapiAccount(a: { totalSearchesLeft: number }): void;
  stats(): ProviderStats[];
}
export class ProviderGates implements Gates {
  constructor(deps: { config: Config; usage: UsageStore; now: () => number; sleep?: (ms: number) => Promise<void> });
}
```

Giá trị theo spec mục 7.1 (`acquire` ghi nhận cửa sổ lúc lấy slot; `budget` không đổi trạng thái):

| Provider | Đồng thời | Chờ trong `acquire` | `budget` = `server_quota` khi |
| --- | --- | --- | --- |
| tracemoe | 1 | — | đã dùng ≥ quota. Có snapshot `/me`: đã dùng = `quotaUsed` + số call kể từ lúc snapshot; không có: số call trong 24 giờ gần nhất, quota 100. Thêm với `unknown_check`: số call `unknown_check` trong 24 giờ ≥ `floor(quota × traceUnknownShare)` |
| saucenao | 2 | `shortRemaining` = 0 thì chặn 30 000 ms; còn chặn lâu hơn `waitMs` thì busy | `longRemaining` = 0 thì chặn 3 600 000 ms |
| danbooru | 1 | cửa sổ 1 call / 1 000 ms | không bao giờ |
| brightdata | 8 | — | call hôm nay (UTC) ≥ `dailyAllowance(brightdataMonthlyCredits, dùng trong tháng trước hôm nay, utcDaysLeftInMonth)` |
| serpapi | 1 | cửa sổ 50 call / 3 600 000 ms | như brightdata với `serpapiMonthlySearches`; "dùng trong tháng" = max(đếm cục bộ, `serpapiMonthlySearches − totalSearchesLeft` của snapshot + call kể từ snapshot) |

`acquire`: nếu thời gian chờ cửa sổ hoặc khóa ngắn ≤ `waitMs` thì `sleep` rồi lấy semaphore với thời gian còn lại; không thì `{ busy: true }`. `sleep` mặc định `setTimeout`; test truyền `sleep` tiến đồng hồ giả.

- [ ] **Step 1: Viết test thất bại** (in-memory DB, `fakeClock` bắt đầu `Date.UTC(2026, 9, 1)`, `sleep: async ms => clk.advance(ms)`):

```ts
test("brightdata stops at the daily allowance", () => {
  // 161 call hôm nay → budget "server_quota"; 160 → "ok"
});
test("unused allowance rolls over", () => {
  // không dùng ngày 1; ngày 2: allowance = floor(5000 / 30) = 166
});
test("trace unknown_check is capped at half the quota", () => {
  gates.noteTraceMe({ quota: 100, quotaUsed: 0 });
  for (let i = 0; i < 50; i++) usage.record("tracemoe", "unknown_check", clk.now());
  assert.equal(gates.budget("tracemoe", "unknown_check"), "server_quota");
  assert.equal(gates.budget("tracemoe", "primary"), "ok");
});
test("trace budget = /me snapshot + local calls since", () => {
  gates.noteTraceMe({ quota: 100, quotaUsed: 99 }); assert.equal(gates.budget("tracemoe", "primary"), "ok");
  clk.advance(1); usage.record("tracemoe", "primary", clk.now());
  assert.equal(gates.budget("tracemoe", "primary"), "server_quota");
});
test("saucenao short block → busy until 30 s pass", async () => {
  gates.noteSaucenaoHeader({ shortRemaining: 0, longRemaining: 50 });
  assert.deepEqual(await gates.acquire("saucenao", 5000), { busy: true });
  clk.advance(30_000); assert.ok("release" in await gates.acquire("saucenao", 5000));
});
test("saucenao long remaining 0 → server_quota for 1 hour", ...);
test("danbooru waits for its 1 s window when waitMs allows", async () => {
  const a = await gates.acquire("danbooru", 0); assert.ok("release" in a); a.release();
  assert.deepEqual(await gates.acquire("danbooru", 0), { busy: true });
  assert.ok("release" in await gates.acquire("danbooru", 1500));
});
test("serpapi month usage uses the larger of local count and account snapshot", ...);
test("stats lists all five providers", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement `ProviderGates`** theo bảng.
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: provider gates and budgets"`

---

### Task 7: Hạn mức người dùng

**Files:**
- Create: `src/limits/user-limits.ts`
- Test: `test/user-limits.test.ts`

**Interfaces:**
- Consumes: `UserCounters` (Task 4), `vnDayKey` (Task 2), `Config`
- Produces:

```ts
export type StartCheck =
  | { ok: true }
  | { ok: false; reason: "cooldown"; waitSec: number }
  | { ok: false; reason: "daily_limit" }
  | { ok: false; reason: "active" };
export class UserLimits {
  constructor(deps: { counters: UserCounters; config: Config; now: () => number });
  checkStart(userId: string, kind: "search" | "extra"): StartCheck;
  begin(userId: string, kind: "search" | "extra"): void;   // đánh dấu đang chạy; "search" thì +1 searches và đặt mốc cooldown
  end(userId: string): void;
  canUseYandex(userId: string, provider: "brightdata" | "serpapi"): boolean;
  recordYandex(userId: string, usedSerpapi: boolean): void;  // +1 yandex; usedSerpapi thì +1 yandex_serpapi
  remainingSearches(userId: string): number;
}
```

Quy tắc (spec mục 4.5): `"search"` kiểm tra đang chạy → cooldown `userCooldownMs` tính từ lần `begin("search")` trước, `waitSec = ceil(ms còn lại / 1000)` → `userDailySearches` theo `vnDayKey`. `"extra"` (nút "Tìm thêm bằng Yandex") chỉ kiểm tra đang chạy. Yandex: tổng < `userDailyYandex`; đường serpapi thêm điều kiện `yandexSerpapi < userDailyYandexSerpapi`. Đang chạy và cooldown chỉ nằm trong RAM.

- [ ] **Step 1: Viết test thất bại**

```ts
test("cooldown 10 s", () => {
  ul.begin("u", "search"); ul.end("u"); clk.advance(4000);
  assert.deepEqual(ul.checkStart("u", "search"), { ok: false, reason: "cooldown", waitSec: 6 });
  clk.advance(6000); assert.deepEqual(ul.checkStart("u", "search"), { ok: true });
});
test("one active job per user, including extra", () => {
  ul.begin("u", "search");
  assert.deepEqual(ul.checkStart("u", "extra"), { ok: false, reason: "active" });
});
test("30 searches per Vietnam day", () => {
  // 30 vòng begin/end/advance(10_000) → daily_limit; tiến tới 17:00 UTC → ok
});
test("extra does not count as a search and ignores cooldown", ...);
test("yandex: 10 per day, at most 2 via serpapi", () => {
  ul.recordYandex("u", true); ul.recordYandex("u", true);
  assert.equal(ul.canUseYandex("u", "serpapi"), false);
  assert.equal(ul.canUseYandex("u", "brightdata"), true);
  for (let i = 0; i < 8; i++) ul.recordYandex("u", false);
  assert.equal(ul.canUseYandex("u", "brightdata"), false);
});
test("remainingSearches", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: per-user limits"`

---

### Task 8: Ảnh: ứng viên, tải, chuẩn hóa

**Files:**
- Create: `src/images/candidates.ts`, `src/images/download.ts`, `src/images/normalize.ts`, `src/images/load.ts`
- Test: `test/images.test.ts`

**Interfaces:**
- Consumes: `isDiscordImageUrl` (Task 2), `ResultCache` (Task 4), `ImageSource` (Task 4), `Config`
- Produces:

```ts
// candidates.ts
export interface AttachmentLike { id: string; url: string; name: string; contentType: string | null; width: number | null; height: number | null }
export interface EmbedLike { url: string | null; image: { proxyURL?: string | null } | null; thumbnail: { proxyURL?: string | null } | null }
export interface ImageCandidate { kind: "attachment" | "embed_image" | "embed_thumbnail"; url: string; attachmentId?: string; label: string; description: string }
export function extractCandidates(msg: { attachments: AttachmentLike[]; embeds: EmbedLike[] }): ImageCandidate[];
// download.ts
export type ImageErrorCode = "not_allowed" | "too_large" | "fetch_failed" | "decode_failed" | "too_many_pixels" | "unsupported";
export class ImageError extends Error { readonly code: ImageErrorCode }
export function downloadImage(url: string, o: { maxBytes: number; timeoutMs: number; fetch?: typeof fetch }): Promise<Buffer>;
// normalize.ts
export interface NormalizedImage { jpeg: Buffer; sha256: string; width: number; height: number }
export function normalizeImage(original: Buffer, maxPixels: number): Promise<NormalizedImage>;
// load.ts
export interface LoadedImage extends ImageSource { bytesInMemory(): number }
export function loadImage(input: { url: string; attachmentId?: string }, deps: { cache: ResultCache; config: Config; now: () => number; fetch?: typeof fetch }): Promise<LoadedImage>;
```

Quy tắc:
- Ứng viên (spec mục 4.2): attachment là ảnh khi `contentType` bắt đầu bằng `image/` hoặc tên khớp `/\.(png|gif|jpe?g|jfif|webp|avif)$/i`; sau đó `embed.image.proxyURL`, rồi `embed.thumbnail.proxyURL`; bỏ embed không có `proxyURL`; tối đa 25. `label` là `"Ảnh N"`; `description` là `"<tên file> · <rộng>×<cao>"` (bỏ phần kích thước nếu không có) hoặc `"ảnh xem trước của link <hostname của embed.url>"`; cắt còn 100 ký tự.
- Tải (spec mục 9): URL không qua `isDiscordImageUrl` thì `not_allowed` và không gọi fetch; `redirect: "manual"`, HTTP 3xx hoặc không phải 2xx thì `fetch_failed`; `content-length` > `maxBytes` thì `too_large` trước khi đọc; đọc stream và dừng khi vượt `maxBytes`; timeout là `fetch_failed`.
- Chuẩn hóa: `sharp(original, { limitInputPixels: maxPixels })`; vượt giới hạn thì `too_many_pixels`; không giải mã được thì `decode_failed`; `metadata().format` ngoài `jpeg`, `png`, `webp`, `gif`, `heif` (AVIF) thì `unsupported`; `.rotate()` theo EXIF, GIF lấy frame đầu (mặc định), `resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })`, `.jpeg({ quality: 90 })`; `sha256` là SHA-256 hex của bytes gốc.
- `loadImage`: có `attachmentId` trong `attachment_hash` thì trả nguồn lười (biết `sha256`, chỉ tải và chuẩn hóa khi gọi `jpeg()` lần đầu); ngược lại tải, chuẩn hóa ngay, lưu `attachment_hash` 30 ngày nếu có `attachmentId`. `bytesInMemory()` là độ dài JPEG đã nạp, chưa nạp thì 0.

- [ ] **Step 1: Viết test thất bại**

```ts
test("candidates: attachment, then embed image; proxyURL only; non-images skipped", () => {
  const c = extractCandidates({
    attachments: [
      { id: "1", url: "https://cdn.discordapp.com/a/IMG_1.JPG", name: "IMG_1.JPG", contentType: null, width: 1280, height: 720 },
      { id: "2", url: "https://cdn.discordapp.com/a/notes.txt", name: "notes.txt", contentType: "text/plain", width: null, height: null },
    ],
    embeds: [
      { url: "https://www.pixiv.net/artworks/1", image: { proxyURL: "https://media.discordapp.net/external/x.png" }, thumbnail: { proxyURL: null } },
      { url: "https://example.com", image: null, thumbnail: null },
    ],
  });
  assert.deepEqual(c.map(x => [x.kind, x.url]), [
    ["attachment", "https://cdn.discordapp.com/a/IMG_1.JPG"],
    ["embed_image", "https://media.discordapp.net/external/x.png"],
  ]);
  assert.equal(c[0].label, "Ảnh 1");
  assert.equal(c[0].description, "IMG_1.JPG · 1280×720");
  assert.equal(c[1].description, "ảnh xem trước của link www.pixiv.net");
});
test("candidates capped at 25", ...);
test("download rejects non-Discord hosts without fetching", async () => {
  let called = false;
  await assert.rejects(downloadImage("https://169.254.169.254/x", { maxBytes: 10, timeoutMs: 1000, fetch: async () => { called = true; return new Response(""); } }),
    (e: unknown) => e instanceof ImageError && e.code === "not_allowed");
  assert.equal(called, false);
});
test("download stops past maxBytes", ...);           // stream 20 byte, không content-length, maxBytes 10 → too_large
test("download treats redirects as failure", ...);   // fetch trả 302 → fetch_failed; init.redirect === "manual"
test("normalize: JPEG ≤ 2048 px, sha256 of original", async () => {
  const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#08f" } }).png().toBuffer();
  const n = await normalizeImage(png, 20_000_000);
  assert.equal(n.width, 2048); assert.equal(n.height, 683);
  assert.equal((await sharp(n.jpeg).metadata()).format, "jpeg");
  assert.equal(n.sha256, createHash("sha256").update(png).digest("hex"));
});
test("normalize accepts webp, gif and avif", ...);
test("normalize: pixel limit → too_many_pixels", ...);   // ảnh 100×100, maxPixels 5000
test("normalize: garbage → decode_failed", ...);
test("normalize applies EXIF orientation", ...);          // JPEG 200×100 có orientation 6 → 100×200
test("loadImage reuses a known attachment hash without downloading", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: image candidates, safe download and normalization"`

---

### Task 9: Mức tin cậy, chọn kết quả, link tự tìm

**Files:**
- Create: `src/search/tiers.ts`, `src/search/select.ts`, `src/search/deeplinks.ts`
- Test: `test/results.test.ts`

**Interfaces:**
- Consumes: `Match`, `TieredMatch`, `Tier`, `EngineId` (Task 4)
- Produces:
  - `THRESHOLDS = { saucenao: { source: 90, maybe: 70 }, tracemoe: { source: 0.92, maybe: 0.85 }, danbooru: { source: 90, maybe: 70 } }`
  - `KNOWN_SOURCE_DOMAINS = ["pixiv.net", "x.com", "twitter.com", "danbooru.donmai.us", "gelbooru.com", "artstation.com", "deviantart.com", "imdb.com", "themoviedb.org", "myanimelist.net", "anilist.co"]`
  - `classify(m: Match): Tier | null` — engine có điểm: ≥ source → `"source"`, ≥ maybe → `"maybe"`, thấp hơn hoặc thiếu điểm → `null`; yandex: domain (hoặc hostname của `url`) bằng hoặc là subdomain của domain trong danh sách → `"maybe"`, còn lại `"related"`, không bao giờ `"source"`
  - `tierAll(matches: Match[]): TieredMatch[]` — bỏ `null`
  - `pickResults(ms: TieredMatch[]): { main?: TieredMatch; others: TieredMatch[] }` — sắp theo tier (source > maybe > related), rồi engine (tracemoe > saucenao > danbooru > yandex), rồi điểm giảm dần; bỏ trùng `url`; `others` tối đa 2
  - `interface DeepLink { name: string; url: string }`; `buildDeepLinks(imageUrl: string): DeepLink[]` — thứ tự và mẫu (`{u}` = `encodeURIComponent(imageUrl)`):

| name | url |
| --- | --- |
| Yandex | `https://yandex.com/images/search?rpt=imageview&url={u}` |
| SauceNAO | `https://saucenao.com/search.php?url={u}` |
| Google Lens | `https://lens.google.com/uploadbyurl?url={u}` |
| trace.moe | `https://trace.moe/?url={u}` |
| IQDB | `https://iqdb.org/?url={u}` |
| ascii2d | `https://ascii2d.net/search/url/{u}` |
| Bing | `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{u}` |
| TinEye | `https://tineye.com/search?url={u}` |

- [ ] **Step 1: Viết test thất bại**

```ts
const m = (engine: EngineId, score?: number): Match => ({ engine, title: "t", url: `https://x/${engine}/${score}`, score, adult: null });
test("thresholds", () => {
  assert.equal(classify(m("saucenao", 90)), "source"); assert.equal(classify(m("saucenao", 89.9)), "maybe");
  assert.equal(classify(m("saucenao", 70)), "maybe"); assert.equal(classify(m("saucenao", 69.9)), null);
  assert.equal(classify(m("tracemoe", 0.92)), "source"); assert.equal(classify(m("tracemoe", 0.9199)), "maybe");
  assert.equal(classify(m("tracemoe", 0.85)), "maybe"); assert.equal(classify(m("tracemoe", 0.8499)), null);
  assert.equal(classify(m("danbooru", 90)), "source"); assert.equal(classify(m("danbooru", 69)), null);
  assert.equal(classify(m("saucenao")), null);
});
test("yandex is never source", () => {
  const y = (domain: string): Match => ({ engine: "yandex", title: "t", url: `https://${domain}/a`, domain, adult: null });
  assert.equal(classify(y("www.pixiv.net")), "maybe");
  assert.equal(classify(y("pixiv.net.evil.com")), "related");
  assert.equal(classify(y("example.com")), "related");
});
test("pickResults orders and dedupes", ...);   // source luôn trước maybe; cùng maybe thì trace.moe trước SauceNAO; cùng engine thì điểm cao trước; url trùng bị bỏ; others tối đa 2
test("deep links order and encoding", () => {
  const l = buildDeepLinks("https://cdn.discordapp.com/a.png?ex=1&hm=2");
  assert.deepEqual(l.map(x => x.name), ["Yandex", "SauceNAO", "Google Lens", "trace.moe", "IQDB", "ascii2d", "Bing", "TinEye"]);
  assert.equal(l[0].url, "https://yandex.com/images/search?rpt=imageview&url=https%3A%2F%2Fcdn.discordapp.com%2Fa.png%3Fex%3D1%26hm%3D2");
});
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: tiers, result selection and deep links"`

---

### Task 10: Runner gọi một engine

**Files:**
- Create: `src/search/runner.ts`
- Test: `test/runner.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EngineOutcome`, `CallPurpose`, `ImageSource` (Task 4); `ResultCache`, `UsageStore` (Task 4); `ProviderHealth` (Task 5); `Gates` (Task 6); `UserLimits` (Task 7); `Config`
- Produces:

```ts
export interface RunContext { guildId: string; userId: string; mode: Mode; nsfwChannel: boolean; image: ImageSource; deadlineAt: number; purpose: CallPurpose }
export type Runner = (engine: EngineId, ctx: RunContext) => Promise<EngineOutcome>;
export function cacheKey(guildId: string, engine: Engine, params: string, sha256: string): string; // `${guildId}:${engine.id}:v${engine.version}:${params}:${sha256}`
export function createRunner(deps: {
  engines: Record<EngineId, Engine>; gates: Gates; cache: ResultCache; usage: UsageStore;
  health: ProviderHealth; userLimits: UserLimits; config: Config; now: () => number;
}): Runner;
```

Thuật toán (spec mục 5, 7):
1. Có trong cache thì trả `{ ...payload, fromCache: true }`. Payload lưu là JSON `{ status, matches, via }`.
2. Đang có call cùng khóa thì chờ chung promise đó; người chờ không bị tính lượt.
3. Lần lượt từng provider trong `engine.providers`:
   - provider không khỏe → lý do `unavailable`, sang provider sau
   - `gates.budget(provider, purpose)` là `server_quota` → lý do `server_quota`, sang sau
   - engine `yandex` mà `!userLimits.canUseYandex(userId, provider)` → lý do `user_quota`, sang sau
   - thời gian còn lại tới `deadlineAt` < 1 000 ms → trả `deadline`
   - `gates.acquire(provider, min(5000, còn lại))` busy → trả `busy` (không sang provider sau)
   - gọi `engine.search` với `signal = AbortSignal.timeout(min(engineTimeoutMs, còn lại))`; nếu throw thì coi là `{ status: "unavailable", matches: [], sent: false }`; luôn `release()`
   - `sent` thì `usage.record(provider, purpose, now)`, riêng serpapi chỉ ghi khi status `ok`/`no_match`
   - engine saucenao có `quota` → `gates.noteSaucenaoHeader`
   - provider brightdata: `parseFailed` → `health.noteParseFailure`; `ok`/`no_match` → `health.noteSuccess`
   - `ok`/`no_match` → cache (ok: `cacheHitTtlDays`; no_match: `cacheMissTtlHours`) và trả `{ engine, status, matches, via: provider }`
   - `timeout`, `invalid_input` → trả ngay
   - `quota_exhausted` (đổi thành `server_quota`), `rate_limited`, `unavailable` → ghi lý do, sang provider sau
4. Hết provider → trả lý do cuối cùng.
5. Engine `yandex`: nếu có ít nhất một request đã gửi thì `userLimits.recordYandex(userId, đã gửi qua serpapi)` đúng một lần.

- [ ] **Step 1: Viết test thất bại** (engine giả `fakeEngine(id, providers, impl)`; gate thật trên DB in-memory, trừ test busy dùng gate giả):

```ts
test("cache hit skips the engine", ...);
test("concurrent identical calls share one request", async () => {
  // engine chậm 50 ms, đếm số lần gọi; chạy hai Runner song song cùng ảnh → 1 lần; hai outcome bằng nhau
});
test("busy on brightdata does not fall through to serpapi", ...);
test("brightdata error falls through to serpapi and counts one Yandex use", async () => {
  // brightdata → unavailable (sent), serpapi → ok; outcome.via === "serpapi";
  // counters: yandex 1, yandexSerpapi 1
});
test("serpapi failures are not recorded as usage", ...);
test("user serpapi cap skips the serpapi path with user_quota", ...);
test("timeout is recorded as used and not retried", ...);
test("3 brightdata parse failures route the next call straight to serpapi", ...);
test("ok cached 30 days, no_match 24 hours, errors not cached", ...);
test("adapter throwing becomes unavailable", ...);
test("deadline under 1 s returns deadline without calling", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement theo thuật toán.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: engine runner with cache, coalescing and gates"`

---

### Task 11: Luồng tìm và orchestrator

**Files:**
- Create: `src/search/flow.ts`, `src/search/orchestrator.ts`
- Test: `test/flow.test.ts`, `test/orchestrator.test.ts`

**Interfaces:**
- Consumes: `Runner`, `RunContext` (Task 10); `tierAll`, `pickResults` (Task 9); types (Task 4)
- Produces:

```ts
// flow.ts
export interface FlowState { mode: Mode; outcomes: EngineOutcome[]; tiered: TieredMatch[] }
export interface PlannedCall { engine: EngineId; purpose: CallPurpose }
export function nextCall(s: FlowState): PlannedCall | null;
// orchestrator.ts
export interface Progress { done: EngineId[]; current?: EngineId }
export interface SearchOutcome {
  code: string; mode: Mode; outcomes: EngineOutcome[]; tiered: TieredMatch[];
  main?: TieredMatch; others: TieredMatch[]; state: "found" | "not_found" | "incomplete";
}
export interface SearchRequest {
  code: string; guildId: string; userId: string; mode: Mode; nsfwChannel: boolean;
  image: ImageSource; deadlineAt: number; onProgress?: (p: Progress) => void | Promise<void>;
}
export function finalize(code: string, mode: Mode, outcomes: EngineOutcome[]): SearchOutcome;
export function runSearch(req: SearchRequest, run: Runner): Promise<SearchOutcome>;
export function runExtraYandex(prev: SearchOutcome, req: SearchRequest, run: Runner): Promise<SearchOutcome>;
```

Quy tắc `nextCall` (spec mục 6.2). "Đã thử" nghĩa là đã có outcome với bất kỳ status nào; không engine nào được lên kế hoạch hai lần.
- "Đủ": có match tier `source`, trừ match SauceNAO `isAnime` mà thiếu `hasEpisodeAndTime` khi trace.moe chưa thử (chỉ ở auto). Đủ thì trả `null`.
- auto:
  1. chưa thử SauceNAO và Danbooru → saucenao/primary
  2. SauceNAO có status `busy`, `server_quota`, `rate_limited`, `unavailable` hoặc `timeout`, và chưa thử Danbooru → danbooru/primary
  3. SauceNAO có match `isAnime` từ tier `maybe` trở lên, chưa thử trace.moe → tracemoe/anime_followup
  4. chưa thử Yandex → yandex/primary
  5. chưa có match tier `maybe` trở lên, chưa thử trace.moe → tracemoe/unknown_check
  6. còn lại → `null`
- anime: tracemoe → saucenao → yandex; art: saucenao → danbooru → yandex; movie: yandex → saucenao; tất cả `primary`, dừng khi đủ.

`finalize`: `tiered = tierAll(mọi matches)`; `main`/`others` từ `pickResults`; state `incomplete` nếu không có match `source`/`maybe` và có outcome với status ngoài `ok`/`no_match`; `found` nếu có `main` và không `incomplete`; còn lại `not_found`.

`runSearch`: lặp `nextCall`; gọi `onProgress({ done, current })` trước mỗi call; dừng khi outcome là `deadline`; trả `finalize`. `runExtraYandex`: một call yandex/extra, gộp outcome vào `prev.outcomes` (thay outcome yandex cũ nếu có), trả `finalize` với `prev.code`.

- [ ] **Step 1: Viết test thất bại**

```ts
const o = (engine: EngineId, status: OutcomeStatus, matches: Match[] = []): EngineOutcome => ({ engine, status, matches });
test("auto starts with SauceNAO", () => assert.deepEqual(nextCall(st("auto", [])), { engine: "saucenao", purpose: "primary" }));
test("auto: SauceNAO unavailable for any reason → Danbooru", () => {
  for (const s of ["busy", "server_quota", "rate_limited", "unavailable", "timeout"] as const)
    assert.deepEqual(nextCall(st("auto", [o("saucenao", s)])), { engine: "danbooru", purpose: "primary" });
});
test("auto: SauceNAO no_match → Yandex, not Danbooru", ...);
test("auto: anime hint without episode/time → trace.moe anime_followup", ...);
test("auto: anime source with episode and time → done", ...);
test("auto: artwork source → done", ...);
test("auto: nothing after Yandex → trace.moe unknown_check", ...);
test("auto: Yandex maybe → done without unknown_check", ...);
test("anime / art / movie orders", ...);
test("never plans an engine twice", ...);
test("runSearch reports progress and stops at deadline", ...);
test("finalize states found / not_found / incomplete", ...);
test("runExtraYandex merges into the previous outcome", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: search flow and orchestrator"`

---

### Task 12: Dựng tin nhắn

**Files:**
- Create: `src/discord/messages.ts`, `src/discord/render.ts`, `src/discord/custom-id.ts`, `src/discord/nsfw.ts`
- Test: `test/render.test.ts`

**Interfaces:**
- Consumes: `SearchOutcome`, `Progress` (Task 11); `DeepLink` (Task 9); `ImageCandidate`, `ImageErrorCode` (Task 8); `ProviderStats` (Task 6); `ENGINE_LABEL`, types (Task 4); `Config`
- Produces:

```ts
// render.ts — payload JSON thô của Discord API (kiểu APIEmbed / action row do discord.js re-export)
export interface Payload { content?: string; embeds: APIEmbed[]; components: /* action rows */ unknown[]; allowedMentions: { parse: [] } }
export interface RenderContext { nsfwChannel: boolean; remainingSearches: number; deepLinks: DeepLink[]; showYandexButton: boolean }
export function renderProgress(p: Progress, deadlineSec: number): Payload;
export function renderOutcome(o: SearchOutcome, ctx: RenderContext): Payload;
export function renderImageError(code: ImageErrorCode, cfg: Pick<Config, "imageMaxBytes" | "imageMaxPixels">, deepLinks: DeepLink[]): Payload;
export function renderNotice(text: string, deepLinks?: DeepLink[]): Payload;      // busy, cooldown, hết lượt, lỗi chung
export function renderPickMenu(pickId: string, candidates: ImageCandidate[]): Payload;
export function renderModeSelect(code: string, current: Mode): unknown[];         // một action row
export function renderQuota(stats: ProviderStats[], health: Record<string, { healthy: boolean }>): Payload;
export function renderHelp(cfg: Pick<Config, "userDailySearches" | "userDailyYandex">): Payload;
export function previewAllowed(m: Match, nsfwChannel: boolean): boolean;
export function escapeMd(text: string): string;
// custom-id.ts
export type ComponentRef = { kind: "mode" | "modeSelect" | "yandex" | "pick"; key: string };
export function customId(r: ComponentRef): string;            // "m:" | "ms:" | "y:" | "p:" + key
export function parseCustomId(id: string): ComponentRef | null;
// nsfw.ts
export function isNsfw(channel: unknown): boolean;            // thread → parent.nsfw; kênh thường → nsfw; null → false
```

Chữ trong `messages.ts` (spec mục 4.6, 4.7; `{…}` là chỗ thay):

| Khóa | Chữ |
| --- | --- |
| tierSource / tierMaybe / tierRelated | NGUỒN TÌM ĐƯỢC / CÓ THỂ LÀ / LIÊN QUAN |
| searching | ĐANG TÌM… |
| progressDone / progressAsking / progressMax | Đã xong: {engines} / Đang hỏi: {engine} / Tối đa {s} giây |
| notFound / notFoundBody | CHƯA XÁC ĐỊNH ĐƯỢC NGUỒN / Đã tìm bằng {engines} nhưng không có kết quả đủ tin cậy. |
| incomplete | CHƯA TÌM HẾT |
| others / searchYourself | Ứng viên khác / Tự tìm tiếp: |
| footer | Đã tìm: {engines} · Bạn còn {n} lượt hôm nay · Mã: {code} |
| busy / restarting | Bot đang bận, thử lại sau ít phút / Bot đang khởi động lại, thử lại sau ít giây |
| cooldown / dailyLimit / active | Đợi {n} giây nữa rồi thử lại / Bạn đã dùng hết {n} lượt hôm nay / Bạn đang có một lượt tìm chưa xong |
| imageDecode / imageTooLarge / imagePixels / imageFetch / imageUnsupported | Không đọc được ảnh / Ảnh lớn hơn {mb} MB / Ảnh lớn hơn {mp} triệu điểm ảnh / Không tải được ảnh, hãy gửi lại ảnh / Định dạng ảnh chưa hỗ trợ |
| genericError | Có lỗi khi tìm, thử lại sau |
| notOwner / sessionExpired | Chỉ người tìm mới dùng được nút này / Phiên đã hết, hãy tìm lại |
| noImage | Tin nhắn này không có ảnh. Dùng /search và tải ảnh lên để tìm. |
| pickPrompt / pickPlaceholder | Tin nhắn này có {n} ảnh. Chọn ảnh cần tìm nguồn: / Chọn ảnh cần tìm nguồn |
| changeMode / moreYandex / yandexUnavailable | Đổi chế độ / Tìm thêm bằng Yandex / Yandex hiện đã hết lượt |
| adminOnly / watchClip | Lệnh này chỉ dành cho admin / Xem đoạn cảnh |
| reasons | server_quota, quota_exhausted: hết lượt hôm nay của server · busy, rate_limited: đang bận · user_quota: bạn đã hết lượt Yandex hôm nay · deadline, timeout: hết thời gian · unavailable, invalid_input: lỗi |
| modes | auto: Tự động · anime: Cảnh anime · art: Art / tranh · movie: Phim người đóng |
| privacy | Ảnh bạn tìm sẽ được gửi tới trace.moe, SauceNAO, Danbooru và Yandex (qua Bright Data hoặc SerpApi). |

Bố cục `renderOutcome` (kiểu C):
- `found`: `author.name` là nhãn tier; `color` source `0x23A55A`, maybe `0xF0B232`, related `0x80848E`; `title` là `main.title` (cắt 256), `url` là `main.url`.
- `description`, nối các khối bằng dòng trống:
  - dòng chi tiết `{detail} · khớp {pct} · {engine}`, kèm `[Xem đoạn cảnh](video)` nếu `previewAllowed`
  - khối `**Ứng viên khác**` với dòng `{i}. [{title}]({url}) · {detail} · {pct} {engine} · {nhãn tier viết thường}`, đánh số từ 2
  - dòng `**Tự tìm tiếp:** [Yandex](…) · …`
- `pct`: SauceNAO và Danbooru dùng `round(score)%`; trace.moe dùng `round(score×100)%`.
- `image.url` là `main.previewUrl` khi `previewAllowed`.
- `footer.text` theo khóa footer, với engines là các engine có outcome `ok`/`no_match`.
- Nút: `Đổi chế độ` (`m:<code>`), thêm `Tìm thêm bằng Yandex` (`y:<code>`) khi `showYandexButton`.
- `not_found`: màu xám, nhãn notFound, notFoundBody, link tự tìm, cùng các nút.
- `incomplete`: màu vàng, nhãn incomplete, mỗi engine không ok một dòng `{engine}: {lý do}`, sau đó các kết quả `related` nếu có, rồi link tự tìm.
- `previewAllowed` (spec mục 8): kênh NSFW thì luôn đúng; yandex thì sai; danbooru thì `rating === "g"`; tracemoe thì `adult === false`; saucenao thì `adult !== true`.
- `escapeMd` thêm `\` trước các ký tự `\`, `*`, `_`, `~`, `` ` ``, `|`, `>`, `[`, `]`, `(`, `)`, `#`; link chỉ nhận `http(s)`, thay `)` thành `%29` và khoảng trắng thành `%20`.
- `description` vượt 4096 thì bỏ link tự tìm từ cuối, vẫn vượt thì bỏ dòng ứng viên từ cuối.
- `renderQuota`: mỗi provider một dòng `**{tên}** · hôm nay {usedToday}/{allowanceToday ?? "–"} · tháng {usedPeriod}/{periodLimit ?? "–"} · {trạng thái}`. Trace.moe ghi "24 giờ" thay "hôm nay". Trạng thái: `blocked` là "hết lượt", brightdata không khỏe là "đang tạm chuyển sang SerpApi", còn lại "bình thường".
- `renderHelp`: cách dùng `/search` (bốn chế độ, `private`), "Tìm nguồn ảnh" qua menu Apps, hạn mức `{userDailySearches}` lượt/ngày và `{userDailyYandex}` lượt Yandex, câu privacy nguyên văn.
- `renderPickMenu`: select `p:<pickId>`, value là chỉ số, label/description ≤ 100 ký tự, tối đa 25 mục.

- [ ] **Step 1: Viết test thất bại**

```ts
test("found message", () => {
  const p = renderOutcome(foundOutcome(), ctx({ remainingSearches: 27 }));
  const e = p.embeds[0];
  assert.equal(e.author?.name, "NGUỒN TÌM ĐƯỢC"); assert.equal(e.color, 0x23a55a);
  assert.equal(e.title, "Sousou no Frieren");
  assert.match(e.description!, /Tập 5 · 12:34 · khớp 96% · trace\.moe/);
  assert.match(e.description!, /\*\*Ứng viên khác\*\*\n2\. /);
  assert.match(e.description!, /\*\*Tự tìm tiếp:\*\* \[Yandex\]\(https:\/\/yandex\.com\//);
  assert.equal(e.image?.url, "https://media.trace.moe/image/x.jpg");
  assert.equal(e.footer?.text, "Đã tìm: SauceNAO, trace.moe · Bạn còn 27 lượt hôm nay · Mã: 7F3K2A");
  assert.deepEqual(p.allowedMentions, { parse: [] });
});
test("Yandex button only when allowed", ...);
test("preview rules in normal and NSFW channels", ...);
test("long image URL keeps description ≤ 4096 by dropping deep links from the end", () => {
  const longUrl = "https://cdn.discordapp.com/attachments/1/2/" + "a".repeat(900) + ".png?ex=1&is=2&hm=" + "f".repeat(64);
  const e = renderOutcome(foundOutcome(), ctx({ deepLinks: buildDeepLinks(longUrl) })).embeds[0];
  assert.ok(e.description!.length <= 4096);
  assert.match(e.description!, /\[Yandex\]/);
});
test("third-party text is escaped", () => {
  const e = renderOutcome(foundOutcome({ title: "[@everyone](http://x) `x` *b*" }), ctx()).embeds[0];
  assert.equal(e.title, "\\[@everyone\\]\\(http://x\\) \\`x\\` \\*b\\*");
});
test("incomplete lists reasons", ...);   // yandex server_quota, tracemoe busy, danbooru unavailable, yandex user_quota, deadline
test("not found message", ...);
test("progress message", () => {
  const e = renderProgress({ done: ["saucenao"], current: "tracemoe" }, 60).embeds[0];
  assert.equal(e.author?.name, "ĐANG TÌM…");
  assert.equal(e.description, "Đã xong: SauceNAO\nĐang hỏi: trace.moe");
  assert.equal(e.footer?.text, "Tối đa 60 giây");
});
test("pick menu caps 25 and 100-char labels", ...);
test("custom ids round-trip and reject garbage", ...);
test("isNsfw: channel flag, thread inherits parent, null is safe", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: message rendering"`

---

### Task 13: Phiên, lượt đang chạy, app và luồng tìm chung

**Files:**
- Create: `src/discord/sessions.ts`, `src/discord/jobs.ts`, `src/app.ts`, `src/discord/start-search.ts`
- Test: `test/sessions.test.ts`, `test/start-search.test.ts`

**Interfaces:**
- Consumes: hầu hết module trước; `log` (Task 2); `newCode` (Task 2)
- Produces:

```ts
// sessions.ts — TTL + giới hạn byte, bỏ mục cũ nhất (get làm mới thứ tự)
export class SessionStore<T extends { sizeBytes: number }> {
  constructor(o: { ttlMs: number; maxBytes: number; now: () => number });
  set(key: string, v: T): void; get(key: string): T | undefined; delete(key: string): void;
}
// jobs.ts
export class JobRegistry {
  constructor(max: number);
  tryStart(): boolean; finish(): void; readonly active: number; readonly stopping: boolean;
  stopAccepting(): void; drain(timeoutMs: number): Promise<void>;
}
// app.ts
export interface Session { code: string; ownerId: string; guildId: string; nsfwChannel: boolean; ephemeral: boolean; image: LoadedImage; outcome: SearchOutcome; sizeBytes: number }
export interface PendingPick { ownerId: string; guildId: string; channelId: string; messageId: string; nsfwChannel: boolean; candidates: ImageCandidate[]; sizeBytes: number }
export interface App {
  config: Config; now: () => number; usage: UsageStore; cache: ResultCache; gates: Gates; health: ProviderHealth;
  userLimits: UserLimits; runner: Runner; jobs: JobRegistry; sessions: SessionStore<Session>; picks: SessionStore<PendingPick>;
  loadImage(input: { url: string; attachmentId?: string }): Promise<LoadedImage>;
  yandexAvailable(userId: string): boolean;
}
export function createApp(o: {
  config: Config; db: Db; engines: Record<EngineId, Engine>;
  now?: () => number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; loadImage?: App["loadImage"];
}): App;
// start-search.ts
export interface Responder { replyEphemeral(p: Payload): Promise<void>; defer(ephemeral: boolean): Promise<void>; edit(p: Payload): Promise<void> }
export interface StartSearchParams {
  userId: string; guildId: string; nsfwChannel: boolean; ephemeral: boolean; mode: Mode;
  image: { url: string; attachmentId?: string } | LoadedImage;
}
export function startSearch(p: StartSearchParams, r: Responder, app: App): Promise<void>;
export function startExtraYandex(code: string, userId: string, r: Responder, app: App): Promise<void>;
```

Giá trị: sessions `ttlMs` 600 000, `maxBytes` 134 217 728; picks `ttlMs` 600 000, `maxBytes` 1 048 576 (`sizeBytes` = độ dài JSON của candidates). `yandexAvailable(u)` đúng khi (brightdata khỏe, `budget("brightdata","extra")` ok, `canUseYandex(u,"brightdata")`) hoặc (`budget("serpapi","extra")` ok, `canUseYandex(u,"serpapi")`).

`startSearch`:
1. `jobs.stopping` → `replyEphemeral(restarting)`, dừng.
2. `checkStart(userId,"search")` không ok → `replyEphemeral` (cooldown / dailyLimit kèm link tự tìm / active), dừng.
3. `!jobs.tryStart()` → `replyEphemeral(busy + link)`, dừng.
4. `defer(ephemeral)`; `begin(userId,"search")`.
5. Nạp ảnh (nếu `image` chưa là `LoadedImage`); `ImageError` → `edit(renderImageError)`.
6. `code = newCode()`; `deadlineAt = lúc nhận + jobDeadlineMs`.
7. `runSearch` với `onProgress` → `edit(renderProgress)`.
8. Lưu session (`sizeBytes = image.bytesInMemory()`); `edit(renderOutcome)` với `showYandexButton = yandexAvailable && chưa có outcome yandex ok/no_match`.
9. Log `search_done`: code, mode, nsfw, mỗi engine (status, via, fromCache, điểm), tier đã gán, main và others (engine, tier, score, url), durationMs.
10. Lỗi bất ngờ → `edit(genericError + link)` và log `error`. `finally`: `end(userId)`, `jobs.finish()`.

`startExtraYandex`: session thiếu → `replyEphemeral(sessionExpired)`; `checkStart(userId,"extra")`; `!yandexAvailable` → `replyEphemeral(yandexUnavailable)`; `tryStart`; `defer`; `begin(userId,"extra")`; `runExtraYandex`; cập nhật session; `edit(renderOutcome)`.

- [ ] **Step 1: Viết test thất bại** (`createApp` với engine giả, DB in-memory, `loadImage` giả trả ảnh có sẵn; responder giả ghi lại lời gọi và thời điểm):

```ts
test("session store expires and evicts the oldest by bytes", ...);
test("job registry caps active jobs and drains on shutdown", ...);
test("cooldown is answered ephemerally without defer", ...);
test("image error edits the deferred reply with the error and deep links", ...);
test("successful search stores a session and renders the outcome with its code", ...);
test("50 concurrent users are all deferred within 3 s and all get a final message", { timeout: 60_000 }, async () => {
  // engine giả trễ ngẫu nhiên 50–300 ms; 50 userId khác nhau; Promise.all(startSearch…)
  // mỗi responder: defer được gọi trong ≤ 3000 ms kể từ lúc bắt đầu; edit cuối là embed kết quả
  // (outcome busy do gate thật là hợp lệ); jobs.active === 0
});
test("the 101st concurrent search gets the busy notice", ...);   // maxActiveJobs 100
test("startExtraYandex refuses when Yandex is unavailable", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5: Commit** — `git commit -m "feat: sessions, jobs, app container and shared search flow"`

---

### Task 14: Adapter trace.moe

**Files:**
- Create: `src/engines/http.ts`, `src/engines/tracemoe.ts`, `scripts/smoke-engine.ts`, `test/fixtures/tracemoe/search.json` (tạm, theo swagger, nếu Task 3 chưa chạy), `test/fixtures/tracemoe/me.json`
- Test: `test/engines/tracemoe.test.ts`

**Interfaces:**
- Consumes: `Engine`, `EngineResponse`, `Match` (Task 4); `formatTimestamp` (Task 2)
- Produces:
  - `class PreSendError extends Error {}`; `sendRequest(f: typeof fetch, url: string, init: RequestInit): Promise<Response>` — lỗi có `cause.code` thuộc `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN` thì thử lại 1 lần, lần hai vẫn lỗi thì throw `PreSendError`; lỗi khác giữ nguyên
  - `createTraceMoe(deps: { fetch: typeof fetch }): Engine & { getMe(signal?: AbortSignal): Promise<{ quota: number; quotaUsed: number }> }`
  - `scripts/smoke-engine.ts <engine> <url ảnh Discord>`: tải và chuẩn hóa ảnh, dựng adapter từ biến môi trường cần thiết, gọi một lần với timeout 15 s, in status và các match kèm `classify`. Task này thêm nhánh `tracemoe`; các task adapter sau thêm nhánh của mình.

Engine: `id "tracemoe"`, `providers ["tracemoe"]`, `version 1`, `cacheParams()` = `"cb1"`. Request `POST https://api.trace.moe/search?anilistInfo&cutBorders=1`, body là `await image.jpeg()`, `content-type: image/jpeg`, `signal`. Map trạng thái: 200 có `result` → `ok` (lấy tối đa 5); 200 rỗng → `no_match`; 400 → `invalid_input`; 402 → `quota_exhausted`; 429 → `rate_limited`; khác → `unavailable`; zod không khớp → `unavailable`; `AbortError` → `timeout` (`sent: true`); `PreSendError` → `unavailable` (`sent: false`); `ImageError` khi gọi `jpeg()` → `invalid_input` (`sent: false`). Map match:
- `title`: `anilist.title.romaji`, thêm ` / {english}` nếu khác
- `url`: `https://anilist.co/anime/{anilist.id}`
- `detail`: `Tập {episode} · {formatTimestamp(from)}`; mảng thì nối bằng `–`; null thì chỉ có thời điểm
- `score`: `similarity`; `previewUrl`: `image`; `videoUrl`: `video`; `adult`: `anilist.isAdult`
- `isAnime: true`; `hasEpisodeAndTime: episode != null`

- [ ] **Step 1: Viết test thất bại** (fetch giả trả `new Response(fixture, { status })`):

```ts
test("maps results from the fixture", ...);   // title, url anilist, detail "Tập …", score, preview, video, adult
test("empty result → no_match", ...);
test("402 → quota_exhausted, 429 → rate_limited, 400 → invalid_input", ...);
test("unexpected payload → unavailable without throwing", ...);   // 200 với {"foo":1}
test("abort → timeout and sent", ...);
test("connection refused twice → unavailable, not sent, fetch called twice", ...);
test("episode as array and null", ...);
test("getMe parses quota and quotaUsed", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5 (cần ảnh Discord):** `node --env-file-if-exists=.env scripts/smoke-engine.ts tracemoe <url cảnh anime>` — Expected: status `ok`, match đầu tier `source` hoặc `maybe`.
- [ ] **Step 6: Commit** — `git commit -m "feat: trace.moe adapter"`

---

### Task 15: Adapter SauceNAO

**Files:**
- Create: `src/engines/saucenao.ts`, `test/fixtures/saucenao/search.json` (tạm nếu chưa có fixture thật: một kết quả art index 5, một kết quả anime index 21 có `part` và `est_time`)
- Modify: `scripts/smoke-engine.ts` (nhánh `saucenao`)
- Test: `test/engines/saucenao.test.ts`

**Interfaces:**
- Consumes: `sendRequest`, `PreSendError` (Task 14); types (Task 4)
- Produces:
  - `SAUCENAO_HIDE_NORMAL = 3` (đổi theo kết quả Task 3)
  - `SAUCENAO_MOVIES_SHOWS_DBMASK = 25165824` (index 23 và 24; xác nhận ở Task 3)
  - `SAUCENAO_ANIME_INDEXES = [21, 22]`
  - `createSauceNao(deps: { fetch: typeof fetch; apiKey: string }): Engine`

Engine: `version 1`; `cacheParams({mode, nsfwChannel})` = `${mode === "movie" ? "mv" : "all"}:h${nsfwChannel ? 0 : SAUCENAO_HIDE_NORMAL}`.

Request: `POST https://saucenao.com/search.php?output_type=2&numres=8&api_key=…`, kèm `db=999` (movie: `dbmask=25165824`) và `hide=<SAUCENAO_HIDE_NORMAL>` khi không phải kênh NSFW. FormData `file` là `new Blob([jpeg], { type: "image/jpeg" })`, tên `image.jpg`.

Trạng thái: 429 → `quota_exhausted` nếu `long_remaining` = 0 hoặc body nói vượt giới hạn ngày, ngược lại `rate_limited`; 413 → `invalid_input`; `header.status` khác 0 → `unavailable`; không có kết quả → `no_match`; có → `ok`. Trả `quota: { shortRemaining, longRemaining }` khi header có.

Match:
- `score`: `parseFloat(header.similarity)`; `url`: `data.ext_urls[0]` (không có thì bỏ match)
- `title`: lấy theo thứ tự `data.title`, `data.source`, `data.material`, `header.index_name`
- `isAnime`: `index_id` thuộc `[21, 22]`; `adult`: index 22 thì `true`, còn lại `null`
- `detail`: anime là `Tập {part} · {phần trước " / " của est_time}`; art là `Tác giả: {member_name ?? creator ?? author_name} · {hostname}`
- `hasEpisodeAndTime`: có `part` và `est_time`; `previewUrl`: `header.thumbnail`
- Ở kênh thường bỏ kết quả có `header.hidden` khác 0

- [ ] **Step 1: Viết test thất bại**

```ts
test("maps art and anime results", ...);
test("normal channel sends hide, NSFW channel does not", ...);   // kiểm tra URL request
test("movie mode uses the Movies/Shows dbmask", ...);
test("returns header quota", ...);
test("429 with long_remaining 0 → quota_exhausted; otherwise rate_limited", ...);
test("unexpected payload → unavailable without throwing", ...);
test("hidden results dropped in normal channels", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5 (cần key):** `node --env-file-if-exists=.env scripts/smoke-engine.ts saucenao <url fanart>` — Expected: `ok`, match có tác giả.
- [ ] **Step 6: Commit** — `git commit -m "feat: SauceNAO adapter"`

---

### Task 16: Adapter Danbooru IQDB

**Files:**
- Create: `src/engines/danbooru.ts`, `test/fixtures/danbooru/iqdb.json` (tạm nếu chưa có fixture thật)
- Modify: `scripts/smoke-engine.ts` (nhánh `danbooru`)
- Test: `test/engines/danbooru.test.ts`

**Interfaces:**
- Consumes: `sendRequest` (Task 14); types (Task 4)
- Produces: `createDanbooru(deps: { fetch: typeof fetch; login: string; apiKey: string; userId: string }): Engine`

Engine: `version 1`, `cacheParams()` = `"l5"`. Request `GET https://danbooru.donmai.us/iqdb_queries.json?url=<encodeURIComponent(image.url)>&limit=5`, header `Authorization: Basic base64(login:apiKey)` và `User-Agent: TimNguonBot/1.0 (user #<userId>)`.

Trạng thái: 200 `[]` → `no_match`; 200 có phần tử → `ok`; 401/403 → `unavailable`; 429 → `rate_limited`; 400/422 → `invalid_input`; zod lỗi → `unavailable`.

Match:
- `score`: `item.score`; `url`: `post.source` nếu là http(s), ngược lại `https://danbooru.donmai.us/posts/{post.id}`
- `title`: `tag_string_artist` (tách khoảng trắng, nối `, `), rỗng thì `Danbooru #{id}`
- `detail`: `Tác giả: {artist} · {hostname của url}`
- `previewUrl`: `post.preview_file_url`; `rating`: `post.rating`; `adult`: `rating !== "g"`

Nếu Task 3 cho thấy thang điểm khác 0–100, chỉnh `THRESHOLDS.danbooru` (Task 9) và ghi vào spec mục 17. Đọc header `x-rate-limit` theo dạng đã ghi ở spec mục 17 (spec mục 7.3); header báo hết lượt thì trả `rate_limited` dù HTTP 200.

- [ ] **Step 1: Viết test thất bại**

```ts
test("sends basic auth and the Danbooru user agent", ...);
test("maps posts with artist, source and rating", ...);
test("falls back to the post URL when source is not http", ...);
test("empty → no_match; 429 → rate_limited; 403 → unavailable", ...);
test("unexpected payload → unavailable without throwing", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5 (cần key):** smoke với một fanart có trên Danbooru — Expected: `ok`.
- [ ] **Step 6: Commit** — `git commit -m "feat: Danbooru IQDB adapter"`

---

### Task 17: Yandex qua SerpApi

**Files:**
- Create: `src/engines/yandex/types.ts`, `src/engines/yandex/serpapi.ts`, `test/fixtures/yandex/serpapi.json`, `test/fixtures/yandex/serpapi-account.json` (fixture thật từ Task 3; chưa có thì tạm theo tài liệu SerpApi)
- Modify: `scripts/smoke-engine.ts` (nhánh `yandex-serpapi`)
- Test: `test/engines/yandex-serpapi.test.ts`

**Interfaces:**
- Consumes: `sendRequest` (Task 14); types (Task 4)
- Produces:
  - `interface YandexSite { title: string; url: string; domain: string; thumbnailUrl?: string }`
  - `sitesToMatches(sites: YandexSite[]): Match[]` — `{ engine: "yandex", title, url, domain, previewUrl: thumbnailUrl, adult: null }`
  - `yandexViaSerpApi(imageUrl: string, deps: { fetch: typeof fetch; apiKey: string; signal: AbortSignal }): Promise<EngineResponse>`
  - `getSerpApiAccount(deps: { fetch: typeof fetch; apiKey: string; signal?: AbortSignal }): Promise<{ totalSearchesLeft: number; thisMonthUsage: number }>`

Request: `GET https://serpapi.com/search.json?engine=yandex_images&url=<enc>&api_key=…`. Mảng kết quả lấy theo tên đã ghi ở spec mục 17 (dự kiến `image_results` với `title`, `link`, `source`, `thumbnail`).

Trạng thái: 200 có kết quả → `ok`; 200 có `error` báo không có kết quả → `no_match`; 429 có chữ "run out of searches" → `quota_exhausted`, 429 khác → `rate_limited`; 401 → `unavailable`; zod lỗi → `unavailable`.

Account: `GET https://serpapi.com/account.json?api_key=…`, đọc `total_searches_left` và `this_month_usage`.

- [ ] **Step 1: Viết test thất bại** — map sites; no_match; hai loại 429; payload lạ; account.
- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5 (cần key):** smoke `yandex-serpapi` — Expected: `ok` hoặc `no_match`, không lỗi.
- [ ] **Step 6: Commit** — `git commit -m "feat: Yandex via SerpApi"`

---

### Task 18: Yandex qua Bright Data và engine Yandex

**Bị chặn** cho tới khi có `test/fixtures/yandex/brightdata-sites.html` thật từ Task 3. Bright Data không trả được trang Yandex thì dừng và hỏi chủ server.

**Files:**
- Create: `src/engines/yandex/parse-html.ts`, `src/engines/yandex/brightdata.ts`, `src/engines/yandex/index.ts`, `test/fixtures/yandex/captcha.html` (trang có `showcaptcha`)
- Modify: `scripts/smoke-engine.ts` (nhánh `yandex`)
- Test: `test/engines/yandex.test.ts`

**Interfaces:**
- Consumes: `YandexSite`, `sitesToMatches`, `yandexViaSerpApi` (Task 17); `sendRequest` (Task 14)
- Produces:
  - `class YandexParseError extends Error {}`
  - `parseYandexSites(html: string): YandexSite[]` — captcha hoặc không nhận ra cấu trúc thì throw `YandexParseError`; trang đúng mà không có site thì `[]`
  - `yandexPageUrl(imageUrl: string): string` — `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url=<enc>`
  - `yandexViaBrightData(imageUrl: string, deps: { fetch: typeof fetch; apiKey: string; zone: string; signal: AbortSignal }): Promise<EngineResponse>` — `YandexParseError` thì `{ status: "unavailable", parseFailed: true, sent: true }`
  - `createYandex(deps: { fetch: typeof fetch; brightdataApiKey: string; brightdataZone: string; serpapiApiKey: string }): Engine` — `providers ["brightdata", "serpapi"]`, `version 1`, `cacheParams()` = `"sites"`; `search(input, provider)` gọi đường tương ứng với `input.image.url`

Bright Data: `POST https://api.brightdata.com/request`, `Authorization: Bearer <key>`, JSON `{ zone, url: yandexPageUrl(imageUrl), format: "raw" }`. Map: 200 → parse; 401/403 → `unavailable`; 402 → `quota_exhausted`; 429 → `rate_limited`; khác → `unavailable`. Parser không thêm dependency; cách đọc (JSON nhúng hay DOM) chọn theo fixture thật.

- [ ] **Step 1: Viết test thất bại**

```ts
test("parses sites from the real Bright Data fixture", ...);   // ≥ 1 site có title, url http(s), domain
test("captcha page → YandexParseError", ...);
test("unrecognized html → YandexParseError", ...);
test("brightdata parse failure → unavailable with parseFailed", ...);
test("engine routes each provider to its path", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5 (cần key):** smoke `yandex` với ảnh fanart và khung phim — Expected: `ok` qua brightdata.
- [ ] **Step 6: Commit** — `git commit -m "feat: Yandex via Bright Data"`

---

### Task 19: Lệnh Discord, router và entry point

**Files:**
- Create: `src/engines/index.ts`, `src/discord/commands.ts`, `src/discord/responders.ts`, `src/discord/router.ts`, `src/index.ts`
- Test: `test/commands.test.ts`, `test/router.test.ts`

**Interfaces:**
- Consumes: mọi adapter (Task 14–18), `createApp`, `startSearch`, `startExtraYandex` (Task 13), render (Task 12), `extractCandidates` (Task 8), `loadConfig` (Task 1), `openDb` (Task 4)
- Produces:
  - `createEngines(config: Config, f: typeof fetch): { engines: Record<EngineId, Engine>; traceMe(): Promise<{ quota: number; quotaUsed: number }>; serpapiAccount(): Promise<{ totalSearchesLeft: number; thisMonthUsage: number }> }`
  - `COMMANDS` (JSON thô) và `registerCommands(config: Config): Promise<void>` — `new REST().setToken(token).put(Routes.applicationGuildCommands(appId, guildId), { body: COMMANDS })`
  - `commandResponder(i)`: `replyEphemeral` → `i.reply({ ...p, flags: MessageFlags.Ephemeral })`; `defer(e)` → `i.deferReply(e ? { flags: MessageFlags.Ephemeral } : {})`; `edit` → `i.editReply(p)`
  - `updateResponder(i)`: như trên nhưng `defer` → `i.deferUpdate()`
  - `route(i: Interaction, app: App): Promise<void>`

`COMMANDS`:

```ts
[
  { name: "search", type: 1, description: "Tìm nguồn ảnh anime, art hoặc phim", options: [
    { name: "image", type: 11, description: "Chọn ảnh cần tìm nguồn", required: true, file_types: ["image"] },
    { name: "mode", type: 3, description: "Chế độ tìm, mặc định tự động", required: false, choices: [
      { name: "Tự động", value: "auto" }, { name: "Cảnh anime", value: "anime" },
      { name: "Art / tranh", value: "art" }, { name: "Phim người đóng", value: "movie" } ] },
    { name: "private", type: 5, description: "Chỉ mình bạn thấy kết quả", required: false } ] },
  { name: "Tìm nguồn ảnh", type: 3 },
  { name: "quota", type: 1, description: "Xem quota còn lại của từng nguồn", default_member_permissions: "32" },
  { name: "help", type: 1, description: "Cách dùng bot tìm nguồn ảnh" },
]
```

`route`:
- `/search`: `startSearch` với `getAttachment("image", true)` (url, id), mode (mặc định `"auto"`), `private` (mặc định `false`), `isNsfw(i.channel)`, `commandResponder`.
- "Tìm nguồn ảnh": `extractCandidates({ attachments: [...targetMessage.attachments.values()], embeds: targetMessage.embeds })`. 0 → ephemeral `noImage`. 1 → `startSearch` (ephemeral, auto). Nhiều → lưu `PendingPick` với `pickId = newCode()`, trả ephemeral `renderPickMenu`.
- Component:
  - `parseCustomId` lỗi hoặc session/pick thiếu → ephemeral `sessionExpired`
  - người bấm không phải chủ → ephemeral `notOwner`
  - `mode` → `i.update({ components: renderModeSelect(code, outcome.mode) })`
  - `modeSelect` → `startSearch` (mode mới, `image: session.image`, `ephemeral: session.ephemeral`, `updateResponder`)
  - `yandex` → `startExtraYandex(code, userId, updateResponder(i), app)`
  - `pick` → `startSearch` (candidate đã chọn, ephemeral, auto, `updateResponder`). Nếu `signedUrlExpiresAt(candidate.url)` đã qua thì fetch lại tin nhắn `channelId`/`messageId` và lấy lại candidate cùng chỉ số (spec mục 9); tin nhắn đã mất thì trả `imageFetch`
- `/quota`: thiếu `ManageGuild` → ephemeral `adminOnly`; có → ephemeral `renderQuota(app.gates.stats(), app.health.snapshot())`.
- `/help`: ephemeral `renderHelp`.

`src/index.ts`:
1. `loadConfig(process.env)`; gặp `ConfigError` thì in `problems` và `process.exit(1)`.
2. `openDb`, `createEngines`, `createApp`.
3. Đồng bộ `traceMe` → `gates.noteTraceMe` và `serpapiAccount` → `gates.noteSerpapiAccount`; lỗi chỉ log.
4. `registerCommands`.
5. `new Client({ intents: [GatewayIntentBits.Guilds] })`; `Events.InteractionCreate` → `route`, lỗi chỉ log.
6. Timer `unref()`: trace mỗi 600 000 ms; serpapi mỗi 3 600 000 ms; mỗi 3 600 000 ms `cache.purgeExpired()` và `usage.purgeBefore(now − 40 ngày)`.
7. SIGTERM/SIGINT: `jobs.stopAccepting()`, `await jobs.drain(jobDeadlineMs)`, `client.destroy()`, đóng DB, `exit(0)`.
8. `client.login`.

- [ ] **Step 1: Viết test thất bại** (interaction giả là object có các method `isChatInputCommand()`, `reply`, `update`, … ghi lại lời gọi):

```ts
test("commands match the spec", () => {
  const search = COMMANDS.find(c => c.name === "search")!;
  assert.deepEqual(search.options!.find(o => o.name === "image"), { name: "image", type: 11, description: "Chọn ảnh cần tìm nguồn", required: true, file_types: ["image"] });
  assert.equal(COMMANDS.find(c => c.name === "quota")!.default_member_permissions, "32");
  assert.ok(COMMANDS.some(c => c.name === "Tìm nguồn ảnh" && c.type === 3));
});
test("stale or foreign component: ephemeral notice, no quota or counters touched", async () => {
  // y:<code> không có session → sessionExpired; session của u1 mà u2 bấm → notOwner;
  // UserCounters của u2 vẫn 0; runner giả không được gọi
});
test("context menu without images replies noImage", ...);
test("context menu with several images replies a pick menu", ...);
test("pick with an expired signed URL refetches the message", ...);   // candidate có ex trong quá khứ → messages.fetch được gọi, URL mới được dùng
test("/quota without Manage Server is refused", ...);
```

- [ ] **Step 2: `npm test`** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: `npm test`** — PASS; typecheck sạch.
- [ ] **Step 5 (cần bot thật, kênh thử):** `npm start`. Trong server thử kiểm tra:
  - `/search` với ảnh anime, fanart, phim
  - `/search private:true`
  - menu "Tìm nguồn ảnh" trên tin nhắn 1 ảnh và nhiều ảnh
  - nút "Đổi chế độ" và "Tìm thêm bằng Yandex"; tài khoản thứ hai bấm nút
  - kênh NSFW và kênh thường
  - `/quota` bằng admin và không admin; `/help`
  - Danbooru và Yandex chạy được với ảnh tải lên bằng `/search` (không phải `invalid_input`); nếu không, báo chủ server theo spec mục 13
- [ ] **Step 6: Commit** — `git commit -m "feat: discord commands, router and entry point"`

---

### Task 20: Docker, skill dự án và nghiệm thu

**Files:**
- Create: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `.claude/skills/phase0-verify/SKILL.md`, `.claude/skills/deploy-vps/SKILL.md`

- [ ] **Step 1: Viết file triển khai**

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
CMD ["node", "src/index.ts"]
```

```yaml
services:
  bot:
    build: .
    env_file: .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
```

`.dockerignore`: `node_modules`, `.env`, `data`, `.superpowers`, `.git`, `test`, `docs`, `scripts`.

- [ ] **Step 2: Viết 2 skill dự án** (frontmatter `name`, `description`; nội dung ngắn):
  - `phase0-verify`: khi nào chạy, lệnh từng script ở Task 3, fixture nằm ở đâu, cách ghi spec mục 17, chạy lại test adapter sau khi thay fixture.
  - `deploy-vps`: chuẩn bị `.env` trên VPS; `docker compose up -d --build`; xem log `docker compose logs -f bot`; cập nhật (`git pull` rồi build lại, bot tự drain khi nhận SIGTERM); sao lưu `data/bot.db`.
- [x] **Step 3: `npm test` và `npm run typecheck`** — Expected: tất cả PASS, typecheck sạch.
- [x] **Step 4 (trên VPS):** `docker compose up -d --build` — Expected: log có dòng sẵn sàng, `/search` trong server hoạt động; restart container thì bot quay lại.
- [x] **Step 5: Nghiệm thu** theo bảng spec mục 14.2 trong server thử; ghi ca chưa đạt thành việc cần sửa.
- [x] **Step 6: Commit** — `git commit -m "chore: docker deployment and project skills"`

---

## Giai đoạn 2 (v3.0): Nâng cấp Free, Unlimited, Zero-Delay, Full NSFW & Cloudflare WARP

### Task 21: Cấu hình Free & Unlimited (Optional Keys + Zero-Delay Defaults)

**Files:**
- Modify: `src/config.ts`, `.env.example`, `src/limits/gates.ts`, `src/limits/user-limits.ts`
- Test: `test/config.test.ts`

- [x] **Step 1:** Chỉ bắt buộc `DISCORD_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_GUILD_ID` trong `loadConfig`; chuyển toàn bộ API key bên thứ ba sang tùy chọn (mặc định `""`).
- [x] **Step 2:** Thêm `SAUCENAO_API_KEYS` (danh sách key phân tách bằng dấu phẩy), `UNLIMITED_GATES` (mặc định `true`), `PARALLEL_SEARCH` (mặc định `true`), `ALLOW_CONCURRENT_USER_SEARCHES` (mặc định `true`).
- [x] **Step 3:** Đặt mặc định `USER_COOLDOWN_MS=0`, `USER_DAILY_SEARCHES=1000000`, `USER_DAILY_YANDEX=1000000`, `USER_DAILY_YANDEX_SERPAPI=1000000`.

### Task 22: SauceNAO Multi-Key Rotation, Web HTML Fallback & NSFW `hide=0`

**Files:**
- Modify: `src/engines/saucenao.ts`, `src/engines/index.ts`
- Test: `test/engines/saucenao.test.ts`

- [x] **Step 1:** Hỗ trợ xoay vòng nhiều key (`apiKeys`) khi gặp `429`/`quota_exhausted`.
- [x] **Step 2:** Bổ sung `parseSauceNaoHtml` và `searchSauceNaoWeb` để tìm kiếm trực tiếp qua giao diện Web khi không có API key hoặc toàn bộ key hết quota.
- [x] **Step 3:** Cấu hình `hideNormal: false` (`hide=0`) để tìm được cả nguồn NSFW ở kênh thường, đồng thời gắn cờ `adult: true` cho các index 18+ (H-Misc, e-hentai, Fakku, Gelbooru, Sankaku, Yande.re…) để `previewAllowed` tự động ẩn ảnh thumbnail ở kênh thường.

### Task 23: Danbooru Optional Auth & IQDB.org Multi-Booru Provider

**Files:**
- Modify: `src/engines/types.ts`, `src/engines/danbooru.ts`, `src/engines/index.ts`
- Test: `test/engines/danbooru.test.ts`

- [x] **Step 1:** Thêm `"iqdb"` vào `ProviderId`.
- [x] **Step 2:** Cho phép gọi `danbooru` không cần Basic Auth khi không cấu hình `DANBOORU_LOGIN`/`DANBOORU_API_KEY`.
- [x] **Step 3:** Bổ sung `parseIqdbHtml` và `searchIqdbOrg` (`https://iqdb.org/`) bao phủ đồng thời Danbooru, Konachan, Yande.re, Gelbooru, Sankaku Complex, Zerochan, Anime-Pictures kèm phân loại `[Safe]` / `[Ero]` / `[Explicit]`.

### Task 24: Yandex Direct (Family Filter Off) & Modern State Parser

**Files:**
- Create: `src/engines/yandex/direct.ts`
- Modify: `src/engines/types.ts`, `src/engines/yandex/parse-html.ts`, `src/engines/yandex/index.ts`, `src/search/tiers.ts`
- Test: `test/engines/yandex.test.ts`

- [x] **Step 1:** Thêm `"yandex_direct"` vào `ProviderId` và ưu tiên chạy đầu tiên trong `createYandex`.
- [x] **Step 2:** Gọi `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&family=no&url=<enc>` kèm header `Cookie: yp=1999999999.sp.family%3A0` để mở khóa kết quả NSFW 3D/Cosplay/Movie/2D.
- [x] **Step 3:** Cập nhật `parseYandexSites` đọc `initialState.cbirSites.sites` và `initialState.cbirSitesList.sites` của giao diện Yandex hiện đại.
- [x] **Step 4:** Mở rộng `KNOWN_SOURCE_DOMAINS` với các domain 2D/3D/NSFW/Booru phổ biến.

### Task 25: Thực thi Song song theo Đợt (Parallel Waves)

**Files:**
- Modify: `src/search/flow.ts`, `src/search/orchestrator.ts`, `src/discord/start-search.ts`
- Test: `test/orchestrator.test.ts`

- [x] **Step 1:** Thêm hàm `nextBatch(mode, outcomes, opts)` trả về danh sách các engine có thể chạy đồng thời trong mỗi đợt.
- [x] **Step 2:** Cập nhật `runSearch` hỗ trợ `parallel: true` (`Promise.all` cho các engine trong cùng một đợt, dừng sớm ngay khi Đợt 1 tìm thấy kết quả mức `source`).

### Task 26: Docker Compose + Cloudflare WARP Proxy Sidecar

**Files:**
- Modify: `Dockerfile`, `docker-compose.yml`, `package.json`

- [x] **Step 1:** Thêm cờ `--use-env-proxy` vào lệnh chạy Node 24 trong `Dockerfile` và `package.json`.
- [x] **Step 2:** Thêm service `warp` (`caomingjun/warp:latest`) vào `docker-compose.yml` và cấu hình `HTTP_PROXY=http://warp:1080`, `HTTPS_PROXY=http://warp:1080`, kèm `NO_PROXY` cho toàn bộ tên miền Discord.
