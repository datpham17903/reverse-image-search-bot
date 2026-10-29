import type { Engine, ProviderId } from "../types.ts";
import { yandexViaBrightData } from "./brightdata.ts";
import { yandexViaDirect } from "./direct.ts";
import { yandexViaSerpApi } from "./serpapi.ts";

// Prioritizes free direct Yandex requests first, falling back to Bright Data or SerpApi if configured.
export function createYandex(
  deps: { fetch: typeof fetch; brightdataApiKey?: string; brightdataZone?: string; serpapiApiKey?: string; includeDirect?: boolean },
): Engine {
  const providers: ProviderId[] = [];
  if (deps.includeDirect) providers.push("yandex_direct");
  if (deps.brightdataApiKey && deps.brightdataZone) providers.push("brightdata");
  if (deps.serpapiApiKey) providers.push("serpapi");
  if (providers.length === 0) providers.push("yandex_direct");

  return {
    id: "yandex",
    providers,
    version: 1,
    cacheParams: () => "sites",
    search: async (input, provider) => {
      if (provider === "yandex_direct") return yandexViaDirect(input.image.url, { fetch: deps.fetch, signal: input.signal, jpeg: input.image.jpeg });
      if (provider === "brightdata") {
        return yandexViaBrightData(input.image.url, {
          fetch: deps.fetch, apiKey: deps.brightdataApiKey ?? "", zone: deps.brightdataZone ?? "", signal: input.signal,
        });
      }
      return yandexViaSerpApi(input.image.url, { fetch: deps.fetch, apiKey: deps.serpapiApiKey ?? "", signal: input.signal });
    },
  };
}
