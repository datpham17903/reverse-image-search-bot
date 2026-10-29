import { PreSendError, isAbortError, sendRequest } from "../http.ts";
import type { EngineResponse } from "../types.ts";
import { YandexParseError, parseYandexSites } from "./parse-html.ts";
import { sitesToMatches } from "./serpapi.ts";

// Direct Yandex CBIR search with family=no and sp.family:0 cookie to allow NSFW results without paid proxies.
export function yandexDirectUrl(imageUrl: string): string {
  return `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&family=no&url=${encodeURIComponent(imageUrl)}`;
}

const DIRECT_HEADERS: Record<string, string> = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cookie": "yp=1999999999.sp.family%3A0",
};

const fail = (status: EngineResponse["status"], sent: boolean, extra: Partial<EngineResponse> = {}): EngineResponse =>
  ({ status, matches: [], sent, ...extra });

const UPLOAD_URL = "https://yandex.com/images-apphost/image-download?cbird=111&images_avatars_size=preview&images_avatars_namespace=images-cbir";

export async function yandexViaDirect(
  imageUrl: string,
  deps: { fetch: typeof fetch; signal: AbortSignal; jpeg?: () => Promise<Buffer> },
): Promise<EngineResponse> {
  try {
    const res = await sendRequest(deps.fetch, yandexDirectUrl(imageUrl), {
      method: "GET",
      headers: DIRECT_HEADERS,
      signal: deps.signal,
    });
    if (res.status === 429) { await res.body?.cancel(); return fail("rate_limited", true); }
    if (res.status !== 200) { await res.body?.cancel(); return fail("unavailable", true); }
    let sites = parseYandexSites(await res.text());
    if (sites.length === 0 && deps.jpeg) {
      const buf = await deps.jpeg().catch(() => Buffer.alloc(0));
      if (buf.length > 0) {
        const up = await sendRequest(deps.fetch, UPLOAD_URL, {
          method: "POST",
          headers: { ...DIRECT_HEADERS, "Content-Type": "image/jpeg" },
          body: new Uint8Array(buf),
          signal: deps.signal,
        });
        if (up.status === 200) {
          const data = (await up.json().catch(() => null)) as { cbir_id?: string } | null;
          if (data?.cbir_id) {
            const r2 = await sendRequest(
              deps.fetch,
              `https://yandex.com/images/search?rpt=imageview&cbir_page=sites&family=no&cbir_id=${encodeURIComponent(data.cbir_id)}`,
              { method: "GET", headers: DIRECT_HEADERS, signal: deps.signal },
            );
            if (r2.status === 200) sites = parseYandexSites(await r2.text());
          }
        }
      }
    }
    if (sites.length === 0) return fail("no_match", true);
    return { status: "ok", matches: sitesToMatches(sites), sent: true };
  } catch (err) {
    if (err instanceof PreSendError) return fail("unavailable", false);
    if (err instanceof YandexParseError) return fail("unavailable", true, { parseFailed: true });
    if (isAbortError(err, deps.signal)) return fail("timeout", true);
    return fail("unavailable", true);
  }
}

