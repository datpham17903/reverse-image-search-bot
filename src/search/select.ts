import type { EngineId, Tier, TieredMatch } from "../engines/types.ts";

const TIER_RANK: Record<Tier, number> = { source: 0, maybe: 1, related: 2 };
const ENGINE_RANK: Record<EngineId, number> = { tracemoe: 0, saucenao: 1, danbooru: 2, yandex: 3 };

export function pickResults(ms: TieredMatch[]): { main?: TieredMatch; others: TieredMatch[] } {
  const sorted = [...ms].sort((a, b) =>
    TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
    ENGINE_RANK[a.engine] - ENGINE_RANK[b.engine] ||
    (b.score ?? 0) - (a.score ?? 0));
  const seen = new Set<string>();
  const unique = sorted.filter(m => !seen.has(m.url) && seen.add(m.url));
  return { main: unique[0], others: unique.slice(1, 3) };
}
