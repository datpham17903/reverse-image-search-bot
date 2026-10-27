import { z } from "zod";
import { formatTimestamp } from "../util/time.ts";
import { ImageError } from "../images/download.ts";
import { PreSendError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match, ProviderId } from "./types.ts";

const SEARCH_URL = "https://api.trace.moe/search?anilistInfo&cutBorders=1";
const ME_URL = "https://api.trace.moe/me";
const MAX_MATCHES = 5;

const searchSchema = z.object({
  result: z.array(z.object({
    anilist: z.object({
      id: z.number(),
      title: z.object({ romaji: z.string().nullish(), english: z.string().nullish(), native: z.string().nullish() }),
      isAdult: z.boolean(),
    }),
    episode: z.union([z.number(), z.string(), z.array(z.number())]).nullable(),
    from: z.number(),
    similarity: z.number(),
    video: z.string(),
    image: z.string(),
  })),
});
const meSchema = z.object({ quota: z.number(), quotaUsed: z.number() });

type Item = z.infer<typeof searchSchema>["result"][number];

function toMatch(it: Item): Match {
  const { romaji, english, native } = it.anilist.title;
  const base = romaji ?? english ?? native ?? String(it.anilist.id);
  const title = english && english !== base ? `${base} / ${english}` : base;
  const time = formatTimestamp(it.from);
  const ep = it.episode;
  const detail = ep == null ? time : `Tập ${Array.isArray(ep) ? ep.join("–") : ep} · ${time}`;
  return {
    engine: "tracemoe", title, url: `https://anilist.co/anime/${it.anilist.id}`, detail,
    score: it.similarity, previewUrl: it.image, videoUrl: it.video, adult: it.anilist.isAdult,
    isAnime: true, hasEpisodeAndTime: ep != null,
  };
}

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

export function createTraceMoe(deps: { fetch: typeof fetch }): Engine & { getMe(signal?: AbortSignal): Promise<{ quota: number; quotaUsed: number }> } {
  return {
    id: "tracemoe",
    providers: ["tracemoe"],
    version: 1,
    cacheParams: () => "cb1",
    async search(input: EngineInput, _provider: ProviderId): Promise<EngineResponse> {
      let body: Buffer;
      try {
        body = await input.image.jpeg();
      } catch (err) {
        if (err instanceof ImageError) return fail("invalid_input", false);
        return fail("unavailable", false);
      }
      try {
        const res = await sendRequest(deps.fetch, SEARCH_URL, {
          method: "POST", headers: { "content-type": "image/jpeg" }, body: new Uint8Array(body), signal: input.signal,
        });
        if (res.status === 400) { await res.body?.cancel(); return fail("invalid_input", true); }
        if (res.status === 402) { await res.body?.cancel(); return fail("quota_exhausted", true); }
        if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
        if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
        const parsed = searchSchema.safeParse(await res.json());
        if (!parsed.success) return fail("unavailable", true, { parseFailed: true });
        const items = parsed.data.result.slice(0, MAX_MATCHES);
        if (items.length === 0) return fail("no_match", true);
        return { status: "ok", matches: items.map(toMatch), sent: true };
      } catch (err) {
        if (err instanceof PreSendError) return fail("unavailable", false);
        if ((err as { name?: string } | null)?.name === "AbortError") return fail("timeout", true);
        if (err instanceof SyntaxError) return fail("unavailable", true, { parseFailed: true });
        return fail("unavailable", true);
      }
    },
    async getMe(signal?: AbortSignal) {
      const res = await sendRequest(deps.fetch, ME_URL, { signal });
      if (!res.ok) throw new Error(`trace.moe /me HTTP ${res.status}`);
      const { quota, quotaUsed } = meSchema.parse(await res.json());
      return { quota, quotaUsed };
    },
  };
}
