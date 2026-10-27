import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCall, type FlowState } from "../src/search/flow.ts";
import { tierAll } from "../src/search/tiers.ts";
import type { EngineId, EngineOutcome, Match, Mode, OutcomeStatus } from "../src/engines/types.ts";

const o = (engine: EngineId, status: OutcomeStatus, matches: Match[] = []): EngineOutcome => ({ engine, status, matches });
const st = (mode: Mode, outcomes: EngineOutcome[]): FlowState => ({ mode, outcomes, tiered: tierAll(outcomes.flatMap(x => x.matches)) });
const m = (engine: EngineId, score: number | undefined, extra: Partial<Match> = {}): Match =>
  ({ engine, title: "t", url: `https://example.com/${engine}/${score}`, adult: false, score, ...extra });

test("auto starts with SauceNAO", () => assert.deepEqual(nextCall(st("auto", [])), { engine: "saucenao", purpose: "primary" }));

test("auto: SauceNAO unavailable for any reason → Danbooru", () => {
  for (const s of ["busy", "server_quota", "rate_limited", "unavailable", "timeout"] as const)
    assert.deepEqual(nextCall(st("auto", [o("saucenao", s)])), { engine: "danbooru", purpose: "primary" });
});

test("auto: SauceNAO no_match → Yandex, not Danbooru", () => {
  assert.deepEqual(nextCall(st("auto", [o("saucenao", "no_match")])), { engine: "yandex", purpose: "primary" });
});

test("auto: anime hint without episode/time → trace.moe anime_followup", () => {
  const s = st("auto", [o("saucenao", "ok", [m("saucenao", 95, { isAnime: true })])]);
  assert.deepEqual(nextCall(s), { engine: "tracemoe", purpose: "anime_followup" });
  const maybe = st("auto", [o("saucenao", "ok", [m("saucenao", 75, { isAnime: true })])]);
  assert.deepEqual(nextCall(maybe), { engine: "tracemoe", purpose: "anime_followup" });
});

test("auto: anime source with episode and time → done", () => {
  const s = st("auto", [o("saucenao", "ok", [m("saucenao", 95, { isAnime: true, hasEpisodeAndTime: true })])]);
  assert.equal(nextCall(s), null);
});

test("auto: artwork source → done", () => {
  assert.equal(nextCall(st("auto", [o("saucenao", "ok", [m("saucenao", 95)])])), null);
});

test("auto: nothing after Yandex → trace.moe unknown_check", () => {
  const s = st("auto", [o("saucenao", "no_match"), o("yandex", "no_match")]);
  assert.deepEqual(nextCall(s), { engine: "tracemoe", purpose: "unknown_check" });
  assert.equal(nextCall(st("auto", [o("saucenao", "no_match"), o("yandex", "no_match"), o("tracemoe", "no_match")])), null);
});

test("auto: Yandex maybe → done without unknown_check", () => {
  const y = m("yandex", undefined, { url: "https://pixiv.net/x" });
  assert.equal(nextCall(st("auto", [o("saucenao", "no_match"), o("yandex", "ok", [y])])), null);
});

test("anime / art / movie orders", () => {
  const seq = (mode: Mode): string[] => {
    const outcomes: EngineOutcome[] = [];
    for (let c = nextCall(st(mode, outcomes)); c; c = nextCall(st(mode, outcomes))) {
      assert.equal(c.purpose, "primary");
      outcomes.push(o(c.engine, "no_match"));
    }
    return outcomes.map(x => x.engine);
  };
  assert.deepEqual(seq("anime"), ["tracemoe", "saucenao", "yandex"]);
  assert.deepEqual(seq("art"), ["saucenao", "danbooru", "yandex"]);
  assert.deepEqual(seq("movie"), ["yandex", "saucenao"]);
  assert.equal(nextCall(st("anime", [o("tracemoe", "ok", [m("tracemoe", 0.95)])])), null);
});

test("never plans an engine twice", () => {
  for (const mode of ["auto", "anime", "art", "movie"] as const)
    for (const status of ["no_match", "busy", "timeout", "unavailable"] as const) {
      const outcomes: EngineOutcome[] = [];
      const seen = new Set<EngineId>();
      for (let c = nextCall(st(mode, outcomes)), i = 0; c; c = nextCall(st(mode, outcomes)), i++) {
        assert.ok(i < 10);
        assert.ok(!seen.has(c.engine), `${mode}/${status}: ${c.engine} twice`);
        seen.add(c.engine);
        outcomes.push(o(c.engine, status));
      }
    }
});
