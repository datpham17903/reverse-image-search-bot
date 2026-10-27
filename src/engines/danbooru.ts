import { z } from "zod";
import { PreSendError, isAbortError, sendRequest } from "./http.ts";
import type { Engine, EngineInput, EngineResponse, Match, ProviderId } from "./types.ts";

const SEARCH_URL = "https://danbooru.donmai.us/iqdb_queries.json";
const POST_URL = "https://danbooru.donmai.us/posts/";

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

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

// Provisional format (spec section 17 not recorded yet): JSON with a numeric `remaining` field.
function limitExhausted(header: string | null): boolean {
  if (!header) return false;
  try {
    const parsed = z.object({ remaining: z.number() }).safeParse(JSON.parse(header));
    return parsed.success && parsed.data.remaining <= 0;
  } catch { return false; }
}

export function createDanbooru(deps: { fetch: typeof fetch; login: string; apiKey: string; userId: string }): Engine {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${deps.login}:${deps.apiKey}`).toString("base64")}`,
    "User-Agent": `TimNguonBot/1.0 (user #${deps.userId})`,
  };
  return {
    id: "danbooru",
    providers: ["danbooru"],
    version: 1,
    cacheParams: () => "l5",
    async search(input: EngineInput, _provider: ProviderId): Promise<EngineResponse> {
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
    },
  };
}
