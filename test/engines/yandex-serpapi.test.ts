import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getSerpApiAccount, sitesToMatches, yandexViaSerpApi } from "../../src/engines/yandex/serpapi.ts";

const fx = (n: string) => readFileSync(new URL(`../fixtures/yandex/${n}`, import.meta.url), "utf8");
const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;
const run = (f: typeof fetch) => yandexViaSerpApi("https://cdn.discordapp.com/a.png?x=1&y=2", { fetch: f, apiKey: "KEY", signal: new AbortController().signal });

test("sends the request and maps results to matches", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return new Response(fx("serpapi.json")); }) as unknown as typeof fetch;
  const res = await run(f);
  assert.equal(urls[0], `https://serpapi.com/search.json?engine=yandex_images&url=${encodeURIComponent("https://cdn.discordapp.com/a.png?x=1&y=2")}&api_key=KEY`);
  assert.equal(res.status, "ok");
  assert.equal(res.sent, true);
  assert.deepEqual(res.matches[0], {
    engine: "yandex", title: "Example artwork", url: "https://www.example.com/post/1", domain: "www.example.com",
    previewUrl: "https://serpapi.com/thumb/1.jpg", adult: null,
  });
  assert.equal(res.matches[1]!.previewUrl, undefined);
});

test("sitesToMatches maps fields", () => {
  assert.deepEqual(sitesToMatches([{ title: "t", url: "https://a.b/c", domain: "a.b", thumbnailUrl: "https://t/x" }]),
    [{ engine: "yandex", title: "t", url: "https://a.b/c", domain: "a.b", previewUrl: "https://t/x", adult: null }]);
});

test("no results error is no_match", async () => {
  const res = await run(respond(fx("serpapi-no-results.json")));
  assert.equal(res.status, "no_match");
  assert.equal(res.sent, true);
});

test("429 out of searches is quota_exhausted, other 429 is rate_limited", async () => {
  assert.equal((await run(respond('{"error":"Your account has run out of searches."}', 429))).status, "quota_exhausted");
  assert.equal((await run(respond('{"error":"Too many requests"}', 429))).status, "rate_limited");
});

test("401 is unavailable", async () => {
  assert.equal((await run(respond('{"error":"Invalid API key"}', 401))).status, "unavailable");
});

test("unexpected payload is unavailable with parseFailed", async () => {
  const res = await run(respond('{"foo":1}'));
  assert.equal(res.status, "unavailable");
  assert.equal(res.parseFailed, true);
});

test("network failure never throws", async () => {
  const f = (async () => { throw new Error("boom"); }) as unknown as typeof fetch;
  assert.equal((await run(f)).status, "unavailable");
});

test("account reads searches left and usage", async () => {
  const urls: string[] = [];
  const f = (async (u: string) => { urls.push(u); return new Response(fx("serpapi-account.json")); }) as unknown as typeof fetch;
  assert.deepEqual(await getSerpApiAccount({ fetch: f, apiKey: "KEY" }), { totalSearchesLeft: 87, thisMonthUsage: 13 });
  assert.equal(urls[0], "https://serpapi.com/account.json?api_key=KEY");
});
