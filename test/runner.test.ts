import { test } from "node:test";
import assert from "node:assert/strict";
import { createRunner, cacheKey, type RunContext } from "../src/search/runner.ts";
import { openDb } from "../src/store/db.ts";
import { ResultCache } from "../src/store/cache.ts";
import { UsageStore } from "../src/store/usage.ts";
import { UserCounters } from "../src/store/user-counters.ts";
import { ProviderHealth } from "../src/limits/health.ts";
import { ProviderGates, type Gates } from "../src/limits/gates.ts";
import { UserLimits } from "../src/limits/user-limits.ts";
import { fakeClock, testConfig } from "./helpers.ts";
import { vnDayKey } from "../src/util/time.ts";
import type { Engine, EngineId, EngineResponse, ProviderId, Match } from "../src/engines/types.ts";

const DAY = 86_400_000;
const HOUR = 3_600_000;
const ALL = Number.MAX_SAFE_INTEGER;

const match: Match = { engine: "yandex", title: "t", url: "https://x/y", adult: false };
const ok: EngineResponse = { status: "ok", matches: [match], sent: true };

function fakeEngine(
  id: EngineId, providers: ProviderId[],
  impl: (provider: ProviderId) => Promise<EngineResponse> | EngineResponse,
): Engine & { calls: ProviderId[] } {
  const calls: ProviderId[] = [];
  return {
    id, providers, version: 1, calls,
    cacheParams: ({ mode }) => mode,
    async search(_input, provider) { calls.push(provider); return impl(provider); },
  };
}

const img = (sha256: string) => ({ url: "u", sha256, jpeg: async () => Buffer.alloc(0) });

function setup(engine: Engine, over: { gates?: (g: Gates) => Gates; config?: Parameters<typeof testConfig>[0] } = {}) {
  const clock = fakeClock(1_000_000);
  const db = openDb(":memory:");
  const config = testConfig(over.config);
  const usage = new UsageStore(db);
  const cache = new ResultCache(db, clock.now);
  const counters = new UserCounters(db);
  const health = new ProviderHealth(usage, clock.now);
  const userLimits = new UserLimits({ counters, config, now: clock.now });
  const realGates = new ProviderGates({ config, usage, now: clock.now, sleep: async (ms) => { clock.advance(ms); } });
  const gates = over.gates ? over.gates(realGates) : realGates;
  const engines = { [engine.id]: engine } as Record<EngineId, Engine>;
  const runner = createRunner({ engines, gates, cache, usage, health, userLimits, config, now: clock.now });
  const ctx = (o: Partial<RunContext> = {}): RunContext => ({
    guildId: "g", userId: "u", mode: "auto", nsfwChannel: false,
    image: img("abc"), deadlineAt: clock.now() + 60_000, purpose: "primary", ...o,
  });
  const day = () => counters.get("u", vnDayKey(clock.now()));
  return { runner, ctx, clock, usage, day };
}

test("cache hit skips the engine", async () => {
  const e = fakeEngine("danbooru", ["danbooru"], () => ok);
  const s = setup(e);
  const first = await s.runner("danbooru", s.ctx());
  assert.equal(first.fromCache, undefined);
  const second = await s.runner("danbooru", s.ctx());
  assert.equal(e.calls.length, 1);
  assert.equal(second.fromCache, true);
  assert.equal(second.status, "ok");
  assert.equal(second.via, "danbooru");
  assert.equal(second.matches.length, 1);
});

test("cacheKey format", () => {
  const e = fakeEngine("danbooru", ["danbooru"], () => ok);
  assert.equal(cacheKey("g", e, "auto", "h"), "g:danbooru:v1:auto:h");
});

test("concurrent identical calls share one request", async () => {
  const e = fakeEngine("yandex", ["brightdata"], async () => {
    await new Promise((r) => setTimeout(r, 50));
    return ok;
  });
  const s = setup(e);
  const [a, b] = await Promise.all([s.runner("yandex", s.ctx()), s.runner("yandex", s.ctx())]);
  assert.equal(e.calls.length, 1);
  assert.deepEqual(a, b);
  assert.equal(s.day().yandex, 1);
});

test("busy on brightdata does not fall through to serpapi", async () => {
  const e = fakeEngine("yandex", ["brightdata", "serpapi"], () => ok);
  const s = setup(e, { gates: (g) => ({
    acquire: async (p, w) => (p === "brightdata" ? { busy: true } : g.acquire(p, w)),
    budget: (p, pu) => g.budget(p, pu),
    noteSaucenaoHeader: (q) => g.noteSaucenaoHeader(q),
    noteTraceMe: (m) => g.noteTraceMe(m),
    noteSerpapiAccount: (a) => g.noteSerpapiAccount(a),
    stats: () => g.stats(),
  }) });
  const out = await s.runner("yandex", s.ctx());
  assert.equal(out.status, "busy");
  assert.equal(e.calls.length, 0);
  assert.equal(s.day().yandex, 0);
});

test("brightdata error falls through to serpapi and counts one Yandex use", async () => {
  const e = fakeEngine("yandex", ["brightdata", "serpapi"], (p) =>
    p === "brightdata" ? { status: "unavailable", matches: [], sent: true } : ok);
  const s = setup(e);
  const out = await s.runner("yandex", s.ctx());
  assert.equal(out.status, "ok");
  assert.equal(out.via, "serpapi");
  assert.deepEqual(e.calls, ["brightdata", "serpapi"]);
  assert.equal(s.day().yandex, 1);
  assert.equal(s.day().yandexSerpapi, 1);
});

