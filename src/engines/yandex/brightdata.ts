import { PreSendError, isAbortError, sendRequest } from "../http.ts";
import type { EngineResponse } from "../types.ts";
import { YandexParseError, parseYandexSites } from "./parse-html.ts";
import { sitesToMatches } from "./serpapi.ts";

const REQUEST_URL = "https://api.brightdata.com/request";

export function yandexPageUrl(imageUrl: string): string {
  return `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&url=${encodeURIComponent(imageUrl)}`;
}

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

export async function yandexViaBrightData(
  imageUrl: string,
  deps: { fetch: typeof fetch; apiKey: string; zone: string; signal: AbortSignal },
): Promise<EngineResponse> {
  try {
    const res = await sendRequest(deps.fetch, REQUEST_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${deps.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ zone: deps.zone, url: yandexPageUrl(imageUrl), format: "raw" }),
      signal: deps.signal,
    });
    if (res.status === 402) { await res.body?.cancel(); return fail("quota_exhausted", true); }
    if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
    if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
    const sites = parseYandexSites(await res.text());
    if (sites.length === 0) return fail("no_match", true);
    return { status: "ok", matches: sitesToMatches(sites), sent: true };
  } catch (err) {
    if (err instanceof PreSendError) return fail("unavailable", false);
    if (err instanceof YandexParseError) return fail("unavailable", true, { parseFailed: true });
    if (isAbortError(err, deps.signal)) return fail("timeout", true);
    return fail("unavailable", true);
  }
}
