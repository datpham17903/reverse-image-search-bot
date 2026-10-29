import { z } from "zod";
import { ImageError } from "../images/download.ts";
import { PreSendError, isAbortError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match, Mode, ProviderId } from "./types.ts";

export const SAUCENAO_HIDE_NORMAL = 3;
export const SAUCENAO_MOVIES_SHOWS_DBMASK = 25165824;
export const SAUCENAO_ANIME_INDEXES = [21, 22];
const ADULT_INDEXES = new Set([2, 3, 18, 22, 38]);
const DOUJIN_INDEXES = new Set([2, 3, 16, 18, 37, 38]);
const SEARCH_URL = "https://saucenao.com/search.php";
const SHORT_BLOCK_MS = 30_000;
const LONG_BLOCK_MS = 3_600_000;

const text = z.union([z.string(), z.number()]).transform(String);
const textOrList = z.union([text, z.array(text).transform((a) => a.join(", "))]);
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
    eng_name: text.optional(),
    jp_name: text.optional(),
    source: text.optional(),
    material: text.optional(),
    member_name: textOrList.optional(),
    creator: textOrList.optional(),
    author_name: textOrList.optional(),
    twitter_user_handle: text.optional(),
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

export function cleanDoujinTitle(raw: string): string {
  const base = raw
    .replace(/\[[^\]]*\]|\{[^}]*\}|\((?:C\d+|COMIC1[^)]*|Reitaisai[^)]*)\)/gi, " ")
    .split(/\s+_\s+|\s+\|\s+/)[0]!
    .replace(/\s+/g, " ")
    .trim();
  return base || raw.trim();
}

export interface DoujinMeta {
  nhentaiId?: string;
  ehId?: string;
  page?: string;
  folderTitle?: string;
  url: string;
}

export function extractDoujinMeta(
  thumbUrl: string | undefined,
  title: string,
  indexId: number,
  indexName = "",
): DoujinMeta | null {
  let decoded = "";
  if (thumbUrl) {
    try { decoded = decodeURIComponent(thumbUrl); } catch { decoded = thumbUrl; }
  }
  const nh = /\/res\/nhentai\/(\d+)(?:\s*\((\d+)\))?(?:\s*--\s*([^/?]+))?(?:\/(\d+)t?\.[a-z]+)?/i.exec(decoded);
  if (nh) {
    const nhentaiId = nh[1]!;
    const ehId = nh[2];
    const folderTitle = nh[3]?.trim();
    const page = nh[4] ?? /-\s*(\d+)t?\.[a-z]+/i.exec(indexName)?.[1];
    return {
      nhentaiId,
      ...(ehId ? { ehId } : {}),
      ...(page ? { page } : {}),
      ...(folderTitle ? { folderTitle } : {}),
      url: `https://nhentai.net/g/${nhentaiId}/`,
    };
  }
  const eh = /\/res\/(?:ehentai|hmisc)\/(\d+)(?:\s*--\s*([^/?]+))?(?:\/(\d+)t?\.[a-z]+)?/i.exec(decoded);
  if (eh) {
    const ehId = eh[1]!;
    const folderTitle = eh[2]?.trim();
    const page = eh[3] ?? /-\s*(\d+)t?\.[a-z]+/i.exec(indexName)?.[1];
    return {
      ehId,
      ...(page ? { page } : {}),
      ...(folderTitle ? { folderTitle } : {}),
      url: `https://hitomi.la/galleries/${ehId}.html`,
    };
  }
  if (DOUJIN_INDEXES.has(indexId)) {
    const page = /-\s*(\d+)t?\.[a-z]+/i.exec(indexName)?.[1];
    const q = encodeURIComponent(cleanDoujinTitle(title));
    const url = indexId === 18
      ? `https://nhentai.net/search/?q=${q}`
      : `https://e-hentai.org/?f_search=${q}`;
    return { ...(page ? { page } : {}), url };
  }
  return null;
}

