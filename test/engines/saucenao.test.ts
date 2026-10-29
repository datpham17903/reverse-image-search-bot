import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createSauceNao, parseSauceNaoHtml, SAUCENAO_HIDE_NORMAL, SAUCENAO_MOVIES_SHOWS_DBMASK } from "../../src/engines/saucenao.ts";
import { ImageError } from "../../src/images/download.ts";
import type { EngineInput } from "../../src/engines/types.ts";

// Provisional fixture built from the documented API shape (no real Phase 0 capture).
const search = readFileSync(new URL("../fixtures/saucenao/search.json", import.meta.url), "utf8");

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    image: { url: "u", sha256: "h", jpeg: async () => Buffer.from("jpeg") },
    mode: "auto", nsfwChannel: false, signal: new AbortController().signal, ...over,
  };
}
const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
const mk = (f: typeof fetch) => createSauceNao({ fetch: f, apiKey: "KEY" });
function capture() {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(search); }) as unknown as typeof fetch;
  return { calls, f };
}

test("maps art and anime results", async () => {
  const { calls, f } = capture();
  const r = await mk(f).search(input(), "saucenao");
  assert.equal(r.status, "ok");
  assert.equal(r.sent, true);
  assert.equal(calls[0]!.init.method, "POST");
  const file = (calls[0]!.init.body as FormData).get("file") as File;
  assert.equal(file.name, "image.jpg");
  assert.equal(file.type, "image/jpeg");
  assert.equal(r.matches.length, 2);
  const [a, b] = r.matches;
  assert.equal(a!.engine, "saucenao");
  assert.equal(a!.title, "Blue Sky");
  assert.equal(a!.url, "https://www.pixiv.net/artworks/12345");
  assert.equal(a!.score, 93.12);
  assert.equal(a!.detail, "Tác giả: Artist A · www.pixiv.net");
  assert.equal(a!.isAnime, false);
  assert.equal(a!.adult, null);
  assert.equal(a!.hasEpisodeAndTime, false);
  assert.equal(a!.previewUrl, "https://img3.saucenao.com/pixiv.jpg");
  assert.equal(b!.title, "Some Show");
  assert.equal(b!.detail, "Tập 5 · 02:13");
  assert.equal(b!.isAnime, true);
  assert.equal(b!.hasEpisodeAndTime, true);
  assert.equal(b!.adult, null);
});

test("normal channel sends hide, NSFW channel does not", async () => {
  const n = capture();
  await mk(n.f).search(input(), "saucenao");
  const u = new URL(n.calls[0]!.url);
  assert.equal(u.origin + u.pathname, "https://saucenao.com/search.php");
  assert.equal(u.searchParams.get("output_type"), "2");
  assert.equal(u.searchParams.get("numres"), "8");
  assert.equal(u.searchParams.get("api_key"), "KEY");
  assert.equal(u.searchParams.get("db"), "999");
  assert.equal(u.searchParams.get("hide"), String(SAUCENAO_HIDE_NORMAL));
  const s = capture();
  await mk(s.f).search(input({ nsfwChannel: true }), "saucenao");
  assert.equal(new URL(s.calls[0]!.url).searchParams.has("hide"), false);
});

test("movie mode uses the Movies/Shows dbmask", async () => {
  const { calls, f } = capture();
  await mk(f).search(input({ mode: "movie" }), "saucenao");
  const u = new URL(calls[0]!.url);
  assert.equal(u.searchParams.get("dbmask"), String(SAUCENAO_MOVIES_SHOWS_DBMASK));
  assert.equal(u.searchParams.has("db"), false);
});

test("cacheParams", () => {
  const e = mk(respond(search));
  assert.equal(e.cacheParams({ mode: "movie", nsfwChannel: false }), "mv:h3");
  assert.equal(e.cacheParams({ mode: "auto", nsfwChannel: true }), "all:h0");
});

test("returns header quota", async () => {
  const r = await mk(respond(search)).search(input(), "saucenao");
  assert.deepEqual(r.quota, { shortRemaining: 5, longRemaining: 195 });
});

