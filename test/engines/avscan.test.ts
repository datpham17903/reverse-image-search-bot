import { test } from "node:test";
import assert from "node:assert/strict";
import { createAvScan, parseAvScanTimestamp } from "../../src/engines/avscan.ts";
import type { EngineInput } from "../../src/engines/types.ts";

function input(): EngineInput {
  return {
    image: { url: "https://cdn.discordapp.com/a.png", sha256: "h", jpeg: async () => Buffer.from("jpeg") },
    mode: "auto",
    nsfwChannel: false,
    signal: new AbortController().signal,
  };
}

test("parseAvScanTimestamp extracts time and cover labels", () => {
  assert.equal(parseAvScanTimestamp("SONE-123_01-23-45.jpg"), "01:23:45");
  assert.equal(parseAvScanTimestamp("SONE-123_cover_full.jpg"), "Ảnh bìa");
  assert.equal(parseAvScanTimestamp(null), undefined);
});

test("createAvScan maps JAV search results with adult: true and timestamps", async () => {
  const payload = JSON.stringify({
    results: [
      {
        video_code: "SONE-123",
        best_similarity: 94.2,
        frames: [
          {
            image_name: "SONE-123_01-23-45.jpg",
            similarity: 94.2,
            thumb: "/thumb/abc/SONE-123/SONE-123_01-23-45.webp",
          },
        ],
      },
    ],
  });
  const engine = createAvScan({
    fetch: (async () => new Response(payload, { status: 200 })) as unknown as typeof fetch,
  });
  const res = await engine.search(input(), "avscan");
  assert.equal(res.status, "ok");
  assert.equal(res.matches.length, 1);
  const m = res.matches[0]!;
  assert.equal(m.engine, "avscan");
  assert.equal(m.title, "SONE-123");
  assert.equal(m.score, 94.2);
  assert.equal(m.detail, "Thời điểm 01:23:45 · avscan.cc");
  assert.equal(m.url, "https://avscan.cc/go/m/vi/sone-123?s=r");
  assert.equal(m.previewUrl, "https://avscan.cc/thumb/abc/SONE-123/SONE-123_01-23-45.webp");
  assert.equal(m.adult, true);
});

