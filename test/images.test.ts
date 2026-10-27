import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { extractCandidates, type AttachmentLike } from "../src/images/candidates.ts";
import { downloadImage, ImageError } from "../src/images/download.ts";
import { normalizeImage } from "../src/images/normalize.ts";
import { loadImage } from "../src/images/load.ts";
import { openDb } from "../src/store/db.ts";
import { ResultCache } from "../src/store/cache.ts";
import { fakeClock, testConfig } from "./helpers.ts";

const U = "https://cdn.discordapp.com/a/x.png";

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

test("candidates: thumbnail, contentType image, no dimensions", () => {
  const c = extractCandidates({
    attachments: [{ id: "1", url: "https://cdn.discordapp.com/a/f", name: "f", contentType: "image/png", width: null, height: null }],
    embeds: [{ url: "https://example.com/p", image: null, thumbnail: { proxyURL: "https://media.discordapp.net/t.png" } }],
  });
  assert.equal(c[0].description, "f");
  assert.equal(c[1].kind, "embed_thumbnail");
  assert.equal(c[1].label, "Ảnh 2");
});

test("candidates capped at 25 and descriptions at 100 chars", () => {
  const attachments: AttachmentLike[] = Array.from({ length: 30 }, (_, i) => ({
    id: String(i), url: `https://cdn.discordapp.com/a/${i}.png`, name: "n".repeat(150) + ".png", contentType: "image/png", width: 1, height: 1,
  }));
  const c = extractCandidates({ attachments, embeds: [] });
  assert.equal(c.length, 25);
  assert.equal(c[0].description.length, 100);
});

test("download rejects non-Discord hosts without fetching", async () => {
  let called = false;
  await assert.rejects(downloadImage("https://169.254.169.254/x", { maxBytes: 10, timeoutMs: 1000, fetch: async () => { called = true; return new Response(""); } }),
    (e: unknown) => e instanceof ImageError && e.code === "not_allowed");
  assert.equal(called, false);
});

test("download stops past maxBytes", async () => {
  await assert.rejects(downloadImage(U, { maxBytes: 10, timeoutMs: 1000, fetch: async () => new Response(new Uint8Array(20)) }),
    (e: unknown) => e instanceof ImageError && e.code === "too_large");
});

test("download rejects by content-length before reading", async () => {
  await assert.rejects(downloadImage(U, { maxBytes: 10, timeoutMs: 1000, fetch: async () => new Response(new Uint8Array(5), { headers: { "content-length": "999" } }) }),
    (e: unknown) => e instanceof ImageError && e.code === "too_large");
});

test("download treats redirects as failure", async () => {
  let init: RequestInit | undefined;
  await assert.rejects(downloadImage(U, { maxBytes: 10, timeoutMs: 1000, fetch: async (_u, i) => { init = i; return new Response(null, { status: 302, headers: { location: "http://evil" } }); } }),
    (e: unknown) => e instanceof ImageError && e.code === "fetch_failed");
  assert.equal(init?.redirect, "manual");
});

test("download maps non-2xx, network errors and timeouts to fetch_failed", async () => {
  const bad = (f: typeof fetch) => downloadImage(U, { maxBytes: 10, timeoutMs: 20, fetch: f });
  const isFail = (e: unknown) => e instanceof ImageError && e.code === "fetch_failed";
  await assert.rejects(bad(async () => new Response("", { status: 404 })), isFail);
  await assert.rejects(bad(async () => { throw new Error("boom"); }), isFail);
  await assert.rejects(bad((_u, i) => new Promise((_r, rej) => i?.signal?.addEventListener("abort", () => rej(new Error("aborted"))))), isFail);
});

test("download returns the body", async () => {
  const b = await downloadImage(U, { maxBytes: 10, timeoutMs: 1000, fetch: async () => new Response(new Uint8Array([1, 2, 3])) });
  assert.deepEqual([...b], [1, 2, 3]);
});

test("normalize: JPEG <= 2048 px, sha256 of original", async () => {
  const png = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: "#08f" } }).png().toBuffer();
  const n = await normalizeImage(png, 20_000_000);
  assert.equal(n.width, 2048); assert.equal(n.height, 683);
  assert.equal((await sharp(n.jpeg).metadata()).format, "jpeg");
  assert.equal(n.sha256, createHash("sha256").update(png).digest("hex"));
});

test("normalize accepts webp, gif and avif", async () => {
  const base = () => sharp({ create: { width: 64, height: 64, channels: 3, background: "#f80" } });
  for (const buf of [await base().webp().toBuffer(), await base().gif().toBuffer(), await base().avif().toBuffer()]) {
    const n = await normalizeImage(buf, 20_000_000);
    assert.equal(n.width, 64);
  }
});

test("normalize: pixel limit -> too_many_pixels", async () => {
  const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#000" } }).png().toBuffer();
  await assert.rejects(normalizeImage(png, 5000), (e: unknown) => e instanceof ImageError && e.code === "too_many_pixels");
});

test("normalize: garbage -> decode_failed", async () => {
  await assert.rejects(normalizeImage(Buffer.from("not an image at all"), 20_000_000),
    (e: unknown) => e instanceof ImageError && e.code === "decode_failed");
});