test("serpapi failures are not recorded as usage", async () => {
  const e = fakeEngine("yandex", ["serpapi"], () => ({ status: "unavailable", matches: [], sent: true }));
  const s = setup(e);
  const out = await s.runner("yandex", s.ctx());
  assert.equal(out.status, "unavailable");
  assert.equal(s.usage.count("serpapi", 0, ALL), 0);
});

test("sent brightdata call is recorded as usage, serpapi ok too", async () => {
  const e = fakeEngine("yandex", ["brightdata", "serpapi"], (p) =>
    p === "brightdata" ? { status: "rate_limited", matches: [], sent: true } : ok);
  const s = setup(e);
  await s.runner("yandex", s.ctx());
  assert.equal(s.usage.count("brightdata", 0, ALL), 1);
  assert.equal(s.usage.count("serpapi", 0, ALL), 1);
});

test("user serpapi cap skips the serpapi path with user_quota", async () => {
  const e = fakeEngine("yandex", ["serpapi"], () => ok);
  const s = setup(e, { config: { userDailyYandexSerpapi: 0 } });
  const out = await s.runner("yandex", s.ctx());
  assert.equal(out.status, "user_quota");
  assert.equal(e.calls.length, 0);
  assert.equal(s.day().yandex, 0);
});

test("timeout is recorded as used and not retried", async () => {
  const e = fakeEngine("yandex", ["brightdata", "serpapi"], () => ({ status: "timeout", matches: [], sent: true }));
  const s = setup(e);
  const out = await s.runner("yandex", s.ctx());
  assert.equal(out.status, "timeout");
  assert.deepEqual(e.calls, ["brightdata"]);
  assert.equal(s.usage.count("brightdata", 0, ALL), 1);
  assert.equal(s.day().yandex, 1);
});

test("3 brightdata parse failures route the next call straight to serpapi", async () => {
  const e = fakeEngine("yandex", ["brightdata", "serpapi"], (p) =>
    p === "brightdata"
      ? { status: "unavailable", matches: [], sent: true, parseFailed: true }
      : { status: "no_match", matches: [], sent: true });
  const s = setup(e);
  for (let i = 0; i < 3; i++) await s.runner("yandex", s.ctx({ image: img(`h${i}`), userId: `u${i}` }));
  e.calls.length = 0;
  const out = await s.runner("yandex", s.ctx({ image: img("h9"), userId: "u9" }));
  assert.deepEqual(e.calls, ["serpapi"]);
  assert.equal(out.via, "serpapi");
});

test("ok cached 30 days, no_match 24 hours, errors not cached", async () => {
  const okE = fakeEngine("danbooru", ["danbooru"], () => ok);
  const s1 = setup(okE);
  await s1.runner("danbooru", s1.ctx());
  s1.clock.advance(30 * DAY - 1);
  await s1.runner("danbooru", s1.ctx());
  assert.equal(okE.calls.length, 1);
  s1.clock.advance(2);
  await s1.runner("danbooru", s1.ctx());
  assert.equal(okE.calls.length, 2);

  const nmE = fakeEngine("danbooru", ["danbooru"], () => ({ status: "no_match", matches: [], sent: true }));
  const s2 = setup(nmE);
  await s2.runner("danbooru", s2.ctx());
  s2.clock.advance(24 * HOUR - 1);
  await s2.runner("danbooru", s2.ctx());
  assert.equal(nmE.calls.length, 1);
  s2.clock.advance(2);
  await s2.runner("danbooru", s2.ctx());
  assert.equal(nmE.calls.length, 2);

  const errE = fakeEngine("danbooru", ["danbooru"], () => ({ status: "unavailable", matches: [], sent: true }));
  const s3 = setup(errE);
  await s3.runner("danbooru", s3.ctx());
  await s3.runner("danbooru", s3.ctx());
  assert.equal(errE.calls.length, 2);
});

test("adapter throwing becomes unavailable", async () => {
  const e = fakeEngine("danbooru", ["danbooru"], () => { throw new Error("boom"); });
  const s = setup(e);
  const out = await s.runner("danbooru", s.ctx());
  assert.equal(out.status, "unavailable");
  assert.equal(s.usage.count("danbooru", 0, ALL), 0);
});

test("deadline under 1 s returns deadline without calling", async () => {
  const e = fakeEngine("danbooru", ["danbooru"], () => ok);
  const s = setup(e);
  const out = await s.runner("danbooru", s.ctx({ deadlineAt: s.clock.now() + 999 }));
  assert.equal(out.status, "deadline");
  assert.equal(e.calls.length, 0);
});

test("saucenao quota header is passed to gates", async () => {
  const e = fakeEngine("saucenao", ["saucenao"], () => ({ status: "no_match", matches: [], sent: true, quota: { longRemaining: 0 } }));
  const s = setup(e);
  await s.runner("saucenao", s.ctx());
  const out = await s.runner("saucenao", s.ctx({ image: img("other") }));
  assert.equal(out.status, "server_quota");
});
