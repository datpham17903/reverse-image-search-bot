import type { Config } from "../config.ts";
import type { UserCounters } from "../store/user-counters.ts";
import { vnDayKey } from "../util/time.ts";

export type StartCheck =
  | { ok: true }
  | { ok: false; reason: "cooldown"; waitSec: number }
  | { ok: false; reason: "daily_limit" }
  | { ok: false; reason: "active" };

export class UserLimits {
  private readonly counters: UserCounters;
  private readonly config: Config;
  private readonly now: () => number;
  private readonly active = new Set<string>();
  private readonly lastSearchAt = new Map<string, number>();

  constructor(deps: { counters: UserCounters; config: Config; now: () => number }) {
    this.counters = deps.counters;
    this.config = deps.config;
    this.now = deps.now;
  }

  checkStart(userId: string, kind: "search" | "extra"): StartCheck {
    if (!this.config.allowConcurrentUserSearches && this.active.has(userId)) return { ok: false, reason: "active" };
    if (kind === "extra") return { ok: true };
    const last = this.lastSearchAt.get(userId);
    if (last !== undefined && this.config.userCooldownMs > 0) {
      const left = last + this.config.userCooldownMs - this.now();
      if (left > 0) return { ok: false, reason: "cooldown", waitSec: Math.ceil(left / 1000) };
    }
    if (this.remainingSearches(userId) <= 0) return { ok: false, reason: "daily_limit" };
    return { ok: true };
  }

  begin(userId: string, kind: "search" | "extra"): void {
    this.active.add(userId);
    if (kind === "search") {
      this.counters.increment(userId, vnDayKey(this.now()), "searches");
      this.lastSearchAt.set(userId, this.now());
    }
  }

  end(userId: string): void {
    this.active.delete(userId);
  }

  canUseYandex(userId: string, provider: "yandex_direct" | "brightdata" | "serpapi"): boolean {
    const c = this.counters.get(userId, vnDayKey(this.now()));
    if (c.yandex >= this.config.userDailyYandex) return false;
    return provider !== "serpapi" || c.yandexSerpapi < this.config.userDailyYandexSerpapi;
  }

  recordYandex(userId: string, usedSerpapi: boolean): void {
    const day = vnDayKey(this.now());
    this.counters.increment(userId, day, "yandex");
    if (usedSerpapi) this.counters.increment(userId, day, "yandex_serpapi");
  }

  remainingSearches(userId: string): number {
    const used = this.counters.get(userId, vnDayKey(this.now())).searches;
    return Math.max(0, this.config.userDailySearches - used);
  }
}
