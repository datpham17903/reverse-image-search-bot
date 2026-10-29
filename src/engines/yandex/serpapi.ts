import { z } from "zod";
import { PreSendError, isAbortError, sendRequest } from "../http.ts";
import type { EngineResponse, Match } from "../types.ts";
import type { YandexSite } from "./types.ts";

const SEARCH_URL = "https://serpapi.com/search.json";
const ACCOUNT_URL = "https://serpapi.com/account.json";
// Provisional (Phase 0 not recorded): name of the results array in the SerpApi response.
const RESULTS_FIELD = "image_results";

const itemSchema = z.object({
  title: z.string(),
  link: z.string(),
  thumbnail: z.string().nullish(),
});
const bodySchema = z.union([
  z.object({ [RESULTS_FIELD]: z.array(itemSchema) }),
  z.object({ error: z.string() }),
]);
const accountSchema = z.object({ total_searches_left: z.number(), this_month_usage: z.number() });

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

export function sitesToMatches(sites: YandexSite[]): Match[] {
  return sites.map((s) => {
    const desc = s.description?.trim();
    const detail = desc ? [desc.slice(0, 120), s.domain].filter(Boolean).join(" · ") : undefined;
    return {
      engine: "yandex", title: s.title, url: s.url, domain: s.domain,
      ...(detail ? { detail } : {}),
      ...(s.thumbnailUrl ? { previewUrl: s.thumbnailUrl } : {}), adult: null,
    };
  });
}

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

export async function yandexViaSerpApi(
  imageUrl: string,
  deps: { fetch: typeof fetch; apiKey: string; signal: AbortSignal },
): Promise<EngineResponse> {
  try {
    const res = await sendRequest(deps.fetch,
      `${SEARCH_URL}?engine=yandex_images&url=${encodeURIComponent(imageUrl)}&api_key=${encodeURIComponent(deps.apiKey)}`,
      { signal: deps.signal });
    if (res.status === 429) {
      const text = await res.text();
      return fail(/run out of searches/i.test(text) ? "quota_exhausted" : "rate_limited", true);
    }
    if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
    const parsed = bodySchema.safeParse(await res.json());
    if (!parsed.success) return fail("unavailable", true, { parseFailed: true });
    if ("error" in parsed.data) {
      return /hasn't returned any results/i.test(parsed.data.error) ? fail("no_match", true) : fail("unavailable", true);
    }
    const sites: YandexSite[] = parsed.data[RESULTS_FIELD].map((r) => ({
      title: r.title, url: r.link, domain: hostname(r.link), ...(r.thumbnail ? { thumbnailUrl: r.thumbnail } : {}),
    }));
    if (sites.length === 0) return fail("no_match", true);
    return { status: "ok", matches: sitesToMatches(sites), sent: true };
  } catch (err) {
    if (err instanceof PreSendError) return fail("unavailable", false);
    if (isAbortError(err, deps.signal)) return fail("timeout", true);
    if (err instanceof SyntaxError) return fail("unavailable", true, { parseFailed: true });
    return fail("unavailable", true);
  }
}

export async function getSerpApiAccount(
  deps: { fetch: typeof fetch; apiKey: string; signal?: AbortSignal },
): Promise<{ totalSearchesLeft: number; thisMonthUsage: number }> {
  const res = await sendRequest(deps.fetch, `${ACCOUNT_URL}?api_key=${encodeURIComponent(deps.apiKey)}`,
    deps.signal ? { signal: deps.signal } : {});
  if (res.status !== 200) { await res.body?.cancel(); throw new Error(`SerpApi account request failed: ${res.status}`); }
  const a = accountSchema.parse(await res.json());
  return { totalSearchesLeft: a.total_searches_left, thisMonthUsage: a.this_month_usage };
}
