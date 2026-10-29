import type { Config } from "./config.ts";
import type { Engine, EngineId } from "./engines/types.ts";
import { ProviderGates, type Gates } from "./limits/gates.ts";
import { ProviderHealth } from "./limits/health.ts";
import { UserLimits } from "./limits/user-limits.ts";
import type { ImageCandidate } from "./images/candidates.ts";
import { loadImage as loadImageDefault, type LoadedImage } from "./images/load.ts";
import { JobRegistry } from "./discord/jobs.ts";
import { SessionStore } from "./discord/sessions.ts";
import { createRunner, type Runner } from "./search/runner.ts";
import type { SearchOutcome } from "./search/orchestrator.ts";
import { ResultCache } from "./store/cache.ts";
import type { Db } from "./store/db.ts";
import { UsageStore } from "./store/usage.ts";
import { UserCounters } from "./store/user-counters.ts";

export interface Session {
  code: string; ownerId: string; guildId: string; nsfwChannel: boolean; ephemeral: boolean;
  image: LoadedImage; outcome: SearchOutcome; sizeBytes: number;
}
export interface PendingPick {
  ownerId: string; guildId: string; channelId: string; messageId: string; nsfwChannel: boolean;
  candidates: ImageCandidate[]; sizeBytes: number;
}
export interface App {
  config: Config; now: () => number; usage: UsageStore; cache: ResultCache; gates: Gates; health: ProviderHealth;
  userLimits: UserLimits; runner: Runner; jobs: JobRegistry; sessions: SessionStore<Session>; picks: SessionStore<PendingPick>;
  loadImage(input: { url: string; attachmentId?: string }): Promise<LoadedImage>;
  yandexAvailable(userId: string): boolean;
}

const SESSION_TTL_MS = 600_000;
const SESSION_MAX_BYTES = 134_217_728;
const PICK_MAX_BYTES = 1_048_576;

export function createApp(o: {
  config: Config; db: Db; engines: Record<EngineId, Engine>;
  now?: () => number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; loadImage?: App["loadImage"];
}): App {
  const { config } = o;
  const now = o.now ?? Date.now;
  const usage = new UsageStore(o.db);
  const cache = new ResultCache(o.db, now);
  const gates = new ProviderGates({ config, usage, now, sleep: o.sleep });
  const health = new ProviderHealth(usage, now);
  const userLimits = new UserLimits({ counters: new UserCounters(o.db), config, now });
  const runner = createRunner({ engines: o.engines, gates, cache, usage, health, userLimits, config, now });
  return {
    config, now, usage, cache, gates, health, userLimits, runner,
    jobs: new JobRegistry(config.maxActiveJobs),
    sessions: new SessionStore<Session>({ ttlMs: SESSION_TTL_MS, maxBytes: SESSION_MAX_BYTES, now }),
    picks: new SessionStore<PendingPick>({ ttlMs: SESSION_TTL_MS, maxBytes: PICK_MAX_BYTES, now }),
    loadImage: o.loadImage ?? ((input) => loadImageDefault(input, { cache, config, now, fetch: o.fetch })),
    yandexAvailable(userId) {
      return (health.isHealthy("yandex_direct") && gates.budget("yandex_direct", "extra") === "ok" && userLimits.canUseYandex(userId, "yandex_direct"))
        || (Boolean(config.brightdataApiKey && config.brightdataZone) && health.isHealthy("brightdata") && gates.budget("brightdata", "extra") === "ok" && userLimits.canUseYandex(userId, "brightdata"))
        || (Boolean(config.serpapiApiKey) && gates.budget("serpapi", "extra") === "ok" && userLimits.canUseYandex(userId, "serpapi"));
    },
  };
}
