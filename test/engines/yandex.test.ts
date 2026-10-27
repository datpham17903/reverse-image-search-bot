import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { YandexParseError, parseYandexSites } from "../../src/engines/yandex/parse-html.ts";
import { yandexPageUrl, yandexViaBrightData } from "../../src/engines/yandex/brightdata.ts";
import { createYandex } from "../../src/engines/yandex/index.ts";

const fx = (n: string) => readFileSync(new URL(`../fixtures/yandex/${n}`, import.meta.url), "utf8");
const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
const run = (f: typeof fetch) => yandexViaBrightData("https://cdn.discordapp.com/a.png?x=1&y=2", { fetch: f, apiKey: "KEY", zone: "z1", signal: new AbortController().signal });

// Enable after Phase 0 provides test/fixtures/yandex/brightdata-sites.html
test.skip("parses sites from the real Bright Data fixture", () => {
  const sites = parseYandexSites(fx("brightdata-sites.html"));
  assert.ok(sites.length >= 1);
  for (const s of sites) { assert.ok(s.title); assert.match(s.url, /^https?:\/\//); assert.ok(s.domain); }
});

test("parses sites from the synthetic (provisional) fixture", () => {
  assert.deepEqual(parseYandexSites(fx("brightdata-sites-synthetic.html")), [
    { title: "Fanart & more", url: "https://www.example.com/post/1", domain: "www.example.com", thumbnailUrl: "https://avatars.mds.yandex.net/i?id=1" },
    { title: "Second", url: "https://example.org/p/2", domain: "example.org" },
  ]);
});

test("falls back to DOM links when no data-state sites", () => {
  assert.deepEqual(parseYandexSites(fx("brightdata-sites-dom-synthetic.html")),
    [{ title: "Dom item", url: "https://example.net/a?x=1&y=2", domain: "example.net" }]);
});

test("recognized page without sites → []", () => {
  assert.deepEqual(parseYandexSites(fx("brightdata-sites-empty-synthetic.html")), []);
});

test("captcha page → YandexParseError", () => {
  assert.throws(() => parseYandexSites(fx("captcha.html")), YandexParseError);
});

test("unrecognized html → YandexParseError", () => {
  assert.throws(() => parseYandexSites("<html><body>hello</body></html>"), YandexParseError);
});

test("yandexPageUrl encodes the image url", () => {
  assert.equal(yandexPageUrl("https://a/b?x=1&y=2"),
    `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url=${encodeURIComponent("https://a/b?x=1&y=2")}`);
});

test("brightdata sends the request and maps sites", async () => {
  let call: { url: string; init: RequestInit } | undefined;
  const f = (async (url: string, init: RequestInit) => { call = { url, init }; return new Response(fx("brightdata-sites-synthetic.html")); }) as unknown as typeof fetch;
  const res = await run(f);
  assert.equal(call!.url, "https://api.brightdata.com/request");
  assert.equal(call!.init.method, "POST");
  assert.equal((call!.init.headers as Record<string, string>).Authorization, "Bearer KEY");
  assert.deepEqual(JSON.parse(call!.init.body as string),
    { zone: "z1", url: yandexPageUrl("https://cdn.discordapp.com/a.png?x=1&y=2"), format: "raw" });
  assert.equal(res.status, "ok");
  assert.equal(res.sent, true);
  assert.equal(res.matches[0]!.engine, "yandex");
  assert.equal(res.matches.length, 2);
});

test("brightdata empty sites → no_match", async () => {
  assert.equal((await run(respond(fx("brightdata-sites-empty-synthetic.html")))).status, "no_match");
});

test("brightdata parse failure → unavailable with parseFailed", async () => {
  for (const body of [fx("captcha.html"), "<html>x</html>"]) {
    const res = await run(respond(body));
    assert.equal(res.status, "unavailable");
    assert.equal(res.parseFailed, true);
    assert.equal(res.sent, true);
  }
});

test("brightdata status mapping", async () => {
  assert.equal((await run(respond("", 401))).status, "unavailable");
  assert.equal((await run(respond("", 403))).status, "unavailable");
  assert.equal((await run(respond("", 402))).status, "quota_exhausted");
  assert.equal((await run(respond("", 429))).status, "rate_limited");
  assert.equal((await run(respond("", 500))).status, "unavailable");
});

test("brightdata network failure never throws", async () => {
  const f = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  assert.equal((await run(f)).status, "unavailable");
});

test("engine routes each provider to its path", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return new Response(u.includes("brightdata") ? fx("brightdata-sites-synthetic.html") : fx("serpapi.json")); }) as unknown as typeof fetch;
  const e = createYandex({ fetch: f, brightdataApiKey: "B", brightdataZone: "z", serpapiApiKey: "S" });
  assert.deepEqual(e.providers, ["brightdata", "serpapi"]);
  assert.equal(e.version, 1);
  assert.equal(e.cacheParams({ mode: "auto", nsfwChannel: false }), "sites");
  const input = { image: { url: "https://x/y.png", sha256: "h", jpeg: async () => Buffer.alloc(0) }, mode: "auto" as const, nsfwChannel: false, signal: new AbortController().signal };
  assert.equal((await e.search(input, "brightdata")).status, "ok");
  assert.equal((await e.search(input, "serpapi")).status, "ok");
  assert.ok(urls[0]!.startsWith("https://api.brightdata.com/request"));
  assert.ok(urls[1]!.startsWith("https://serpapi.com/search.json"));
});
