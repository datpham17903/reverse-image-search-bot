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

test("CbirSites text without recognizable structure → YandexParseError", () => {
  assert.throws(() => parseYandexSites('<html><body><div class="CbirSites-Foo">x</div></body></html>'), YandexParseError);
});

test("sites with blank title or empty domain are skipped", () => {
  const state = JSON.stringify({ sites: [
    { title: "  ", url: "https://a.com/1" }, { title: "ok", url: "https://a.com/2" }, { title: "nohost", url: "https://" },
  ] }).replace(/"/g, "&quot;");
  assert.deepEqual(parseYandexSites(`<div class="CbirSites" data-state="${state}"></div>`),
    [{ title: "ok", url: "https://a.com/2", domain: "a.com" }]);
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
  const cases: [number, string][] = [[401, "unavailable"], [403, "unavailable"], [402, "quota_exhausted"], [429, "rate_limited"], [500, "unavailable"]];
  for (const [code, status] of cases) {
    const res = await run(respond("", code));
    assert.equal(res.status, status);
    assert.equal(res.sent, true);
  }
});

test("brightdata network failure never throws", async () => {
  const f = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  assert.equal((await run(f)).status, "unavailable");
});

test("brightdata connection failure before send → sent false", async () => {
  const f = (async () => { throw Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
  const res = await run(f);
  assert.equal(res.status, "unavailable");
  assert.equal(res.sent, false);
});

test("brightdata abort → timeout", async () => {
  const f = (async () => { throw Object.assign(new Error("a"), { name: "AbortError" }); }) as unknown as typeof fetch;
  const res = await run(f);
  assert.equal(res.status, "timeout");
  assert.equal(res.sent, true);
});

test("engine routes each provider to its path", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return new Response(u.includes("brightdata") || u.includes("yandex.com") ? fx("brightdata-sites-synthetic.html") : fx("serpapi.json")); }) as unknown as typeof fetch;
  const e = createYandex({ fetch: f, brightdataApiKey: "B", brightdataZone: "z", serpapiApiKey: "S" });
  assert.deepEqual(e.providers, ["brightdata", "serpapi"]);
  assert.equal(e.version, 1);
  assert.equal(e.cacheParams({ mode: "auto", nsfwChannel: false }), "sites");
  const input = { image: { url: "https://x/y.png", sha256: "h", jpeg: async () => Buffer.alloc(0) }, mode: "auto" as const, nsfwChannel: false, signal: new AbortController().signal };
  assert.equal((await e.search(input, "brightdata")).status, "ok");
  assert.equal((await e.search(input, "serpapi")).status, "ok");
  assert.equal((await e.search(input, "yandex_direct")).status, "ok");
  assert.ok(urls[0]!.startsWith("https://api.brightdata.com/request"));
  assert.ok(urls[1]!.startsWith("https://serpapi.com/search.json"));
  assert.ok(urls[2]!.startsWith("https://yandex.com/images/search?rpt=imageview&cbir_page=sites&family=no&url="));
});

test("parses sites from initialState.cbirSites (live Yandex format)", () => {
  const state = JSON.stringify({
    initialState: {
      cbirSites: {
        sites: [
          { title: "Live Match", url: "https://pixiv.net/artworks/99", thumb: { url: "//avatars.mds.yandex.net/i?id=99" } },
        ],
      },
    },
  }).replace(/"/g, "&quot;");
  assert.deepEqual(parseYandexSites(`<div class="Root" data-state="${state}">cbirSites</div>`), [
    { title: "Live Match", url: "https://pixiv.net/artworks/99", domain: "pixiv.net", thumbnailUrl: "https://avatars.mds.yandex.net/i?id=99" },
  ]);
});
