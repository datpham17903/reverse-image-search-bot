import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeMd, previewAllowed, renderHelp, renderImageError, renderModeSelect, renderNotice, renderOutcome,
  renderPickMenu, renderProgress, renderQuota, type RenderContext,
} from "../src/discord/render.ts";
import { customId, parseCustomId } from "../src/discord/custom-id.ts";
import { isNsfw } from "../src/discord/nsfw.ts";
import { buildDeepLinks } from "../src/search/deeplinks.ts";
import { finalize, type SearchOutcome } from "../src/search/orchestrator.ts";
import type { EngineOutcome, Match, TieredMatch } from "../src/engines/types.ts";
import type { ImageCandidate } from "../src/images/candidates.ts";

const trace: Match = {
  engine: "tracemoe", title: "Sousou no Frieren", url: "https://anilist.co/anime/1", detail: "Tập 5 · 12:34", score: 0.96,
  previewUrl: "https://media.trace.moe/image/x.jpg", videoUrl: "https://media.trace.moe/video/x.mp4", adult: false,
};
const sauce: Match = { engine: "saucenao", title: "Frieren fanart", url: "https://pixiv.net/1", detail: "Pixiv", score: 88.4, adult: false };

function foundOutcome(over: Partial<Match> = {}): SearchOutcome {
  const main: TieredMatch = { ...trace, ...over, tier: "source" };
  const other: TieredMatch = { ...sauce, tier: "maybe" };
  const outcomes: EngineOutcome[] = [
    { engine: "saucenao", status: "ok", matches: [sauce] },
    { engine: "tracemoe", status: "ok", matches: [main] },
  ];
  return { code: "7F3K2A", mode: "auto", outcomes, tiered: [main, other], main, others: [other], state: "found" };
}
const ctx = (o: Partial<RenderContext> = {}): RenderContext => ({
  nsfwChannel: false, remainingSearches: 27, deepLinks: buildDeepLinks("https://cdn.discordapp.com/a.png"), showYandexButton: false, ...o,
});
const buttons = (p: { components: unknown[] }) =>
  (p.components as { components: { custom_id: string; label: string }[] }[]).flatMap(r => r.components);

