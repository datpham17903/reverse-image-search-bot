import type { EngineId, EngineOutcome, ImageSource, Mode, TieredMatch } from "../engines/types.ts";
import { nextBatch, nextCall } from "./flow.ts";
import type { Runner } from "./runner.ts";
import { pickResults } from "./select.ts";
import { tierAll } from "./tiers.ts";

export interface Progress { done: EngineId[]; current?: EngineId }
export interface SearchOutcome {
  code: string; mode: Mode; outcomes: EngineOutcome[]; tiered: TieredMatch[];
  main?: TieredMatch; others: TieredMatch[]; state: "found" | "not_found" | "incomplete";
}
export interface SearchRequest {
  code: string; guildId: string; userId: string; mode: Mode; nsfwChannel: boolean;
  image: ImageSource; deadlineAt: number; parallel?: boolean;
  onProgress?: (p: Progress) => void | Promise<void>;
}

export function finalize(code: string, mode: Mode, outcomes: EngineOutcome[]): SearchOutcome {
  const tiered = tierAll(outcomes.flatMap(o => o.matches));
  const { main, others } = pickResults(tiered);
  const hasGood = tiered.some(t => t.tier !== "related");
  const incomplete = !hasGood && outcomes.some(o => o.status !== "ok" && o.status !== "no_match");
  const state = incomplete ? "incomplete" : main ? "found" : "not_found";
  return { code, mode, outcomes, tiered, main, others, state };
}

export async function runSearch(req: SearchRequest, run: Runner): Promise<SearchOutcome> {
  const outcomes: EngineOutcome[] = [];
  if (req.parallel) {
    for (;;) {
      const batch = nextBatch({ mode: req.mode, outcomes, tiered: tierAll(outcomes.flatMap(o => o.matches)) });
      if (batch.length === 0) break;
      await req.onProgress?.({ done: outcomes.map(o => o.engine), current: batch[0]!.engine });
      const results = await new Promise<EngineOutcome[]>((resolve, reject) => {
        const done: EngineOutcome[] = [];
        let settled = false;
        let remaining = batch.length;
        for (const call of batch) {
          run(call.engine, {
            guildId: req.guildId, userId: req.userId, mode: req.mode, nsfwChannel: req.nsfwChannel,
            image: req.image, deadlineAt: req.deadlineAt, purpose: call.purpose,
          }).then((o) => {
            if (settled) return;
            done.push(o);
            remaining--;
            const hasSource = tierAll(o.matches).some((t) => t.tier === "source");
            if (hasSource || o.status === "deadline" || remaining === 0) {
              settled = true;
              resolve(done);
            }
          }, (err) => {
            if (!settled) {
              settled = true;
              reject(err);
            }
          });
        }
      });
      outcomes.push(...results);
      if (results.some(o => o.status === "deadline")) break;
    }
    return finalize(req.code, req.mode, outcomes);
  }

  for (;;) {
    const call = nextCall({ mode: req.mode, outcomes, tiered: tierAll(outcomes.flatMap(o => o.matches)) });
    if (!call) break;
    await req.onProgress?.({ done: outcomes.map(o => o.engine), current: call.engine });
    const outcome = await run(call.engine, {
      guildId: req.guildId, userId: req.userId, mode: req.mode, nsfwChannel: req.nsfwChannel,
      image: req.image, deadlineAt: req.deadlineAt, purpose: call.purpose,
    });
    outcomes.push(outcome);
    if (outcome.status === "deadline") break;
  }
  return finalize(req.code, req.mode, outcomes);
}

export async function runExtraYandex(prev: SearchOutcome, req: SearchRequest, run: Runner): Promise<SearchOutcome> {
  const outcome = await run("yandex", {
    guildId: req.guildId, userId: req.userId, mode: req.mode, nsfwChannel: req.nsfwChannel,
    image: req.image, deadlineAt: req.deadlineAt, purpose: "extra",
  });
  const outcomes = [...prev.outcomes.filter(o => o.engine !== "yandex"), outcome];
  return finalize(prev.code, req.mode, outcomes);
}
