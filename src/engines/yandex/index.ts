import type { Engine } from "../types.ts";
import { yandexViaBrightData } from "./brightdata.ts";
import { yandexViaSerpApi } from "./serpapi.ts";

export function createYandex(
  deps: { fetch: typeof fetch; brightdataApiKey: string; brightdataZone: string; serpapiApiKey: string },
): Engine {
  return {
    id: "yandex",
    providers: ["brightdata", "serpapi"],
    version: 1,
    cacheParams: () => "sites",
    search: async (input, provider) => provider === "brightdata"
      ? yandexViaBrightData(input.image.url, { fetch: deps.fetch, apiKey: deps.brightdataApiKey, zone: deps.brightdataZone, signal: input.signal })
      : yandexViaSerpApi(input.image.url, { fetch: deps.fetch, apiKey: deps.serpapiApiKey, signal: input.signal }),
  };
}
