import type { Config } from "../config.ts";
import { createDanbooru } from "./danbooru.ts";
import { createSauceNao } from "./saucenao.ts";
import { createTraceMoe } from "./tracemoe.ts";
import type { Engine, EngineId } from "./types.ts";
import { createYandex } from "./yandex/index.ts";
import { getSerpApiAccount } from "./yandex/serpapi.ts";

export function createEngines(config: Config, f: typeof fetch): {
  engines: Record<EngineId, Engine>;
  traceMe(signal?: AbortSignal): Promise<{ quota: number; quotaUsed: number }>;
  serpapiAccount(signal?: AbortSignal): Promise<{ totalSearchesLeft: number; thisMonthUsage: number }>;
} {
  const tracemoe = createTraceMoe({ fetch: f });
  return {
    engines: {
      tracemoe,
      saucenao: createSauceNao({ fetch: f, apiKey: config.saucenaoApiKey }),
      danbooru: createDanbooru({ fetch: f, login: config.danbooruLogin, apiKey: config.danbooruApiKey, userId: config.danbooruUserId }),
      yandex: createYandex({ fetch: f, brightdataApiKey: config.brightdataApiKey, brightdataZone: config.brightdataZone, serpapiApiKey: config.serpapiApiKey }),
    },
    traceMe: (signal) => tracemoe.getMe(signal),
    serpapiAccount: (signal) => getSerpApiAccount({ fetch: f, apiKey: config.serpapiApiKey, ...(signal ? { signal } : {}) }),
  };
}
