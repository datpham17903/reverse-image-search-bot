import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { openDb } from "../src/store/db.ts";
import { UserCounters } from "../src/store/user-counters.ts";
import { UserLimits } from "../src/limits/user-limits.ts";
import { fakeClock, testConfig } from "./helpers.ts";

let clk: ReturnType<typeof fakeClock>;
let ul: UserLimits;

beforeEach(() => {
  clk = fakeClock(Date.UTC(2026, 0, 1, 0, 0, 0));
  ul = new UserLimits({ counters: new UserCounters(openDb(":memory:")), config: testConfig(), now: clk.now });
});

test("cooldown 10 s", () => {
  ul.begin("u", "search"); ul.end("u"); clk.advance(4000);
  assert.deepEqual(ul.checkStart("u", "search"), { ok: false, reason: "cooldown", waitSec: 6 });
  clk.advance(6000); assert.deepEqual(ul.checkStart("u", "search"), { ok: true });
});

test("one active job per user, including extra", () => {
  ul.begin("u", "search");
  assert.deepEqual(ul.checkStart("u", "extra"), { ok: false, reason: "active" });
  assert.deepEqual(ul.checkStart("u", "search"), { ok: false, reason: "active" });
  assert.deepEqual(ul.checkStart("other", "search"), { ok: true });
});

test("30 searches per Vietnam day", () => {
  clk.set(Date.UTC(2026, 0, 1, 1, 0, 0));
  for (let i = 0; i < 30; i++) {
    assert.deepEqual(ul.checkStart("u", "search"), { ok: true });
    ul.begin("u", "search"); ul.end("u"); clk.advance(10_000);
  }
  assert.deepEqual(ul.checkStart("u", "search"), { ok: false, reason: "daily_limit" });
  clk.set(Date.UTC(2026, 0, 1, 17, 0, 0));
  assert.deepEqual(ul.checkStart("u", "search"), { ok: true });
});

test("extra does not count as a search and ignores cooldown", () => {
  ul.begin("u", "search"); ul.end("u");
  assert.deepEqual(ul.checkStart("u", "extra"), { ok: true });
  ul.begin("u", "extra"); ul.end("u");
  assert.equal(ul.remainingSearches("u"), 29);
  clk.advance(10_000);
  assert.deepEqual(ul.checkStart("u", "search"), { ok: true });
});

test("yandex: 10 per day, at most 2 via serpapi", () => {
  ul.recordYandex("u", true); ul.recordYandex("u", true);
  assert.equal(ul.canUseYandex("u", "serpapi"), false);
  assert.equal(ul.canUseYandex("u", "brightdata"), true);
  for (let i = 0; i < 8; i++) ul.recordYandex("u", false);
  assert.equal(ul.canUseYandex("u", "brightdata"), false);
});

test("remainingSearches", () => {
  assert.equal(ul.remainingSearches("u"), 30);
  ul.begin("u", "search"); ul.end("u");
  assert.equal(ul.remainingSearches("u"), 29);
});
