import type { Config } from "../config.ts";
import type { CallPurpose, ProviderId } from "../engines/types.ts";
import type { UsageStore } from "../store/usage.ts";
import { startOfUtcDay, startOfUtcMonth, utcDaysLeftInMonth } from "../util/time.ts";
import { dailyAllowance } from "./budget.ts";
import { Semaphore } from "./semaphore.ts";
import { SlidingWindow } from "./window.ts";

export type Acquired = { release: () => void } | { busy: true };
export interface ProviderStats {
  provider: ProviderId; usedToday: number; allowanceToday: number | null;
  usedPeriod: number; periodLimit: number | null; remaining?: number; blocked: boolean;
}
export interface Gates {
  acquire(provider: ProviderId, waitMs: number): Promise<Acquired>;
  budget(provider: ProviderId, purpose: CallPurpose): "ok" | "server_quota";
  noteSaucenaoHeader(q: { shortRemaining?: number; longRemaining?: number }): void;
  noteTraceMe(me: { quota: number; quotaUsed: number }): void;
  noteSerpapiAccount(a: { totalSearchesLeft: number }): void;
  stats(): ProviderStats[];
}

const PROVIDERS: readonly ProviderId[] = ["tracemoe", "saucenao", "danbooru", "iqdb", "yandex_direct", "brightdata", "serpapi"];
const LEGACY_STATS_PROVIDERS: readonly ProviderId[] = ["tracemoe", "saucenao", "danbooru", "brightdata", "serpapi"];
const DAY_MS = 86_400_000;
const TRACE_DEFAULT_QUOTA = 100;
const SAUCENAO_SHORT_BLOCK_MS = 30_000;
const SAUCENAO_LONG_BLOCK_MS = 3_600_000;

export class ProviderGates implements Gates {
  private readonly config: Config;
  private readonly usage: UsageStore;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly semaphores: Record<ProviderId, Semaphore>;
  private readonly windows: Partial<Record<ProviderId, SlidingWindow>>;
  private readonly unlimited: boolean;
  private saucenaoShortUntil = 0;
  private saucenaoLongUntil = 0;
  private traceSnapshot: { quota: number; quotaUsed: number; at: number } | null = null;
  private serpapiSnapshot: { left: number; at: number } | null = null;

  constructor(deps: { config: Config; usage: UsageStore; now: () => number; sleep?: (ms: number) => Promise<void> }) {
    this.config = deps.config;
    this.usage = deps.usage;
    this.now = deps.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    // In unlimited mode, open high-concurrency slots and skip artificial 1s sliding window delays.
    this.unlimited = deps.config.unlimitedGates === true;
    this.semaphores = this.unlimited
      ? {
          tracemoe: new Semaphore(16),
          saucenao: new Semaphore(16),
          danbooru: new Semaphore(16),
          iqdb: new Semaphore(16),
          yandex_direct: new Semaphore(16),
          brightdata: new Semaphore(16),
          serpapi: new Semaphore(8),
        }
      : {
          tracemoe: new Semaphore(1),
          saucenao: new Semaphore(2),
          danbooru: new Semaphore(1),
          iqdb: new Semaphore(4),
          yandex_direct: new Semaphore(8),
          brightdata: new Semaphore(8),
          serpapi: new Semaphore(1),
        };
    this.windows = this.unlimited
      ? {}
      : {
          danbooru: new SlidingWindow(1, 1_000, deps.now),
          serpapi: new SlidingWindow(50, 3_600_000, deps.now),
        };
  }

  async acquire(provider: ProviderId, waitMs: number): Promise<Acquired> {
    const window = this.windows[provider];
    const deadline = this.now() + waitMs;
    const release = await this.semaphores[provider].acquire(waitMs);
    if (!release) return { busy: true };
    for (;;) {
      const shortBlock = !this.unlimited && provider === "saucenao" ? Math.max(0, this.saucenaoShortUntil - this.now()) : 0;
      const wait = Math.max(window?.msUntilFree() ?? 0, shortBlock);
      if (wait <= 0) break;
      if (wait > deadline - this.now()) {
        release();
        return { busy: true };
      }
      await this.sleep(wait);
    }
    window?.record();
    return { release };
  }

