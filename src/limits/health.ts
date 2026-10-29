import type { ProviderId } from "../engines/types.ts";
import type { UsageStore } from "../store/usage.ts";

const FAILURE_THRESHOLD = 3;
const UNHEALTHY_MS = 3_600_000;
const PROVIDERS: readonly ProviderId[] = ["tracemoe", "saucenao", "danbooru", "iqdb", "avscan", "yandex_direct", "brightdata", "serpapi"];

interface Entry { failures: number; unhealthyUntil: number | null }
type Snapshot = Record<ProviderId, { healthy: boolean; failures: number; unhealthyUntil: number | null }>;

export class ProviderHealth {
  private readonly usage: UsageStore;
  private readonly now: () => number;
  private readonly state: Record<ProviderId, Entry>;

  constructor(usage: UsageStore, now: () => number) {
    this.usage = usage;
    this.now = now;
    const saved = usage.getState<Partial<Record<ProviderId, Entry>>>("health")?.value ?? {};
    this.state = Object.fromEntries(
      PROVIDERS.map((p) => [p, saved[p] ?? { failures: 0, unhealthyUntil: null }]),
    ) as Record<ProviderId, Entry>;
  }

  isHealthy(p: ProviderId): boolean {
    const until = this.state[p]?.unhealthyUntil ?? null;
    return until === null || this.now() >= until;
  }

  noteParseFailure(p: ProviderId): void {
    const e = (this.state[p] ??= { failures: 0, unhealthyUntil: null });
    e.failures++;
    if (e.failures >= FAILURE_THRESHOLD) {
      e.unhealthyUntil = this.now() + UNHEALTHY_MS;
      e.failures = 0;
    }
    this.save();
  }

  noteSuccess(p: ProviderId): void {
    this.state[p] = { failures: 0, unhealthyUntil: null };
    this.save();
  }

  snapshot(): Snapshot {
    return Object.fromEntries(
      PROVIDERS.map((p) => [p, { healthy: this.isHealthy(p), ...this.state[p] }]),
    ) as Snapshot;
  }

  private save(): void {
    this.usage.setState("health", this.state, this.now());
  }
}
