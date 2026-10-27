import type { CallPurpose, EngineId, EngineOutcome, Mode, TieredMatch } from "../engines/types.ts";

export interface FlowState { mode: Mode; outcomes: EngineOutcome[]; tiered: TieredMatch[] }
export interface PlannedCall { engine: EngineId; purpose: CallPurpose }

const UNAVAILABLE = new Set(["busy", "server_quota", "rate_limited", "unavailable", "timeout"]);
const ORDERS: Record<Exclude<Mode, "auto">, EngineId[]> = {
  anime: ["tracemoe", "saucenao", "yandex"],
  art: ["saucenao", "danbooru", "yandex"],
  movie: ["yandex", "saucenao"],
};

export function nextCall(s: FlowState): PlannedCall | null {
  const tried = (e: EngineId) => s.outcomes.some(x => x.engine === e);
  const auto = s.mode === "auto";
  const awaitingEpisode = (t: TieredMatch) =>
    auto && t.engine === "saucenao" && t.isAnime === true && !t.hasEpisodeAndTime && !tried("tracemoe");
  if (s.tiered.some(t => t.tier === "source" && !awaitingEpisode(t))) return null;

  if (s.mode !== "auto") {
    const engine = ORDERS[s.mode].find(e => !tried(e));
    return engine ? { engine, purpose: "primary" } : null;
  }

  if (!tried("saucenao") && !tried("danbooru")) return { engine: "saucenao", purpose: "primary" };
  const sauce = s.outcomes.find(x => x.engine === "saucenao");
  if (sauce && UNAVAILABLE.has(sauce.status) && !tried("danbooru")) return { engine: "danbooru", purpose: "primary" };
  if (!tried("tracemoe") && s.tiered.some(t => t.engine === "saucenao" && t.isAnime === true && t.tier !== "related"))
    return { engine: "tracemoe", purpose: "anime_followup" };
  if (!tried("yandex")) return { engine: "yandex", purpose: "primary" };
  if (!tried("tracemoe") && !s.tiered.some(t => t.tier !== "related"))
    return { engine: "tracemoe", purpose: "unknown_check" };
  return null;
}
