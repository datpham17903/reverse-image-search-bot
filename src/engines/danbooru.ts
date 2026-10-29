import { z } from "zod";
import { PreSendError, isAbortError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match, ProviderId } from "./types.ts";

const SEARCH_URL = "https://danbooru.donmai.us/iqdb_queries.json";
const POST_URL = "https://danbooru.donmai.us/posts/";
const IQDB_URL = "https://iqdb.org/";

const bodySchema = z.array(z.object({
  score: z.number(),
  post: z.object({
    id: z.number(),
    source: z.string().nullish(),
    rating: z.enum(["g", "s", "q", "e"]),
    tag_string_artist: z.string().nullish(),
    preview_file_url: z.string().nullish(),
  }),
}));

type Item = z.infer<typeof bodySchema>[number];

function hostname(url: string): string | undefined {
  try { return new URL(url).hostname; } catch { return undefined; }
}

function toMatch(it: Item): Match {
  const { post } = it;
  const url = post.source && /^https?:\/\//i.test(post.source) ? post.source : `${POST_URL}${post.id}`;
  const artist = (post.tag_string_artist ?? "").split(/\s+/).filter(Boolean).join(", ");
  const detail = [artist ? `Tác giả: ${artist}` : undefined, hostname(url)].filter(Boolean).join(" · ");
  return {
    engine: "danbooru", title: artist || `Danbooru #${post.id}`, url, ...(detail ? { detail } : {}),
    score: it.score, ...(post.preview_file_url ? { previewUrl: post.preview_file_url } : {}),
    rating: post.rating, adult: post.rating !== "g",
  };
}

// Parses multi-booru HTML results from iqdb.org (Danbooru, Gelbooru, Sankaku, Yande.re, Konachan, etc.).
export function parseIqdbHtml(html: string): Match[] {
  const matches: Match[] = [];
  for (const m of html.matchAll(/<table>([\s\S]*?)<\/table>/gi)) {
    const block = m[1]!;
    if (!/(?:Best|Additional|Possible)\s+match/i.test(block)) continue;
    const hrefMatch = /<td[^>]*class=['"]image['"][^>]*>\s*<a[^>]*href=['"]([^'"]+)['"]/i.exec(block);
    const simMatch = /(\d+)%\s*similarity/i.exec(block);
    if (!hrefMatch || !simMatch) continue;
    const rawUrl = hrefMatch[1]!.trim();
    const url = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    if (!/^https?:\/\//i.test(url)) continue;
    const score = Number(simMatch[1]);
    const thumbMatch = /<img[^>]*src=['"]([^'"]+)['"]/i.exec(block);
    const rawThumb = thumbMatch?.[1];
    const previewUrl = rawThumb
      ? rawThumb.startsWith("//") ? `https:${rawThumb}` : rawThumb.startsWith("/") ? `https://iqdb.org${rawThumb}` : rawThumb
      : undefined;
    const ratingText = /\[(Safe|Ero|Explicit)\]/i.exec(block)?.[1]?.toLowerCase();
    const rating: "g" | "q" | "e" = ratingText === "safe" ? "g" : ratingText === "ero" ? "q" : "e";
    const host = hostname(url);
    const title = host ? `IQDB (${host})` : "IQDB";
    matches.push({
      engine: "danbooru", title, url, ...(host ? { detail: host } : {}),
      score, ...(previewUrl ? { previewUrl } : {}),
      rating, adult: rating !== "g",
    });
  }
  return matches.slice(0, 5);
}

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

function limitExhausted(header: string | null): boolean {
  if (!header) return false;
  try {
    const parsed = z.object({ remaining: z.number() }).safeParse(JSON.parse(header));
    return parsed.success && parsed.data.remaining <= 0;
  } catch { return false; }
}

export function createDanbooru(deps: {
  fetch: typeof fetch;
  login?: string;
  apiKey?: string;
  userId?: string;
  includeIqdb?: boolean;
}): Engine {
  const hasAuth = Boolean(deps.login && deps.apiKey);
  const headers: Record<string, string> = {
    ...(hasAuth ? { Authorization: `Basic ${Buffer.from(`${deps.login}:${deps.apiKey}`).toString("base64")}` } : {}),
    "User-Agent": `TimNguonBot/1.0 (user #${deps.userId || "anon"})`,
  };
  const providers: readonly ProviderId[] = deps.includeIqdb
    ? hasAuth ? ["danbooru", "iqdb"] : ["iqdb"]
    : ["danbooru"];

  async function searchDanbooru(input: EngineInput): Promise<EngineResponse> {
    try {
      const res = await sendRequest(deps.fetch, `${SEARCH_URL}?url=${encodeURIComponent(input.image.url)}&limit=5`, { headers, signal: input.signal });
      if (res.status === 401 || res.status === 403) { await res.body?.cancel(); return fail("unavailable", true); }
      if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
      if (res.status === 400 || res.status === 422) { await res.body?.cancel(); return fail("invalid_input", true); }
      if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
      if (limitExhausted(res.headers.get("x-rate-limit"))) { await res.body?.cancel(); return fail("rate_limited", true); }
      const parsed = bodySchema.safeParse(await res.json());
      if (!parsed.success) return fail("unavailable", true, { parseFailed: true });
      if (parsed.data.length === 0) return fail("no_match", true);
      return { status: "ok", matches: parsed.data.map(toMatch), sent: true };
    } catch (err) {
      if (err instanceof PreSendError) return fail("unavailable", false);
      if (isAbortError(err, input.signal)) return fail("timeout", true);
      if (err instanceof SyntaxError) return fail("unavailable", true, { parseFailed: true });
      return fail("unavailable", true);
    }
  }

  async function searchIqdb(input: EngineInput): Promise<EngineResponse> {
    try {
      const res = await sendRequest(deps.fetch, `${IQDB_URL}?url=${encodeURIComponent(input.image.url)}`, {
        headers: { "User-Agent": headers["User-Agent"]! },
        signal: input.signal,
      });
      if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
      if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
      const html = await res.text();
      if (!html.includes("iqdb") && !html.includes("Multi-service image search")) {
        return fail("unavailable", true, { parseFailed: true });
      }
      const matches = parseIqdbHtml(html);
      if (matches.length === 0) return fail("no_match", true);
      return { status: "ok", matches, sent: true };
    } catch (err) {
      if (err instanceof PreSendError) return fail("unavailable", false);
      if (isAbortError(err, input.signal)) return fail("timeout", true);
      return fail("unavailable", true);
    }
  }

  return {
    id: "danbooru",
    providers,
    version: 1,
    cacheParams: () => "l5",
    async search(input: EngineInput, provider: ProviderId): Promise<EngineResponse> {
      return provider === "iqdb" ? searchIqdb(input) : searchDanbooru(input);
    },
  };
}
