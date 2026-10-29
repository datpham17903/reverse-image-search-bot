import { z } from "zod";
import { ImageError } from "../images/download.ts";
import { PreSendError, isAbortError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match } from "./types.ts";

const SEARCH_URL = "https://avscan.cc/search";
const BASE_URL = "https://avscan.cc";
const COVER_STEM_RE = /^(.+)_cover_(?:full|left|right)$/i;

const frameSchema = z.object({
  image_name: z.string().nullish(),
  similarity: z.number().nullish(),
  thumb: z.string().nullish(),
});

const videoSchema = z.object({
  video_code: z.string(),
  best_similarity: z.number(),
  frames: z.array(frameSchema).nullish(),
});

const bodySchema = z.object({
  results: z.array(videoSchema).nullish(),
});

function frameStem(name: string): string {
  return (name.split("/").pop() ?? "").replace(/\.[^.]+$/, "");
}

// Parses frame filenames from avscan.cc (e.g., "SONE-247_01-23-45.jpg" or "SONE-247_cover_full.jpg")
// into a human-readable Vietnamese timestamp or cover label.
export function parseAvScanTimestamp(name: string | null | undefined): string | undefined {
  if (!name) return undefined;
  const base = frameStem(name);
  if (COVER_STEM_RE.test(base)) return "Ảnh bìa";
  const idx = base.lastIndexOf("_");
  if (idx === -1) return undefined;
  const ts = base.slice(idx + 1).replace(/-/g, ":");
  return ts || undefined;
}

function buildThumbUrl(code: string, frame?: z.infer<typeof frameSchema>): string | undefined {
  if (frame?.thumb) {
    return frame.thumb.startsWith("http") ? frame.thumb : `${BASE_URL}${frame.thumb}`;
  }
  if (!frame?.image_name) return undefined;
  const base = frameStem(frame.image_name);
  const cover = COVER_STEM_RE.exec(base);
  if (cover?.[1]) return `${BASE_URL}/thumb/covers/${encodeURIComponent(cover[1])}.webp`;
  return `${BASE_URL}/thumb/${encodeURIComponent(code)}/${encodeURIComponent(base)}.webp`;
}

function toMatch(v: z.infer<typeof videoSchema>): Match | null {
  const code = v.video_code.trim();
  if (!code) return null;
  const frame = v.frames?.[0];
  const ts = parseAvScanTimestamp(frame?.image_name);
  const detail = [ts ? (ts === "Ảnh bìa" ? ts : `Thời điểm ${ts}`) : undefined, "avscan.cc"].filter(Boolean).join(" · ");
  const previewUrl = buildThumbUrl(code, frame);
  const lower = encodeURIComponent(code.toLowerCase());
  const url = `${BASE_URL}/go/m/vi/${lower}?s=r`;
  const videoUrl = `${BASE_URL}/go/m/vi/${lower}?s=rp`;
  return {
    engine: "avscan",
    title: code,
    url,
    detail,
    score: v.best_similarity,
    ...(previewUrl ? { previewUrl } : {}),
    videoUrl,
    adult: true,
  };
}

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

export function createAvScan(deps: { fetch: typeof fetch }): Engine {
  return {
    id: "avscan",
    providers: ["avscan"],
    version: 1,
    cacheParams: () => "v1",
    async search(input: EngineInput): Promise<EngineResponse> {
      let jpeg: Buffer;
      try {
        jpeg = await input.image.jpeg();
      } catch (err) {
        if (err instanceof ImageError) return fail("invalid_input", false);
        return fail("unavailable", false);
      }
      try {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "image.jpg");
        const res = await sendRequest(deps.fetch, SEARCH_URL, {
          method: "POST",
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Origin": BASE_URL,
            "Referer": `${BASE_URL}/`,
          },
          body: form,
          signal: input.signal,
        });
        if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
        if (res.status === 400 || res.status === 413) { await res.body?.cancel(); return fail("invalid_input", true); }
        if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
        const parsed = bodySchema.safeParse(await res.json());
        if (!parsed.success) return fail("unavailable", true, { parseFailed: true });
        const matches = (parsed.data.results ?? []).map(toMatch).filter((m): m is Match => m !== null).slice(0, 5);
        if (matches.length === 0) return fail("no_match", true);
        return { status: "ok", matches, sent: true };
      } catch (err) {
        if (err instanceof PreSendError) return fail("unavailable", false);
        if (isAbortError(err, input.signal)) return fail("timeout", true);
        if (err instanceof SyntaxError) return fail("unavailable", true, { parseFailed: true });
        return fail("unavailable", true);
      }
    },
  };
}

