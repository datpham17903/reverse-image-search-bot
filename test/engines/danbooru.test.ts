import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDanbooru, parseIqdbHtml } from "../../src/engines/danbooru.ts";
import type { EngineInput } from "../../src/engines/types.ts";

const iqdb = readFileSync(new URL("../fixtures/danbooru/iqdb.json", import.meta.url), "utf8");
const deps = { login: "bot", apiKey: "key", userId: "42" };

function input(): EngineInput {
  return {
    image: { url: "https://cdn.discordapp.com/a.png?x=1&y=2", sha256: "h", jpeg: async () => Buffer.from("jpeg") },
    mode: "auto", nsfwChannel: false, signal: new AbortController().signal,
  };
}
const respond = (body: string, status = 200, headers: Record<string, string> = {}) =>
  (async () => new Response(body, { status, headers })) as typeof fetch;
const make = (f: typeof fetch) => createDanbooru({ fetch: f, ...deps });

test("sends basic auth and the Danbooru user agent", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(iqdb); }) as unknown as typeof fetch;
  const engine = make(f);
  await engine.search(input(), "danbooru");
  assert.equal(engine.cacheParams({ mode: "auto", nsfwChannel: false }), "l5");
  assert.equal(engine.version, 1);
  assert.equal(calls[0]!.url, `https://danbooru.donmai.us/iqdb_queries.json?url=${encodeURIComponent("https://cdn.discordapp.com/a.png?x=1&y=2")}&limit=5`);
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h["Authorization"], `Basic ${Buffer.from("bot:key").toString("base64")}`);
  assert.equal(h["User-Agent"], "TimNguonBot/1.0 (user #42)");
});

test("maps posts with artist, source and rating", async () => {
  const r = await make(respond(iqdb)).search(input(), "danbooru");
  assert.equal(r.status, "ok");
  assert.equal(r.sent, true);
  const a = r.matches[0]!;
  assert.equal(a.engine, "danbooru");
  assert.equal(a.score, 96.5);
  assert.equal(a.title, "artist_one, artist_two");
  assert.equal(a.url, "https://www.pixiv.net/artworks/12345");
  assert.equal(a.detail, "Tác giả: artist_one, artist_two · www.pixiv.net");
  assert.equal(a.previewUrl, "https://cdn.donmai.us/preview/aa/bb/aabb.jpg");
  assert.equal(a.rating, "g");
  assert.equal(a.adult, false);
  assert.equal(r.matches[1]!.adult, true);
  assert.equal(r.matches[1]!.rating, "e");
});

test("falls back to the post URL when source is not http", async () => {
  const r = await make(respond(iqdb)).search(input(), "danbooru");
  const b = r.matches[1]!;
  assert.equal(b.url, "https://danbooru.donmai.us/posts/222");
  assert.equal(b.title, "Danbooru #222");
  assert.equal(b.detail, "danbooru.donmai.us");
});

test("empty → no_match; 429 → rate_limited; 403 → unavailable", async () => {
  assert.equal((await make(respond("[]")).search(input(), "danbooru")).status, "no_match");
  assert.equal((await make(respond("", 429)).search(input(), "danbooru")).status, "rate_limited");
  assert.equal((await make(respond("", 403)).search(input(), "danbooru")).status, "unavailable");
  assert.equal((await make(respond("", 401)).search(input(), "danbooru")).status, "unavailable");
  assert.equal((await make(respond("", 422)).search(input(), "danbooru")).status, "invalid_input");
});

test("x-rate-limit header with remaining 0 → rate_limited even on 200", async () => {
  const r = await make(respond(iqdb, 200, { "x-rate-limit": '{"remaining":0}' })).search(input(), "danbooru");
  assert.equal(r.status, "rate_limited");
  const ok = await make(respond(iqdb, 200, { "x-rate-limit": '{"remaining":3}' })).search(input(), "danbooru");
  assert.equal(ok.status, "ok");
  const bad = await make(respond(iqdb, 200, { "x-rate-limit": "garbage" })).search(input(), "danbooru");
  assert.equal(bad.status, "ok");
});

test("unexpected payload → unavailable without throwing", async () => {
  const r = await make(respond('{"nope":true}')).search(input(), "danbooru");
  assert.equal(r.status, "unavailable");
  assert.equal(r.parseFailed, true);
  const bad = await make(respond("<html>")).search(input(), "danbooru");
  assert.equal(bad.status, "unavailable");
  const net = await make((async () => { throw new TypeError("boom"); }) as typeof fetch).search(input(), "danbooru");
  assert.equal(net.status, "unavailable");
});

test("parseIqdbHtml extracts NSFW and safe matches from IQDB tables", () => {
  const html = `
    <html><head><title>Multi-service image search - iqdb.org</title></head><body>
    <table><tr><th>Best match</th></tr>
    <tr><td class="image"><a href="//gelbooru.com/index.php?page=post&id=999"><img src="/thu/thu_1.jpg"></a></td></tr>
    <tr><td>Gelbooru</td></tr>
    <tr><td>1920×1080 [Explicit]</td></tr>
    <tr><td>94% similarity</td></tr></table>
    </body></html>
  `;
  const matches = parseIqdbHtml(html);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]!.url, "https://gelbooru.com/index.php?page=post&id=999");
  assert.equal(matches[0]!.score, 94);
  assert.equal(matches[0]!.rating, "e");
  assert.equal(matches[0]!.adult, true);
  assert.equal(matches[0]!.previewUrl, "https://iqdb.org/thu/thu_1.jpg");
});
