import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/store/db.ts";
import { UsageStore } from "../src/store/usage.ts";
import { ProviderGates } from "../src/limits/gates.ts";
import { fakeClock, testConfig } from "./helpers.ts";

const DAY = 86_400_000;

function setup() {
  const clk = fakeClock(Date.UTC(2026, 9, 1));
  const usage = new UsageStore(openDb(":memory:"));
  const gates = new ProviderGates({ config: testConfig(), usage, now: clk.now, sleep: async (ms) => clk.advance(ms) });
  return { clk, usage, gates };
}

test("brightdata stops at the daily allowance", () => {
  const { clk, usage, gates } = setup();
  for (let i = 0; i < 160; i++) usage.record("brightdata", "primary", clk.now());
  assert.equal(gates.budget("brightdata", "primary"), "ok");
  usage.record("brightdata", "primary", clk.now());
  assert.equal(gates.budget("brightdata", "primary"), "server_quota");
});

test("unused allowance rolls over", () => {
  const { clk, gates } = setup();
  clk.advance(DAY);
  assert.equal(gates.stats().find((s) => s.provider === "brightdata")?.allowanceToday, Math.floor(5000 / 30));
});

test("trace unknown_check is capped at half the quota", () => {
  const { clk, usage, gates } = setup();
  gates.noteTraceMe({ quota: 100, quotaUsed: 0 });
  for (let i = 0; i < 50; i++) usage.record("tracemoe", "unknown_check", clk.now());
  assert.equal(gates.budget("tracemoe", "unknown_check"), "server_quota");
  assert.equal(gates.budget("tracemoe", "primary"), "ok");
});

test("trace budget = /me snapshot + local calls since", () => {
  const { clk, usage, gates } = setup();
  gates.noteTraceMe({ quota: 100, quotaUsed: 99 });
  assert.equal(gates.budget("tracemoe", "primary"), "ok");
  clk.advance(1);
  usage.record("tracemoe", "primary", clk.now());
  assert.equal(gates.budget("tracemoe", "primary"), "server_quota");
});

test("trace without snapshot counts last 24h against quota 100", () => {
  const { clk, usage, gates } = setup();
  for (let i = 0; i < 100; i++) usage.record("tracemoe", "primary", clk.now());
  assert.equal(gates.budget("tracemoe", "primary"), "server_quota");
  clk.advance(DAY + 1);
  assert.equal(gates.budget("tracemoe", "primary"), "ok");
});

test("saucenao short block -> busy until 30 s pass", async () => {
  const { clk, gates } = setup();
  gates.noteSaucenaoHeader({ shortRemaining: 0, longRemaining: 50 });
  assert.deepEqual(await gates.acquire("saucenao", 5000), { busy: true });
  clk.advance(30_000);
  assert.ok("release" in (await gates.acquire("saucenao", 5000)));
});

test("saucenao short block shorter than waitMs sleeps through it", async () => {
  const { clk, gates } = setup();
  const t0 = clk.now();
  gates.noteSaucenaoHeader({ shortRemaining: 0 });
  assert.ok("release" in (await gates.acquire("saucenao", 30_000)));
  assert.equal(clk.now() - t0, 30_000);
});

test("saucenao long remaining 0 -> server_quota for 1 hour", () => {
  const { clk, gates } = setup();
  gates.noteSaucenaoHeader({ longRemaining: 0 });
  assert.equal(gates.budget("saucenao", "primary"), "server_quota");
  clk.advance(3_599_999);
  assert.equal(gates.budget("saucenao", "primary"), "server_quota");
  clk.advance(1);
  assert.equal(gates.budget("saucenao", "primary"), "ok");
});

test("danbooru waits for its 1 s window when waitMs allows", async () => {
  const { gates } = setup();
  const a = await gates.acquire("danbooru", 0);
  assert.ok("release" in a);
  a.release();
  assert.deepEqual(await gates.acquire("danbooru", 0), { busy: true });
  assert.ok("release" in (await gates.acquire("danbooru", 1500)));
});

test("serpapi month usage uses the larger of local count and account snapshot", () => {
  const { clk, usage, gates } = setup();
  clk.advance(10 * DAY);
  for (let i = 0; i < 5; i++) usage.record("serpapi", "primary", clk.now() - 5 * DAY);
  gates.noteSerpapiAccount({ totalSearchesLeft: 100 }); // account says 150 used
  const s = gates.stats().find((x) => x.provider === "serpapi")!;
  assert.equal(s.usedPeriod, 150);
  assert.equal(s.remaining, 100);
  // allowance: (250-150) / 21 days left = 4
  assert.equal(s.allowanceToday, 4);
});

test("stats lists all five providers", () => {
  const { gates } = setup();
  assert.deepEqual(gates.stats().map((s) => s.provider), ["tracemoe", "saucenao", "danbooru", "brightdata", "serpapi"]);
});