test("429 with long_remaining 0 → quota_exhausted; otherwise rate_limited", async () => {
  const exhausted = await mk(respond(JSON.stringify({ header: { status: -2, long_remaining: 0, short_remaining: 3 } }), 429)).search(input(), "saucenao");
  assert.equal(exhausted.status, "quota_exhausted");
  assert.deepEqual(exhausted.quota, { longRemaining: 0 });
  const daily = await mk(respond("Daily Search Limit Exceeded.", 429)).search(input(), "saucenao");
  assert.equal(daily.status, "quota_exhausted");
  assert.deepEqual(daily.quota, { longRemaining: 0 });
  const limited = await mk(respond(JSON.stringify({ header: { status: -1, long_remaining: 100, short_remaining: 0 } }), 429)).search(input(), "saucenao");
  assert.equal(limited.status, "rate_limited");
  assert.deepEqual(limited.quota, { shortRemaining: 0 });
  const plain = await mk(respond("slow down", 429)).search(input(), "saucenao");
  assert.equal(plain.status, "rate_limited");
  assert.deepEqual(plain.quota, { shortRemaining: 0 });
});

test("a malformed result item is dropped, not the whole response", async () => {
  const good = JSON.parse(search).results[0];
  const body = JSON.stringify({ header: { status: 0 }, results: [{ header: { similarity: 5 }, data: {} }, good] });
  const r = await mk(respond(body)).search(input(), "saucenao");
  assert.equal(r.status, "ok");
  assert.equal(r.matches.length, 1);
});

test("413 → invalid_input, header.status != 0 → unavailable, no results → no_match", async () => {
  assert.equal((await mk(respond("", 413)).search(input(), "saucenao")).status, "invalid_input");
  const bad = await mk(respond(JSON.stringify({ header: { status: -3 }, results: [] }))).search(input(), "saucenao");
  assert.equal(bad.status, "unavailable");
  const none = await mk(respond(JSON.stringify({ header: { status: 0 }, results: [] }))).search(input(), "saucenao");
  assert.equal(none.status, "no_match");
});

test("unexpected payload → unavailable without throwing", async () => {
  const r = await mk(respond('{"foo":1}')).search(input(), "saucenao");
  assert.equal(r.status, "unavailable");
  assert.equal(r.parseFailed, true);
});

test("hidden results dropped in normal channels, kept in NSFW", async () => {
  const n = await mk(respond(search)).search(input(), "saucenao");
  assert.equal(n.matches.some(m => m.title === "Hidden Show"), false);
  const s = await mk(respond(search)).search(input({ nsfwChannel: true }), "saucenao");
  const h = s.matches.find(m => m.title === "Hidden Show");
  assert.equal(h!.adult, true);
  assert.equal(h!.isAnime, true);
});

test("results without ext_urls are dropped; title falls back to index_name", async () => {
  const body = JSON.parse(search);
  body.results = [
    { header: body.results[0].header, data: { ext_urls: [] } },
    { header: body.results[0].header, data: { ext_urls: ["https://e.com/x"] } },
  ];
  const r = await mk(respond(JSON.stringify(body))).search(input(), "saucenao");
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0]!.title, body.results[0].header.index_name);
});