test("normalize: unsupported format -> unsupported", async () => {
  const tiff = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000" } }).tiff().toBuffer();
  await assert.rejects(normalizeImage(tiff, 20_000_000), (e: unknown) => e instanceof ImageError && e.code === "unsupported");
});

test("normalize applies EXIF orientation", async () => {
  const jpg = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#0f0" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const n = await normalizeImage(jpg, 20_000_000);
  assert.equal(n.width, 100); assert.equal(n.height, 200);
});

async function pngBuf(): Promise<Buffer> {
  return sharp({ create: { width: 32, height: 32, channels: 3, background: "#123" } }).png().toBuffer();
}

test("loadImage reuses a known attachment hash without downloading", async () => {
  const clk = fakeClock(1000);
  const cache = new ResultCache(openDb(":memory:"), clk.now);
  cache.putAttachmentHash("att1", "abc123", 60_000);
  const png = await pngBuf();
  let calls = 0;
  const f: typeof fetch = async () => { calls++; return new Response(new Uint8Array(png)); };
  const img = await loadImage({ url: U, attachmentId: "att1" }, { cache, config: testConfig(), now: clk.now, fetch: f });
  assert.equal(img.sha256, "abc123");
  assert.equal(calls, 0);
  assert.equal(img.bytesInMemory(), 0);
  const j = await img.jpeg();
  assert.equal(calls, 1);
  assert.equal(img.bytesInMemory(), j.length);
  await img.jpeg();
  assert.equal(calls, 1);
});

test("loadImage downloads, normalizes and stores attachment hash", async () => {
  const clk = fakeClock(1000);
  const cache = new ResultCache(openDb(":memory:"), clk.now);
  const png = await pngBuf();
  const f: typeof fetch = async () => new Response(new Uint8Array(png));
  const img = await loadImage({ url: U, attachmentId: "att2" }, { cache, config: testConfig(), now: clk.now, fetch: f });
  const sha = createHash("sha256").update(png).digest("hex");
  assert.equal(img.sha256, sha);
  assert.equal(cache.getAttachmentHash("att2"), sha);
  assert.ok(img.bytesInMemory() > 0);
});

test("candidates: all embed images come before all embed thumbnails", () => {
  const e = (n: number) => ({ url: `https://h${n}.example/p`, image: { proxyURL: `https://media.discordapp.net/i${n}.png` }, thumbnail: { proxyURL: `https://media.discordapp.net/t${n}.png` } });
  const c = extractCandidates({ attachments: [], embeds: [e(1), e(2)] });
  assert.deepEqual(c.map(x => x.url.split("/").pop()), ["i1.png", "i2.png", "t1.png", "t2.png"]);
});

test("loadImage download timeout is 10 s", async () => {
  const delays: unknown[] = [];
  const orig = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { delays.push(ms); return orig(fn, ms); }) as typeof setTimeout;
  try {
    const cache = new ResultCache(openDb(":memory:"), fakeClock(0).now);
    const png = await pngBuf();
    await loadImage({ url: U }, { cache, config: testConfig({ engineTimeoutMs: 1234 }), now: () => 0, fetch: async () => new Response(new Uint8Array(png)) });
  } finally {
    globalThis.setTimeout = orig;
  }
  assert.ok(delays.includes(10_000));
  assert.ok(!delays.includes(1234));
});

test("lazy loadImage retries after a failed jpeg()", async () => {
  const clk = fakeClock(1000);
  const cache = new ResultCache(openDb(":memory:"), clk.now);
  cache.putAttachmentHash("att3", "h", 60_000);
  const png = await pngBuf();
  let calls = 0;
  const f: typeof fetch = async () => { calls++; return calls === 1 ? new Response("", { status: 500 }) : new Response(new Uint8Array(png)); };
  const img = await loadImage({ url: U, attachmentId: "att3" }, { cache, config: testConfig(), now: clk.now, fetch: f });
  await assert.rejects(img.jpeg(), (e: unknown) => e instanceof ImageError && e.code === "fetch_failed");
  assert.ok((await img.jpeg()).length > 0);
  assert.equal(calls, 2);
});

test("image decoding runs at most 2 at a time", async () => {
  const png = await sharp({ create: { width: 3000, height: 3000, channels: 3, background: "#123456" } }).png().toBuffer();
  const cache = new ResultCache(openDb(":memory:"), fakeClock(0).now);
  const config = testConfig();
  const orig = sharp.prototype.jpeg;
  let inFlight = 0;
  let peak = 0;
  sharp.prototype.jpeg = function (this: InstanceType<typeof sharp>, ...a: unknown[]) {
    const p = orig.apply(this, a as never) as InstanceType<typeof sharp>;
    const toBuffer = p.toBuffer.bind(p) as (...x: unknown[]) => Promise<unknown>;
    (p as unknown as { toBuffer: unknown }).toBuffer = async (...x: unknown[]) => {
      inFlight++; peak = Math.max(peak, inFlight);
      try { return await toBuffer(...x); } finally { inFlight--; }
    };
    return p;
  } as never;
  try {
    await Promise.all(Array.from({ length: 4 }, (_, i) =>
      loadImage({ url: `https://cdn.discordapp.com/a/${i}.png` }, { cache, config, now: () => 0, fetch: async () => new Response(new Uint8Array(png)) })));
  } finally { sharp.prototype.jpeg = orig; }
  assert.ok(peak >= 1 && peak <= 2, `peak ${peak}`);
});
