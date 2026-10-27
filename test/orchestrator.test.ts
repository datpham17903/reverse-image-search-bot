import { test } from "node:test";
import assert from "node:assert/strict";
import { finalize, runSearch, runExtraYandex, type Progress, type SearchRequest } from "../src/search/orchestrator.ts";
import type { Runner } from "../src/search/runner.ts";
import type { EngineId, EngineOutcome, Match, OutcomeStatus } from "../src/engines/types.ts";

const o = (engine: EngineId, status: OutcomeStatus, matches: Match[] = []): EngineOutcome => ({ engine, status, matches });
const m = (engine: EngineId, score: number | undefined, extra: Partial<Match> = {}): Match =>
  ({ engine, title: "t", url: `https://example.com/${engine}/${score}`, adult: false, score, ...extra });
const req = (onProgress?: SearchRequest["onProgress"]): SearchRequest => ({
  code: "abc", guildId: "g", userId: "u", mode: "auto", nsfwChannel: false,
  image: { url: "https://x/y.png", sha256: "h", jpeg: async () => Buffer.alloc(0) }, deadlineAt: 1000, onProgress,
});

test("runSearch reports progress and stops at deadline", async () => {
  const progress: Progress[] = [];
  const calls: string[] = [];
  const run: Runner = async (engine, ctx) => {
    calls.push(`${engine}/${ctx.purpose}`);
    return o(engine, engine === "yandex" ? "deadline" : "no_match");
  };
  const r = await runSearch(req(p => { progress.push({ done: [...p.done], current: p.current }); }), run);
  assert.deepEqual(calls, ["saucenao/primary", "yandex/primary"]);
  assert.deepEqual(progress, [{ done: [], current: "saucenao" }, { done: ["saucenao"], current: "yandex" }]);
  assert.equal(r.code, "abc");
  assert.equal(r.outcomes.length, 2);
  assert.equal(r.state, "incomplete");
});

test("runSearch finishes when sufficient", async () => {
  const run: Runner = async engine => o(engine, "ok", [m(engine, 95)]);
  const r = await runSearch(req(), run);
  assert.equal(r.outcomes.length, 1);
  assert.equal(r.state, "found");
  assert.equal(r.main?.engine, "saucenao");
});

test("finalize states found / not_found / incomplete", () => {
  assert.equal(finalize("c", "auto", [o("saucenao", "ok", [m("saucenao", 95)])]).state, "found");
  const nf = finalize("c", "auto", [o("saucenao", "no_match"), o("yandex", "ok", [m("yandex", undefined)])]);
  assert.equal(nf.state, "found"); // related result still counts as main
  assert.equal(finalize("c", "auto", [o("saucenao", "no_match")]).state, "not_found");
  assert.equal(finalize("c", "auto", [o("saucenao", "timeout")]).state, "incomplete");
  assert.equal(finalize("c", "auto", [o("saucenao", "timeout"), o("danbooru", "ok", [m("danbooru", 95)])]).state, "found");
});

test("runExtraYandex merges into the previous outcome", async () => {
  const prev = finalize("keep", "auto", [o("saucenao", "no_match"), o("yandex", "timeout")]);
  let purpose = "";
  const run: Runner = async (engine, ctx) => { purpose = `${engine}/${ctx.purpose}`; return o("yandex", "ok", [m("yandex", undefined)]); };
  const r = await runExtraYandex(prev, req(), run);
  assert.equal(purpose, "yandex/extra");
  assert.equal(r.code, "keep");
  assert.deepEqual(r.outcomes.map(x => `${x.engine}:${x.status}`), ["saucenao:no_match", "yandex:ok"]);
  assert.equal(r.state, "found");
});
