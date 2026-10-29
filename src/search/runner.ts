import { log } from "../log.ts";
import type { Config } from "../config.ts";
import type {
  CallPurpose, Engine, EngineId, EngineOutcome, EngineResponse, ImageSource, Match, Mode, OutcomeStatus, ProviderId,
} from "../engines/types.ts";
import type { Gates } from "../limits/gates.ts";
import type { ProviderHealth } from "../limits/health.ts";
import type { UserLimits } from "../limits/user-limits.ts";
import type { ResultCache } from "../store/cache.ts";
import type { UsageStore } from "../store/usage.ts";

export interface RunContext {
  guildId: string; userId: string; mode: Mode; nsfwChannel: boolean;
  image: ImageSource; deadlineAt: number; purpose: CallPurpose;
}
export type Runner = (engine: EngineId, ctx: RunContext) => Promise<EngineOutcome>;

const MIN_REMAINING_MS = 1_000;
const MAX_ACQUIRE_WAIT_MS = 5_000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export function cacheKey(guildId: string, engine: Engine, params: string, sha256: string): string {
  return `${guildId}:${engine.id}:v${engine.version}:${params}:${sha256}`;
}

export function createRunner(deps: {
  engines: Record<EngineId, Engine>; gates: Gates; cache: ResultCache; usage: UsageStore;
  health: ProviderHealth; userLimits: UserLimits; config: Config; now: () => number;
}): Runner {
  const { engines, gates, cache, usage, health, userLimits, config, now } = deps;
  const inflight = new Map<string, Promise<EngineOutcome>>();

  async function execute(engine: Engine, key: string, ctx: RunContext): Promise<EngineOutcome> {
    const input = { image: ctx.image, mode: ctx.mode, nsfwChannel: ctx.nsfwChannel };
    const isYandex = engine.id === "yandex";
    let anySent = false;
    let sentViaSerpapi = false;
    let last: OutcomeStatus = "unavailable";
    const result = (status: OutcomeStatus, matches: Match[] = [], via?: ProviderId): EngineOutcome =>
      via ? { engine: engine.id, status, matches, via } : { engine: engine.id, status, matches };

    try {
      for (const provider of engine.providers) {
        if (!health.isHealthy(provider)) { last = "unavailable"; continue; }
        if (gates.budget(provider, ctx.purpose) === "server_quota") { last = "server_quota"; continue; }
        if (isYandex && !userLimits.canUseYandex(ctx.userId, provider as "yandex_direct" | "brightdata" | "serpapi")) {
          last = "user_quota"; continue;
        }
        let remaining = ctx.deadlineAt - now();
        if (remaining < MIN_REMAINING_MS) return result("deadline");
        const acquired = await gates.acquire(provider, Math.min(MAX_ACQUIRE_WAIT_MS, remaining));
        if ("busy" in acquired) return result("busy");
        if (gates.budget(provider, ctx.purpose) === "server_quota") {
          acquired.release(); last = "server_quota"; continue;
        }
        remaining = ctx.deadlineAt - now();
        if (remaining < MIN_REMAINING_MS) { acquired.release(); return result("deadline"); }

        let res: EngineResponse;
        try {
          const signal = AbortSignal.timeout(Math.max(1, Math.min(config.engineTimeoutMs, remaining)));
          res = await engine.search({ ...input, signal }, provider);
        } catch {
          res = { status: "unavailable", matches: [], sent: false };
        } finally {
          acquired.release();
        }

        if (res.status !== "ok" && res.status !== "no_match") {
          log("warn", "engine_failed", { engine: engine.id, provider, status: res.status, parseFailed: res.parseFailed === true });
        }
        const definitive = res.status === "ok" || res.status === "no_match";
        if (res.sent) {
          anySent = true;
          if (provider === "serpapi") sentViaSerpapi = true;
          if (provider !== "serpapi" || definitive) usage.record(provider, ctx.purpose, now());
        }
        if (engine.id === "saucenao" && res.quota) gates.noteSaucenaoHeader(res.quota);
        if (provider === "brightdata" || provider === "yandex_direct") {
          if (res.parseFailed) health.noteParseFailure(provider);
          else if (definitive) health.noteSuccess(provider);
        }

        const tryNextBooru = engine.id === "danbooru" && res.status === "no_match" && provider !== engine.providers.at(-1);
        if (res.status === "ok" || (res.status === "no_match" && !tryNextBooru)) {
          const ttl = res.status === "ok" ? config.cacheHitTtlDays * DAY_MS : config.cacheMissTtlHours * HOUR_MS;
          cache.put(key, engine.id, res.status, JSON.stringify({ status: res.status, matches: res.matches, via: provider }), ttl);
          return result(res.status, res.matches, provider);
        }
        if (res.status === "timeout" || res.status === "invalid_input") return result(res.status);
        last = res.status === "quota_exhausted" ? "server_quota" : res.status;
      }
      return result(last);
    } finally {
      if (isYandex && anySent) userLimits.recordYandex(ctx.userId, sentViaSerpapi);
    }
  }

  return (engineId, ctx) => {
    const engine = engines[engineId];
    const key = cacheKey(ctx.guildId, engine, engine.cacheParams({ mode: ctx.mode, nsfwChannel: ctx.nsfwChannel }), ctx.image.sha256);
    const cached = cache.get(key);
    if (cached) {
      const p = JSON.parse(cached.payload) as { status: OutcomeStatus; matches: Match[]; via?: ProviderId };
      return Promise.resolve({ engine: engine.id, status: p.status, matches: p.matches, via: p.via, fromCache: true });
    }
    const existing = inflight.get(key);
    if (existing) return existing;
    const promise = execute(engine, key, ctx).finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  };
}
