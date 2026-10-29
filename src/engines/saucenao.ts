import { z } from "zod";
import { ImageError } from "../images/download.ts";
import { PreSendError, isAbortError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match, Mode, ProviderId } from "./types.ts";

export const SAUCENAO_HIDE_NORMAL = 3;
export const SAUCENAO_MOVIES_SHOWS_DBMASK = 25165824;
export const SAUCENAO_ANIME_INDEXES = [21, 22];
const ADULT_INDEXES = new Set([2, 3, 18, 22, 38]);
const SEARCH_URL = "https://saucenao.com/search.php";
const SHORT_BLOCK_MS = 30_000;
const LONG_BLOCK_MS = 3_600_000;

const text = z.union([z.string(), z.number()]).transform(String);
const headerSchema = z.object({
  status: z.number(),
  short_remaining: z.number().optional(),
  long_remaining: z.number().optional(),
});
const bodySchema = z.object({
  header: headerSchema,
  results: z.array(z.unknown()).default([]),
});
const itemSchema = z.object({
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
});

type Item = z.infer<typeof itemSchema>;

function hostname(url: string): string | undefined {
  try { return new URL(url).hostname; } catch { return undefined; }
}

const ENTITIES: Record<string, string> = { "&quot;": '"', "&amp;": "&", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };
const unescapeHtml = (s: string) => s.replace(/&(quot|amp|#39|apos|lt|gt);/g, (m) => ENTITIES[m] ?? m);
const stripTags = (s: string) => unescapeHtml(s.replace(/<[^>]*>/g, "")).trim();

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
  const isAdult = ADULT_INDEXES.has(h.index_id) || Boolean(h.hidden);
  return {
    engine: "saucenao", title, url, ...(detail ? { detail } : {}),
    score: parseFloat(h.similarity), ...(h.thumbnail ? { previewUrl: h.thumbnail } : {}),
    adult: isAdult ? true : null, isAnime, hasEpisodeAndTime,
  };
}

// Parses SauceNAO web HTML results for keyless or fallback searches.
export function parseSauceNaoHtml(html: string): Match[] {
  const matches: Match[] = [];
  for (const m of html.matchAll(/<table class="resulttable">([\s\S]*?)<\/table>/g)) {
    const block = m[1]!;
    const simMatch = /<div class="resultsimilarityinfo">(\d+(?:\.\d+)?)%<\/div>/.exec(block);
    if (!simMatch) continue;
    const score = parseFloat(simMatch[1]!);
    const urlMatch = /<div class="resultcontent">[\s\S]*?<a href="(https?:\/\/(?!saucenao\.com)[^"]+)"/.exec(block);
    if (!urlMatch) continue;
    const url = unescapeHtml(urlMatch[1]!);
    const idxMatch = /title="Index #(\d+):\s*([^"-]+)/.exec(block);
    const indexId = idxMatch ? Number(idxMatch[1]) : 0;
    const indexName = idxMatch ? unescapeHtml(idxMatch[2]!.trim()) : "SauceNAO";
    const ratingMatch = /raw-rating="(\d+)"/.exec(block);
    const rawRating = ratingMatch ? Number(ratingMatch[1]) : 0;
    const thumbMatch = /(?:data-src|src)="(https:\/\/img\d*\.saucenao\.com\/[^"]+)"/.exec(block);
    const previewUrl = thumbMatch ? unescapeHtml(thumbMatch[1]!) : undefined;
    const titleMatch = /<div class="resulttitle">([\s\S]*?)<\/div>/.exec(block);
    const rawTitle = titleMatch ? stripTags(titleMatch[1]!) : indexName;
    const isAnime = SAUCENAO_ANIME_INDEXES.includes(indexId);
    let title = rawTitle || indexName;
    let part: string | undefined;
    if (isAnime && /\s-\s(\d+)$/.test(title)) {
      const pm = /^(.*?)\s-\s(\d+)$/.exec(title);
      if (pm) { title = pm[1]!; part = pm[2]!; }
    }
    const timeMatch = /Est Time:\s*([0-9:]+)/i.exec(block);
    const estTime = timeMatch?.[1];
    const authorMatch = /<strong>(?:Member|Creator|Author|Artist):\s*<\/strong>\s*(?:<a[^>]*>)?([^<]+)/i.exec(block);
    const author = authorMatch ? stripTags(authorMatch[1]!) : undefined;
    const hasEpisodeAndTime = Boolean(part && estTime);
    const detail = isAnime
      ? [part ? `Tập ${part}` : undefined, estTime].filter(Boolean).join(" · ") || undefined
      : [author ? `Tác giả: ${author}` : undefined, hostname(url)].filter(Boolean).join(" · ") || undefined;
    const isAdult = ADULT_INDEXES.has(indexId) || rawRating >= 2;
    matches.push({
      engine: "saucenao", title, url, ...(detail ? { detail } : {}),
      score, ...(previewUrl ? { previewUrl } : {}),
      adult: isAdult ? true : null, isAnime, hasEpisodeAndTime,
    });
  }
  return matches.slice(0, 8);
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

