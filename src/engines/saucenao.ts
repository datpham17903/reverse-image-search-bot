import { z } from "zod";
import { ImageError } from "../images/download.ts";
import { PreSendError, isAbortError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match, Mode, ProviderId } from "./types.ts";

export const SAUCENAO_HIDE_NORMAL = 3;
export const SAUCENAO_MOVIES_SHOWS_DBMASK = 25165824;
export const SAUCENAO_ANIME_INDEXES = [21, 22];
const ADULT_ANIME_INDEX = 22;
const SEARCH_URL = "https://saucenao.com/search.php";

const text = z.union([z.string(), z.number()]).transform(String);
const headerSchema = z.object({
  status: z.number(),
  short_remaining: z.number().optional(),
  long_remaining: z.number().optional(),
});
const bodySchema = z.object({
  header: headerSchema,
  results: z.array(z.object({
    header: z.object({
      similarity: z.string(),
      thumbnail: z.string().optional(),
      index_id: z.number(),
      index_name: z.string(),
      hidden: z.number().optional(),
    }),
    data: z.object({
      ext_urls: z.array(z.string()).optional(),
      title: text.optional(),
      source: text.optional(),
      material: text.optional(),
      member_name: text.optional(),
      creator: text.optional(),
      author_name: text.optional(),
      part: text.optional(),
      est_time: text.optional(),
    }),
  })).default([]),
});

type Item = z.infer<typeof bodySchema>["results"][number];

function hostname(url: string): string | undefined {
  try { return new URL(url).hostname; } catch { return undefined; }
}

function toMatch(it: Item): Match | null {
  const { header: h, data: d } = it;
  const url = d.ext_urls?.[0];
  if (!url) return null;
  const isAnime = SAUCENAO_ANIME_INDEXES.includes(h.index_id);
  const title = d.title ?? d.source ?? d.material ?? h.index_name;
  const hasEpisodeAndTime = d.part != null && d.est_time != null;
  let detail: string | undefined;
  if (isAnime) {
    const time = d.est_time?.split(" / ")[0];
    detail = [d.part != null ? `Tập ${d.part}` : undefined, time].filter(Boolean).join(" · ") || undefined;
  } else {
    const author = d.member_name ?? d.creator ?? d.author_name;
    detail = [author != null ? `Tác giả: ${author}` : undefined, hostname(url)].filter(Boolean).join(" · ") || undefined;
  }
  return {
    engine: "saucenao", title, url, ...(detail ? { detail } : {}),
    score: parseFloat(h.similarity), ...(h.thumbnail ? { previewUrl: h.thumbnail } : {}),
    adult: h.index_id === ADULT_ANIME_INDEX ? true : null, isAnime, hasEpisodeAndTime,
  };
}

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

function quotaOf(h: z.infer<typeof headerSchema>): EngineResponse["quota"] | undefined {
  if (h.short_remaining === undefined && h.long_remaining === undefined) return undefined;
  return {
    ...(h.short_remaining !== undefined ? { shortRemaining: h.short_remaining } : {}),
    ...(h.long_remaining !== undefined ? { longRemaining: h.long_remaining } : {}),
  };
}

async function rateLimitStatus(res: Response): Promise<EngineResponse["status"]> {
  let raw = "";
  try { raw = await res.text(); } catch { /* body unreadable: treat as plain rate limit */ }
  let longRemaining: number | undefined;
  try {
    const parsed = z.object({ header: headerSchema.partial() }).safeParse(JSON.parse(raw));
    if (parsed.success) longRemaining = parsed.data.header.long_remaining;
  } catch { /* not JSON */ }
  return longRemaining === 0 || /daily/i.test(raw) ? "quota_exhausted" : "rate_limited";
}

export function createSauceNao(deps: { fetch: typeof fetch; apiKey: string }): Engine {
  const hideFor = (nsfwChannel: boolean) => (nsfwChannel ? 0 : SAUCENAO_HIDE_NORMAL);
  return {
    id: "saucenao",
    providers: ["saucenao"],
    version: 1,
    cacheParams: ({ mode, nsfwChannel }: { mode: Mode; nsfwChannel: boolean }) =>
      `${mode === "movie" ? "mv" : "all"}:h${hideFor(nsfwChannel)}`,
    async search(input: EngineInput, _provider: ProviderId): Promise<EngineResponse> {
      let jpeg: Buffer;
      try {
        jpeg = await input.image.jpeg();
      } catch (err) {
        if (err instanceof ImageError) return fail("invalid_input", false);
        return fail("unavailable", false);
      }
      const params = new URLSearchParams({ output_type: "2", numres: "8", api_key: deps.apiKey });
      if (input.mode === "movie") params.set("dbmask", String(SAUCENAO_MOVIES_SHOWS_DBMASK));
      else params.set("db", "999");
      if (!input.nsfwChannel) params.set("hide", String(SAUCENAO_HIDE_NORMAL));
      const form = new FormData();
      form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "image.jpg");
      try {
        const res = await sendRequest(deps.fetch, `${SEARCH_URL}?${params}`, { method: "POST", body: form, signal: input.signal });
        if (res.status === 429) return fail(await rateLimitStatus(res), true);
        if (res.status === 413) { await res.body?.cancel(); return fail("invalid_input", true); }
        if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
        const parsed = bodySchema.safeParse(await res.json());
        if (!parsed.success) return fail("unavailable", true, { parseFailed: true });
        const quota = quotaOf(parsed.data.header);
        const extra = quota ? { quota } : {};
        if (parsed.data.header.status !== 0) return fail("unavailable", true, extra);
        const matches = parsed.data.results
          .filter(it => input.nsfwChannel || !it.header.hidden)
          .map(toMatch)
          .filter((m): m is Match => m !== null);
        if (matches.length === 0) return fail("no_match", true, extra);
        return { status: "ok", matches, sent: true, ...extra };
      } catch (err) {
        if (err instanceof PreSendError) return fail("unavailable", false);
        if (isAbortError(err, input.signal)) return fail("timeout", true);
        if (err instanceof SyntaxError) return fail("unavailable", true, { parseFailed: true });
        return fail("unavailable", true);
      }
    },
  };
}