  budget(provider: ProviderId, purpose: CallPurpose): "ok" | "server_quota" {
    if (this.unlimited) {
      if (provider === "brightdata" || provider === "serpapi") {
        const m = this.monthly(provider);
        return m.usedToday >= m.allowance ? "server_quota" : "ok";
      }
      return "ok";
    }
    switch (provider) {
      case "tracemoe": {
        const { used, quota } = this.trace();
        if (used >= quota) return "server_quota";
        if (purpose === "unknown_check") {
          const now = this.now();
          const unknownUsed = this.usage.count("tracemoe", now - DAY_MS, now + 1, "unknown_check");
          if (unknownUsed >= Math.floor(quota * this.config.traceUnknownShare)) return "server_quota";
        }
        return "ok";
      }
      case "saucenao":
        return this.now() < this.saucenaoLongUntil ? "server_quota" : "ok";
      case "danbooru":
      case "iqdb":
      case "yandex_direct":
        return "ok";
      case "brightdata":
      case "serpapi": {
        const m = this.monthly(provider);
        return m.usedToday >= m.allowance ? "server_quota" : "ok";
      }
    }
  }

  noteSaucenaoHeader(q: { shortRemaining?: number; longRemaining?: number }): void {
    const now = this.now();
    if (q.shortRemaining === 0) this.saucenaoShortUntil = now + SAUCENAO_SHORT_BLOCK_MS;
    if (q.longRemaining === 0) this.saucenaoLongUntil = now + SAUCENAO_LONG_BLOCK_MS;
  }

  noteTraceMe(me: { quota: number; quotaUsed: number }): void {
    this.traceSnapshot = { quota: me.quota, quotaUsed: me.quotaUsed, at: this.now() };
  }

  noteSerpapiAccount(a: { totalSearchesLeft: number }): void {
    this.serpapiSnapshot = { left: a.totalSearchesLeft, at: this.now() };
  }

  stats(): ProviderStats[] {
    const now = this.now();
    const dayStart = startOfUtcDay(now);
    const list = this.unlimited ? PROVIDERS : LEGACY_STATS_PROVIDERS;
    return list.map((provider): ProviderStats => {
      const usedToday = this.usage.count(provider, dayStart, now + 1);
      switch (provider) {
        case "tracemoe": {
          const { used, quota } = this.trace();
          return { provider, usedToday, allowanceToday: null, usedPeriod: used, periodLimit: this.unlimited ? null : quota,
            remaining: this.unlimited ? undefined : Math.max(0, quota - used), blocked: this.budget(provider, "primary") === "server_quota" };
        }
        case "saucenao":
        case "danbooru":
        case "iqdb":
        case "yandex_direct":
          return { provider, usedToday, allowanceToday: null,
            usedPeriod: usedToday, periodLimit: null, blocked: this.budget(provider, "primary") === "server_quota" };
        case "brightdata":
        case "serpapi": {
          const m = this.monthly(provider);
          return { provider, usedToday, allowanceToday: m.allowance, usedPeriod: m.usedMonth, periodLimit: m.limit,
            remaining: Math.max(0, m.limit - m.usedMonth), blocked: m.usedToday >= m.allowance };
        }
      }
    });
  }

  private trace(): { used: number; quota: number } {
    const now = this.now();
    const snap = this.traceSnapshot;
    if (snap) return { used: snap.quotaUsed + this.usage.count("tracemoe", snap.at, now + 1), quota: snap.quota };
    return { used: this.usage.count("tracemoe", now - DAY_MS, now + 1), quota: TRACE_DEFAULT_QUOTA };
  }

  private monthly(provider: "brightdata" | "serpapi"):
    { limit: number; usedToday: number; usedMonth: number; allowance: number } {
    const now = this.now();
    const dayStart = startOfUtcDay(now);
    const limit = provider === "brightdata" ? this.config.brightdataMonthlyCredits : this.config.serpapiMonthlySearches;
    const usedToday = this.usage.count(provider, dayStart, now + 1);
    let usedMonth = this.usage.count(provider, startOfUtcMonth(now), now + 1);
    if (provider === "serpapi" && this.serpapiSnapshot) {
      const snap = this.serpapiSnapshot;
      usedMonth = Math.max(usedMonth, limit - snap.left + this.usage.count(provider, snap.at, now + 1));
    }
    const usedBeforeToday = Math.max(0, usedMonth - usedToday);
    return { limit, usedToday, usedMonth, allowance: dailyAllowance(limit, usedBeforeToday, utcDaysLeftInMonth(now)) };
  }
}