async function rateLimitResponse(res: Response): Promise<EngineResponse> {
  let raw = "";
  try { raw = await res.text(); } catch { /* body unreadable: treat as plain rate limit */ }
  let longRemaining: number | undefined;
  try {
    const parsed = z.object({ header: headerSchema.partial() }).safeParse(JSON.parse(raw));
    if (parsed.success) longRemaining = parsed.data.header.long_remaining;
  } catch { /* not JSON */ }
  return longRemaining === 0 || /daily/i.test(raw)
    ? fail("quota_exhausted", true, { quota: { longRemaining: 0 } })
    : fail("rate_limited", true, { quota: { shortRemaining: 0 } });
}

export function createSauceNao(deps: {
  fetch: typeof fetch;
  apiKey?: string;
  apiKeys?: string[];
  hideNormal?: boolean;
  webFallback?: boolean;
  now?: () => number;
}): Engine {
  const keys = (deps.apiKeys ?? (deps.apiKey ? deps.apiKey.split(",") : []))
    .map(k => k.trim())
    .filter(Boolean);
  const now = deps.now ?? Date.now;
  const hideNormal = deps.hideNormal ?? true;
  const webFallback = deps.webFallback ?? false;
  const blockedUntil = new Map<string, number>();
  let cursor = 0;

  const hideFor = (nsfwChannel: boolean) => (hideNormal && !nsfwChannel ? SAUCENAO_HIDE_NORMAL : 0);

  async function searchWithKey(key: string, jpeg: Buffer, input: EngineInput): Promise<EngineResponse> {
    const params = new URLSearchParams({ output_type: "2", numres: "8", api_key: key });
    if (input.mode === "movie") params.set("dbmask", String(SAUCENAO_MOVIES_SHOWS_DBMASK));
    else params.set("db", "999");
    if (hideNormal && !input.nsfwChannel) params.set("hide", String(SAUCENAO_HIDE_NORMAL));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "image.jpg");
    const res = await sendRequest(deps.fetch, `${SEARCH_URL}?${params}`, { method: "POST", body: form, signal: input.signal });
    if (res.status === 429) {
      const rl = await rateLimitResponse(res);
      blockedUntil.set(key, now() + (rl.status === "quota_exhausted" ? LONG_BLOCK_MS : SHORT_BLOCK_MS));
      return rl;
    }
    if (res.status === 413) { await res.body?.cancel(); return fail("invalid_input", true); }
    if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
    const parsed = bodySchema.safeParse(await res.json());
    if (!parsed.success) return fail("unavailable", true, { parseFailed: true });
    const quota = quotaOf(parsed.data.header);
    if (quota?.longRemaining === 0) blockedUntil.set(key, now() + LONG_BLOCK_MS);
    else if (quota?.shortRemaining === 0) blockedUntil.set(key, now() + SHORT_BLOCK_MS);
    const extra = quota ? { quota } : {};
    if (parsed.data.header.status !== 0) return fail("unavailable", true, extra);
    const matches = parsed.data.results
      .flatMap((r) => { const it = itemSchema.safeParse(r); return it.success ? [it.data] : []; })
      .filter(it => !hideNormal || input.nsfwChannel || !it.header.hidden)
      .map(toMatch)
      .filter((m): m is Match => m !== null);
    if (matches.length === 0) return fail("no_match", true, extra);
    return { status: "ok", matches, sent: true, ...extra };
  }

  async function searchWeb(jpeg: Buffer, input: EngineInput): Promise<EngineResponse> {
    const params = new URLSearchParams();
    if (input.mode === "movie") params.set("dbmask", String(SAUCENAO_MOVIES_SHOWS_DBMASK));
    else params.set("db", "999");
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(jpeg)], { type: "image/jpeg" }), "image.jpg");
    const url = params.size > 0 ? `${SEARCH_URL}?${params}` : SEARCH_URL;
    const res = await sendRequest(deps.fetch, url, { method: "POST", body: form, signal: input.signal });
    if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
    if (res.status === 413) { await res.body?.cancel(); return fail("invalid_input", true); }
    if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
    const html = await res.text();
    if (!html.includes("resulttable") && !html.includes("saucenao")) {
      return fail("unavailable", true, { parseFailed: true });
    }
    const matches = parseSauceNaoHtml(html);
    if (matches.length === 0) return fail("no_match", true);
    return { status: "ok", matches, sent: true };
  }

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
      try {
        if (keys.length === 0) return await searchWeb(jpeg, input);
        let lastResp: EngineResponse | undefined;
        const start = cursor;
        for (let i = 0; i < keys.length; i++) {
          const idx = (start + i) % keys.length;
          const key = keys[idx]!;
          const until = blockedUntil.get(key) ?? 0;
          if (keys.length > 1 && now() < until) continue;
          cursor = (idx + 1) % keys.length;
          const resp = await searchWithKey(key, jpeg, input);
          lastResp = resp;
          if (resp.status !== "rate_limited" && resp.status !== "quota_exhausted") return resp;
        }
        if (webFallback) return await searchWeb(jpeg, input);
        return lastResp ?? fail("rate_limited", false);
      } catch (err) {
        if (err instanceof PreSendError) return fail("unavailable", false);
        if (isAbortError(err, input.signal)) return fail("timeout", true);
        if (err instanceof SyntaxError) return fail("unavailable", true, { parseFailed: true });
        return fail("unavailable", true);
      }
    },
  };
}