function toMatch(it: Item): Match | null {
  const { header: h, data: d } = it;
  const rawTitle = d.title ?? d.eng_name ?? d.jp_name ?? d.source ?? d.material ?? h.index_name;
  const doujin = extractDoujinMeta(h.thumbnail, rawTitle, h.index_id, h.index_name);
  const url = d.ext_urls?.[0] ?? doujin?.url;
  if (!url) return null;
  const isAnime = SAUCENAO_ANIME_INDEXES.includes(h.index_id);
  const twHandle = d.twitter_user_handle ? `@${d.twitter_user_handle.replace(/^@/, "")}` : undefined;
  const author = d.member_name ?? d.creator ?? d.author_name ?? twHandle;
  const title =
    (twHandle && (rawTitle === h.index_name || /^Created:/i.test(rawTitle)))
      ? `Bài đăng X/Twitter của ${twHandle}`
      : (rawTitle || doujin?.folderTitle || h.index_name);
  const hasEpisodeAndTime = d.part != null && d.est_time != null;
  let detail: string | undefined;
  if (isAnime) {
    const time = d.est_time?.split(" / ")[0];
    detail = [d.part != null ? `Tập ${d.part}` : undefined, time].filter(Boolean).join(" · ") || undefined;
  } else {
    detail = [
      doujin?.nhentaiId ? `Mã #${doujin.nhentaiId}` : undefined,
      doujin?.ehId ? `Hitomi #${doujin.ehId}` : undefined,
      doujin?.page ? `Trang ${doujin.page}` : undefined,
      author != null ? `Tác giả: ${author}` : undefined,
      hostname(url),
    ].filter(Boolean).join(" · ") || undefined;
  }
  const isAdult = ADULT_INDEXES.has(h.index_id) || Boolean(h.hidden) || Boolean(doujin);
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
    const idxMatch = /title="Index #(\d+):\s*([^"]+)/.exec(block);
    const indexId = idxMatch ? Number(idxMatch[1]) : 0;
    const indexFull = idxMatch ? unescapeHtml(idxMatch[2]!.trim()) : "SauceNAO";
    const indexName = indexFull.split(/\s+-\s+/)[0]!.trim() || "SauceNAO";
    const ratingMatch = /raw-rating="(\d+)"/.exec(block);
    const rawRating = ratingMatch ? Number(ratingMatch[1]) : 0;
    const thumbMatch =
      /data-src2="(https:\/\/img\d*\.saucenao\.com\/[^"]+)"/.exec(block) ??
      /(?:data-src|src)="(https:\/\/img\d*\.saucenao\.com\/[^"]+)"/.exec(block);
    const previewUrl = thumbMatch ? unescapeHtml(thumbMatch[1]!) : undefined;
    const titleMatch = /<div class="resulttitle">([\s\S]*?)<\/div>/.exec(block);
    const strongTitle = titleMatch ? /<strong>([\s\S]*?)<\/strong>/.exec(titleMatch[1]!) : null;
    const rawTitle = strongTitle
      ? stripTags(strongTitle[1]!)
      : titleMatch
        ? stripTags(titleMatch[1]!.replace(/<br\s*\/?>/gi, " "))
        : indexName;
    const doujin = extractDoujinMeta(previewUrl, rawTitle, indexId, indexFull);
    const urlMatch = /<div class="resultcontent">[\s\S]*?<a href="(https?:\/\/(?!saucenao\.com)[^"]+)"/.exec(block);
    const url = urlMatch ? unescapeHtml(urlMatch[1]!) : doujin?.url;
    if (!url) continue;
    const isAnime = SAUCENAO_ANIME_INDEXES.includes(indexId);
    const authorMatch = /<strong>(?:Member|Creator(?:\(s\))?|Author|Artist|Twitter):\s*<\/strong>\s*(?:<a[^>]*>)?([^<]+)/i.exec(block);
    const author = authorMatch ? stripTags(authorMatch[1]!) : undefined;
    let title =
      (author && /^Created:/i.test(rawTitle))
        ? `Bài đăng X/Twitter của ${author.startsWith("@") ? author : `@${author}`}`
        : (rawTitle || doujin?.folderTitle || indexName);
    let part: string | undefined;
    if (isAnime && /\s-\s(\d+)$/.test(title)) {
      const pm = /^(.*?)\s-\s(\d+)$/.exec(title);
      if (pm) { title = pm[1]!; part = pm[2]!; }
    }
    const timeMatch = /Est Time:\s*([0-9:]+)/i.exec(block);
    const estTime = timeMatch?.[1];
    const hasEpisodeAndTime = Boolean(part && estTime);
    const detail = isAnime
      ? [part ? `Tập ${part}` : undefined, estTime].filter(Boolean).join(" · ") || undefined
      : [
          doujin?.nhentaiId ? `Mã #${doujin.nhentaiId}` : undefined,
          doujin?.ehId ? `Hitomi #${doujin.ehId}` : undefined,
          doujin?.page ? `Trang ${doujin.page}` : undefined,
          author ? `Tác giả: ${author}` : undefined,
          hostname(url),
        ].filter(Boolean).join(" · ") || undefined;
    const isAdult = ADULT_INDEXES.has(indexId) || rawRating >= 2 || Boolean(doujin);
    const isSafe = !isAdult && rawRating === 1;
    matches.push({
      engine: "saucenao", title, url, ...(detail ? { detail } : {}),
      score, ...(previewUrl ? { previewUrl } : {}),
      adult: isAdult ? true : isSafe ? false : null, isAnime, hasEpisodeAndTime,
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
          if (resp.status !== "rate_limited" && resp.status !== "quota_exhausted" && !(webFallback && resp.status === "unavailable")) return resp;
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