test("abort → timeout and sent", async () => {
  const f = (async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch;
  const r = await mk(f).search(input(), "saucenao");
  assert.equal(r.status, "timeout");
  assert.equal(r.sent, true);
});

test("connection refused → unavailable, not sent", async () => {
  const f = (async () => { throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
  const r = await mk(f).search(input(), "saucenao");
  assert.equal(r.status, "unavailable");
  assert.equal(r.sent, false);
});

test("ImageError from jpeg() → invalid_input, not sent", async () => {
  const bad = input({ image: { url: "u", sha256: "h", jpeg: async () => { throw new ImageError("decode_failed"); } } });
  const r = await mk(respond(search)).search(bad, "saucenao");
  assert.equal(r.status, "invalid_input");
  assert.equal(r.sent, false);
});

test("hideNormal: false finds NSFW results in normal channels and marks them adult: true", async () => {
  const { calls, f } = capture();
  const engine = createSauceNao({ fetch: f, apiKey: "KEY", hideNormal: false });
  const r = await engine.search(input({ nsfwChannel: false }), "saucenao");
  assert.equal(new URL(calls[0]!.url).searchParams.has("hide"), false);
  const hidden = r.matches.find(m => m.title === "Hidden Show");
  assert.ok(hidden);
  assert.equal(hidden.adult, true);
});

test("rotates across multiple API keys on 429 and falls back to web scrape", async () => {
  const usedKeys: (string | null)[] = [];
  const f = (async (url: string) => {
    const k = new URL(url).searchParams.get("api_key");
    usedKeys.push(k);
    if (k === "k1") return new Response("slow down", { status: 429 });
    return new Response(search);
  }) as unknown as typeof fetch;
  const engine = createSauceNao({ fetch: f, apiKeys: ["k1", "k2"], hideNormal: false });
  const r = await engine.search(input(), "saucenao");
  assert.equal(r.status, "ok");
  assert.deepEqual(usedKeys, ["k1", "k2"]);
});

test("extracts nhentai and hitomi gallery IDs from Index #18 H-Misc HTML and JSON without ext_urls", async () => {
  const html = `<table class="resulttable"><tr><td class="resulttableimage"><img id="resImage0" title="Index #18: H-Misc (nhentai) - 1t.jpg" raw-rating="3" src="https://img1.saucenao.com/rsz/res/nhentai/518891%20%282982943%29%20--%20%5BMisaki%5D%20Hatsukoi%2F1t.jpg" data-src2="https://img1.saucenao.com/res/nhentai/518891%20%282982943%29%20--%20%5BMisaki%5D%20Hatsukoi%2F1t.jpg"/></td><td class="resulttablecontent"><div class="resultmatchinfo"><div class="resultsimilarityinfo">92.60%</div></div><div class="resultcontent"><div class="resulttitle"><strong>Hatsukoi no Hito wa _ My First Love [English]</strong><br /><small>初恋</small></div><div class="resultcontentcolumn"><strong>Creator(s): </strong>akutenkou, misaki<br /></div></div></td></tr></table>`;
  const parsed = parseSauceNaoHtml(html);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.url, "https://nhentai.net/g/518891/");
  assert.equal(parsed[0]!.title, "Hatsukoi no Hito wa _ My First Love [English]");
  assert.equal(parsed[0]!.detail, "Mã #518891 · Hitomi #2982943 · Trang 1 · Tác giả: akutenkou, misaki · nhentai.net");
  assert.equal(parsed[0]!.adult, true);
  assert.equal(parsed[0]!.previewUrl, "https://img1.saucenao.com/res/nhentai/518891%20%282982943%29%20--%20%5BMisaki%5D%20Hatsukoi%2F1t.jpg");

  const jsonBody = JSON.stringify({
    header: { status: 0 },
    results: [{
      header: {
        similarity: "91.5",
        thumbnail: "https://img1.saucenao.com/res/nhentai/489451%20%282786159%29%20--%20Test/2t.jpg",
        index_id: 18,
        index_name: "Index #18: H-Misc (nhentai) - 2t.jpg",
      },
      data: {
        eng_name: "[Fetio] Inkya Joshi [English]",
        creator: ["fetio"],
      },
    }],
  });
  const r = await createSauceNao({ fetch: respond(jsonBody), apiKey: "KEY", hideNormal: false }).search(input(), "saucenao");
  assert.equal(r.status, "ok");
  assert.equal(r.matches[0]!.url, "https://nhentai.net/g/489451/");
  assert.equal(r.matches[0]!.detail, "Mã #489451 · Hitomi #2786159 · Trang 2 · Tác giả: fetio · nhentai.net");
  assert.equal(r.matches[0]!.adult, true);
});
