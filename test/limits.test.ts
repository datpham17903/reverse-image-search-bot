import { test } from "node:test";
import assert from "node:assert/strict";
import { Semaphore } from "../src/limits/semaphore.ts";
import { SlidingWindow } from "../src/limits/window.ts";
import { dailyAllowance } from "../src/limits/budget.ts";
import { ProviderHealth } from "../src/limits/health.ts";
import { UsageStore } from "../src/store/usage.ts";
import { openDb } from "../src/store/db.ts";
import { fakeClock } from "./helpers.ts";

test("semaphore gives up after waitMs", async () => {
  const s = new Semaphore(1); const r1 = await s.acquire(0); assert.ok(r1);
  assert.equal(await s.acquire(30), null);
  r1!(); assert.ok(await s.acquire(0));
});
test("semaphore hands the slot to a waiter", async () => {
  const s = new Semaphore(1); const r1 = await s.acquire(0);
  const waiting = s.acquire(1000); r1!(); assert.ok(await waiting);
  assert.equal(s.inUse, 1);
});
test("sliding window", () => {
  const clk = fakeClock(0); const w = new SlidingWindow(2, 1000, clk.now);
  assert.equal(w.msUntilFree(), 0); w.record(); w.record();
  assert.equal(w.msUntilFree(), 1000); clk.set(400); assert.equal(w.msUntilFree(), 600);
  clk.set(1000); assert.equal(w.msUntilFree(), 0);
});
test("dailyAllowance", () => {
  assert.equal(dailyAllowance(5000, 0, 31), 161);
  assert.equal(dailyAllowance(5000, 4999, 10), 1);
  assert.equal(dailyAllowance(5000, 5000, 10), 0);
  assert.equal(dailyAllowance(250, 100, 15), 10);
});
test("3 consecutive parse failures make a provider unhealthy for 1 hour", () => {
  const clk = fakeClock(0); const h = new ProviderHealth(new UsageStore(openDb(":memory:")), clk.now);
  h.noteParseFailure("brightdata"); h.noteParseFailure("brightdata"); assert.ok(h.isHealthy("brightdata"));
  h.noteParseFailure("brightdata"); assert.ok(!h.isHealthy("brightdata"));
  clk.set(3_600_000); assert.ok(h.isHealthy("brightdata"));
});
test("a success resets the failure streak", () => {
  const clk = fakeClock(0); const h = new ProviderHealth(new UsageStore(openDb(":memory:")), clk.now);
  h.noteParseFailure("serpapi"); h.noteParseFailure("serpapi"); h.noteSuccess("serpapi");
  h.noteParseFailure("serpapi"); h.noteParseFailure("serpapi");
  assert.ok(h.isHealthy("serpapi"));
  assert.equal(h.snapshot().serpapi.failures, 2);
});
test("health persists across instances", () => {
  const clk = fakeClock(0); const u = new UsageStore(openDb(":memory:"));
  const h = new ProviderHealth(u, clk.now);
  for (let i = 0; i < 3; i++) h.noteParseFailure("brightdata");
  const h2 = new ProviderHealth(u, clk.now);
  assert.ok(!h2.isHealthy("brightdata"));
  assert.equal(h2.snapshot().brightdata.unhealthyUntil, 3_600_000);
});