test("found message", () => {
  const p = renderOutcome(foundOutcome(), ctx({ remainingSearches: 27 }));
  const e = p.embeds[0];
  assert.equal(e.author?.name, "NGUỒN TÌM ĐƯỢC"); assert.equal(e.color, 0x23a55a);
  assert.equal(e.title, "Sousou no Frieren");
  assert.equal(e.url, "https://anilist.co/anime/1");
  assert.match(e.description!, /Tập 5 · 12:34 · khớp 96% · trace\.moe/);
  assert.match(e.description!, /\[Xem đoạn cảnh\]\(https:\/\/media\.trace\.moe\/video\/x\.mp4\)/);
  assert.match(e.description!, /\*\*Ứng viên khác\*\*\n2\. /);
  assert.match(e.description!, /2\. \[Frieren fanart\]\(https:\/\/pixiv\.net\/1\) · Pixiv · 88% SauceNAO · có thể là/);
  assert.match(e.description!, /\*\*Tự tìm tiếp:\*\* \[Yandex\]\(https:\/\/yandex\.com\//);
  assert.equal(e.image?.url, "https://media.trace.moe/image/x.jpg");
  assert.equal(e.footer?.text, "Đã tìm: SauceNAO, trace.moe · Bạn còn 27 lượt hôm nay · Mã: 7F3K2A");
  assert.deepEqual(p.allowedMentions, { parse: [] });
  assert.deepEqual(buttons(p).map(b => [b.label, b.custom_id]), [["Đổi chế độ", "m:7F3K2A"]]);
});

test("Yandex button only when allowed", () => {
  const off = buttons(renderOutcome(foundOutcome(), ctx()));
  assert.equal(off.length, 1);
  const on = buttons(renderOutcome(foundOutcome(), ctx({ showYandexButton: true })));
  assert.deepEqual(on.map(b => [b.label, b.custom_id]), [["Đổi chế độ", "m:7F3K2A"], ["Tìm thêm bằng Yandex", "y:7F3K2A"]]);
});

test("preview rules in normal and NSFW channels", () => {
  const base: Match = { engine: "saucenao", title: "t", url: "https://x", adult: null };
  assert.equal(previewAllowed({ ...base, engine: "yandex" }, false), false);
  assert.equal(previewAllowed({ ...base, engine: "yandex" }, true), true);
  assert.equal(previewAllowed({ ...base, engine: "danbooru", rating: "g" }, false), true);
  assert.equal(previewAllowed({ ...base, engine: "danbooru", rating: "s" }, false), false);
  assert.equal(previewAllowed({ ...base, engine: "danbooru", rating: "e" }, true), true);
  assert.equal(previewAllowed({ ...base, engine: "tracemoe", adult: false }, false), true);
  assert.equal(previewAllowed({ ...base, engine: "tracemoe", adult: null }, false), false);
  assert.equal(previewAllowed({ ...base, adult: null }, false), true);
  assert.equal(previewAllowed({ ...base, adult: true }, false), false);
  const adult = renderOutcome(foundOutcome({ adult: true }), ctx()).embeds[0];
  assert.equal(adult.image, undefined);
  assert.doesNotMatch(adult.description!, /Xem đoạn cảnh/);
  assert.equal(renderOutcome(foundOutcome({ adult: true }), ctx({ nsfwChannel: true })).embeds[0].image?.url, trace.previewUrl);
});

test("long image URL keeps description ≤ 4096 by dropping deep links from the end", () => {
  const longUrl = "https://cdn.discordapp.com/attachments/1/2/" + "a".repeat(900) + ".png?ex=1&is=2&hm=" + "f".repeat(64);
  const e = renderOutcome(foundOutcome(), ctx({ deepLinks: buildDeepLinks(longUrl) })).embeds[0];
  assert.ok(e.description!.length <= 4096);
  assert.match(e.description!, /\[Yandex\]/);
});

test("third-party text is escaped", () => {
  const e = renderOutcome(foundOutcome({ title: "[@everyone](http://x) `x` *b*" }), ctx()).embeds[0];
  assert.equal(e.title, "\\[@everyone\\]\\(http://x\\) \\`x\\` \\*b\\*");
  assert.equal(escapeMd("a_b~c|d>e#f\\g"), "a\\_b\\~c\\|d\\>e\\#f\\\\g");
});

test("urls: only http(s), parentheses and spaces encoded", () => {
  const e = renderOutcome(foundOutcome({ url: "javascript:alert(1)", videoUrl: "https://v/a (1).mp4" }), ctx()).embeds[0];
  assert.equal(e.url, undefined);
  assert.match(e.description!, /\]\(https:\/\/v\/a%20\(1%29\.mp4\)/);
});

test("incomplete lists reasons", () => {
  const outcomes: EngineOutcome[] = [
    { engine: "yandex", status: "server_quota", matches: [] },
    { engine: "tracemoe", status: "busy", matches: [] },
    { engine: "danbooru", status: "unavailable", matches: [] },
    { engine: "saucenao", status: "ok", matches: [] },
  ];
  const o = finalize("ABC123", "auto", outcomes);
  assert.equal(o.state, "incomplete");
  const e = renderOutcome(o, ctx()).embeds[0];
  assert.equal(e.author?.name, "CHƯA TÌM HẾT");
  assert.equal(e.color, 0xf0b232);
  assert.match(e.description!, /Yandex: hết lượt hôm nay của server/);
  assert.match(e.description!, /trace\.moe: đang bận/);
  assert.match(e.description!, /Danbooru: lỗi/);
  assert.doesNotMatch(e.description!, /SauceNAO:/);
  assert.match(e.description!, /\*\*Tự tìm tiếp:\*\*/);
  const o2 = finalize("ABC123", "auto", [
    { engine: "yandex", status: "user_quota", matches: [] }, { engine: "tracemoe", status: "deadline", matches: [] },
  ]);
  const d2 = renderOutcome(o2, ctx()).embeds[0].description!;
  assert.match(d2, /Yandex: bạn đã hết lượt Yandex hôm nay/);
  assert.match(d2, /trace\.moe: hết thời gian/);
});

test("not found message", () => {
  const o = finalize("ABC123", "auto", [
    { engine: "saucenao", status: "no_match", matches: [] }, { engine: "tracemoe", status: "ok", matches: [] },
  ]);
  assert.equal(o.state, "not_found");
  const p = renderOutcome(o, ctx({ showYandexButton: true }));
  const e = p.embeds[0];
  assert.equal(e.author?.name, "CHƯA XÁC ĐỊNH ĐƯỢC NGUỒN");
  assert.match(e.description!, /Đã tìm bằng SauceNAO, trace\.moe nhưng không có kết quả đủ tin cậy\./);
  assert.match(e.description!, /\*\*Tự tìm tiếp:\*\*/);
  assert.equal(buttons(p).length, 2);
});

test("progress message", () => {
  const e = renderProgress({ done: ["saucenao"], current: "tracemoe" }, 60).embeds[0];
  assert.equal(e.author?.name, "ĐANG TÌM…");
  assert.equal(e.description, "Đã xong: SauceNAO\nĐang hỏi: trace.moe");
  assert.equal(e.footer?.text, "Tối đa 60 giây");
});

test("notice, image errors, help, quota", () => {
  assert.equal(renderNotice("Bot đang bận, thử lại sau ít phút").embeds[0].description, "Bot đang bận, thử lại sau ít phút");
  const withLinks = renderNotice("x", buildDeepLinks("https://a/b.png")).embeds[0].description!;
  assert.match(withLinks, /\*\*Tự tìm tiếp:\*\*/);
  const cfg = { imageMaxBytes: 10 * 1024 * 1024, imageMaxPixels: 40_000_000 };
  assert.match(renderImageError("too_large", cfg, []).embeds[0].description!, /^Ảnh lớn hơn 10 MB/);
  assert.match(renderImageError("too_many_pixels", cfg, []).embeds[0].description!, /^Ảnh lớn hơn 40 triệu điểm ảnh/);
  assert.equal(renderImageError("decode_failed", cfg, []).embeds[0].description, "Không đọc được ảnh");
  assert.equal(renderImageError("fetch_failed", cfg, []).embeds[0].description, "Không tải được ảnh, hãy gửi lại ảnh");
  assert.equal(renderImageError("unsupported", cfg, []).embeds[0].description, "Định dạng ảnh chưa hỗ trợ");

  const help = renderHelp({ userDailySearches: 30, userDailyYandex: 5 }).embeds[0].description!;
  assert.match(help, /\/search/); assert.match(help, /Tìm nguồn ảnh/); assert.match(help, /30 lượt\/ngày/); assert.match(help, /5 lượt Yandex/);
  assert.match(help, /Ảnh bạn tìm sẽ được gửi tới trace\.moe, SauceNAO, Danbooru và Yandex \(qua Bright Data hoặc SerpApi\)\./);

  const q = renderQuota([
    { provider: "tracemoe", usedToday: 3, allowanceToday: null, usedPeriod: 3, periodLimit: 100, blocked: false },
    { provider: "brightdata", usedToday: 1, allowanceToday: null, usedPeriod: 9, periodLimit: 500, blocked: false },
    { provider: "saucenao", usedToday: 1, allowanceToday: null, usedPeriod: 1, periodLimit: null, remaining: 40, blocked: true },
    { provider: "danbooru", usedToday: 2, allowanceToday: null, usedPeriod: 2, periodLimit: null, blocked: false },
  ], { brightdata: { healthy: false } }).embeds[0].description!;
  const lines = q.split("\n");
  assert.equal(lines[0], "**trace.moe** · 24 giờ 3/100 · bình thường");
  assert.equal(lines[1], "**Bright Data** · hôm nay 1/– · tháng 9/500 · đang tạm chuyển sang SerpApi");
  assert.equal(lines[2], "**SauceNAO** · hôm nay 1 · còn 40 · hết lượt");
  assert.equal(lines[3], "**Danbooru** · hôm nay 2 · bình thường");
});

test("pick menu caps 25 and 100-char labels", () => {
  const cands: ImageCandidate[] = Array.from({ length: 30 }, (_, i) => ({
    kind: "attachment", url: "u" + i, label: "L".repeat(150), description: "D".repeat(150),
  }));
  const p = renderPickMenu("abc", cands);
  assert.match(p.content!, /Tin nhắn này có 30 ảnh\. Chọn ảnh cần tìm nguồn:/);
  type Sel = { custom_id: string; placeholder: string; options: { label: string; description: string; value: string }[] };
  const sel = (p.components as { components: Sel[] }[])[0].components[0];
  assert.equal(sel.custom_id, "p:abc");
  assert.equal(sel.placeholder, "Chọn ảnh cần tìm nguồn");
  assert.equal(sel.options.length, 25);
  assert.equal(sel.options[24].value, "24");
  assert.ok(sel.options.every(o => o.label.length <= 100 && o.description.length <= 100));
});

test("mode select", () => {
  type Sel = { custom_id: string; options: { label: string; value: string; default?: boolean }[] };
  const row = renderModeSelect("7F3K2A", "anime") as { components: Sel[] }[];
  const sel = row[0].components[0];
  assert.equal(row.length, 1);
  assert.equal(sel.custom_id, "ms:7F3K2A");
  assert.deepEqual(sel.options.map(o => o.label), ["Tự động", "Cảnh anime", "Art / tranh", "Phim người đóng"]);
  assert.deepEqual(sel.options.filter(o => o.default).map(o => o.value), ["anime"]);
});

test("custom ids round-trip and reject garbage", () => {
  for (const kind of ["mode", "modeSelect", "yandex", "pick"] as const) {
    assert.deepEqual(parseCustomId(customId({ kind, key: "7F3K2A" })), { kind, key: "7F3K2A" });
  }
  assert.equal(customId({ kind: "mode", key: "X" }), "m:X");
  assert.equal(customId({ kind: "modeSelect", key: "X" }), "ms:X");
  assert.equal(customId({ kind: "yandex", key: "X" }), "y:X");
  assert.equal(customId({ kind: "pick", key: "X" }), "p:X");
  for (const bad of ["", "m", "m:", "zz:abc", ":abc", "m:a b", "m:" + "a".repeat(200)]) assert.equal(parseCustomId(bad), null);
});

test("isNsfw: channel flag, thread inherits parent, null is safe", () => {
  assert.equal(isNsfw({ isThread: () => false, nsfw: true }), true);
  assert.equal(isNsfw({ isThread: () => false, nsfw: false }), false);
  assert.equal(isNsfw({ isThread: () => true, nsfw: false, parent: { nsfw: true } }), true);
  assert.equal(isNsfw({ isThread: () => true, parent: null }), false);
  assert.equal(isNsfw({}), false);
  assert.equal(isNsfw(null), false);
  assert.equal(isNsfw(undefined), false);
});
