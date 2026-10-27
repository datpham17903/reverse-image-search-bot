import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTraceMoe } from "../../src/engines/tracemoe.ts";
import { ImageError } from "../../src/images/download.ts";
import type { EngineInput } from "../../src/engines/types.ts";

const fixture = (n: string) => readFileSync(new URL(`../fixtures/tracemoe/${n}`, import.meta.url), "utf8");
const search = fixture("search.json");

function input(over: Partial<EngineInput> = {}): EngineInput {
  return {
    image: { url: "u", sha256: "h", jpeg: async () => Buffer.from("jpeg") },
    mode: "auto", nsfwChannel: false, signal: new AbortController().signal, ...over,
  };
}
const respond = (body: string, status = 200) => (async () => new Response(body, { status })) as typeof fetch;

test("maps results from the fixture", async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(search); }) as unknown as typeof fetch;
  const r = await createTraceMoe({ fetch: f }).search(input(), "tracemoe");
  assert.equal(r.status, "ok");
  assert.equal(r.sent, true);
  assert.equal(calls[0]!.url, "https://api.trace.moe/search?anilistInfo&cutBorders=1");
  assert.equal(calls[0]!.init.method, "POST");
  assert.deepEqual((calls[0]!.init.headers as Record<string, string>)["content-type"], "image/jpeg");
  const [a, b] = r.matches;
  assert.equal(a!.title, "Nekopara OVA");
  assert.equal(a!.url, "https://anilist.co/anime/99939");
  assert.equal(a!.detail, "1:37");
  assert.equal(a!.hasEpisodeAndTime, false);
  assert.equal(b!.title, "ONE PIECE / One Piece");
  assert.equal(b!.detail, "Tập 100 · 12:34");
  assert.equal(b!.score, 0.87);
  assert.equal(b!.previewUrl, "https://api.trace.moe/image/21/image.jpg?t=2");
  assert.equal(b!.videoUrl, "https://api.trace.moe/video/21/video.mp4?t=2");
  assert.equal(b!.adult, false);
  assert.equal(b!.isAnime, true);
  assert.equal(b!.hasEpisodeAndTime, true);
  assert.equal(b!.engine, "tracemoe");
});

test("empty result → no_match", async () => {
  const r = await createTraceMoe({ fetch: respond('{"frameCount":1,"error":"","result":[]}') }).search(input(), "tracemoe");
  assert.equal(r.status, "no_match");
  assert.deepEqual(r.matches, []);
});

test("402 → quota_exhausted, 429 → rate_limited, 400 → invalid_input", async () => {
  for (const [code, status] of [[402, "quota_exhausted"], [429, "rate_limited"], [400, "invalid_input"], [500, "unavailable"]] as const) {
    const r = await createTraceMoe({ fetch: respond('{"error":"x"}', code) }).search(input(), "tracemoe");
    assert.equal(r.status, status);
  }
});

test("unexpected payload → unavailable without throwing", async () => {
  const r = await createTraceMoe({ fetch: respond('{"foo":1}') }).search(input(), "tracemoe");
  assert.equal(r.status, "unavailable");
  assert.equal(r.parseFailed, true);
});

test("abort → timeout and sent", async () => {
  const f = (async () => { throw new DOMException("aborted", "AbortError"); }) as unknown as typeof fetch;
  const r = await createTraceMoe({ fetch: f }).search(input(), "tracemoe");
  assert.equal(r.status, "timeout");
  assert.equal(r.sent, true);
});

test("connection refused twice → unavailable, not sent, fetch called twice", async () => {
  let n = 0;
  const f = (async () => { n++; throw new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } }); }) as unknown as typeof fetch;
  const r = await createTraceMoe({ fetch: f }).search(input(), "tracemoe");
  assert.equal(r.status, "unavailable");
  assert.equal(r.sent, false);
  assert.equal(n, 2);
});

test("ImageError from jpeg() → invalid_input, not sent", async () => {
  const bad = input({ image: { url: "u", sha256: "h", jpeg: async () => { throw new ImageError("decode_failed"); } } });
  const r = await createTraceMoe({ fetch: respond(search) }).search(bad, "tracemoe");
  assert.equal(r.status, "invalid_input");
  assert.equal(r.sent, false);
});

test("episode as array and null", async () => {
  const body = JSON.parse(search);
  body.result = [{ ...body.result[1], episode: [3, 4] }, { ...body.result[1], episode: "SP" }, body.result[0]];
  const r = await createTraceMoe({ fetch: respond(JSON.stringify(body)) }).search(input(), "tracemoe");
  assert.equal(r.matches[0]!.detail, "Tập 3–4 · 12:34");
  assert.equal(r.matches[1]!.detail, "Tập SP · 12:34");
  assert.equal(r.matches[2]!.detail, "1:37");
  assert.equal(r.matches[2]!.hasEpisodeAndTime, false);
});

test("takes at most 5 matches", async () => {
  const body = JSON.parse(search);
  body.result = Array.from({ length: 8 }, () => body.result[1]);
  const r = await createTraceMoe({ fetch: respond(JSON.stringify(body)) }).search(input(), "tracemoe");
  assert.equal(r.matches.length, 5);
});

test("getMe parses quota and quotaUsed", async () => {
  let url = "";
  const f = (async (u: string) => { url = u; return new Response(fixture("me.json")); }) as unknown as typeof fetch;
  const me = await createTraceMoe({ fetch: f }).getMe();
  assert.deepEqual(me, { quota: 100, quotaUsed: 7 });
  assert.equal(url, "https://api.trace.moe/me");
});

test("AbortSignal.timeout rejection (TimeoutError) → timeout and sent", async () => {
  const f = ((_u: string, init: RequestInit) => new Promise((_res, rej) => {
    init.signal!.addEventListener("abort", () => rej(init.signal!.reason));
  })) as unknown as typeof fetch;
  const r = await createTraceMoe({ fetch: f }).search(input({ signal: AbortSignal.timeout(1) }), "tracemoe");
  assert.equal(r.status, "timeout");
  assert.equal(r.sent, true);
});
