import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../src/store/db.ts";
import { ResultCache } from "../src/store/cache.ts";
import { UsageStore } from "../src/store/usage.ts";
import { UserCounters } from "../src/store/user-counters.ts";
import { fakeClock } from "./helpers.ts";

test("cache entry visible until expiry", () => {
  const clk = fakeClock(1000);
  const c = new ResultCache(openDb(":memory:"), clk.now);
  c.put("k", "saucenao", "ok", '{"m":1}', 500);
  assert.equal(c.get("k")?.payload, '{"m":1}');
  clk.set(1500);
  assert.equal(c.get("k"), undefined);
});

test("purgeExpired deletes only expired rows", () => {
  const clk = fakeClock(1000);
  const c = new ResultCache(openDb(":memory:"), clk.now);
  c.put("a", "saucenao", "ok", "1", 100);
  c.put("b", "yandex", "no_match", "2", 1000);
  clk.set(1100);
  assert.equal(c.purgeExpired(), 1);
  assert.equal(c.get("a"), undefined);
  assert.deepEqual(c.get("b"), { engine: "yandex", status: "no_match", payload: "2" });
});

test("attachment hash round-trips and expires", () => {
  const clk = fakeClock(0);
  const c = new ResultCache(openDb(":memory:"), clk.now);
  c.putAttachmentHash("att1", "abc", 100);
  assert.equal(c.getAttachmentHash("att1"), "abc");
  assert.equal(c.getAttachmentHash("nope"), undefined);
  clk.set(100);
  assert.equal(c.getAttachmentHash("att1"), undefined);
});

test("usage counts by provider, purpose and range", () => {
  const u = new UsageStore(openDb(":memory:"));
  u.record("brightdata", "primary", 100);
  u.record("brightdata", "extra", 200);
  u.record("serpapi", "primary", 150);
  assert.equal(u.count("brightdata", 0, 1000), 2);
  assert.equal(u.count("brightdata", 0, 1000, "extra"), 1);
  assert.equal(u.count("brightdata", 150, 1000), 1);
  assert.equal(u.count("brightdata", 0, 200), 1);
});

test("purgeBefore removes older calls", () => {
  const u = new UsageStore(openDb(":memory:"));
  u.record("serpapi", "primary", 10);
  u.record("serpapi", "primary", 20);
  u.purgeBefore(20);
  assert.equal(u.count("serpapi", 0, 1000), 1);
});

test("provider state round-trips JSON", () => {
  const u = new UsageStore(openDb(":memory:"));
  assert.equal(u.getState("s"), undefined);
  u.setState("s", { a: [1, 2], b: "x" }, 42);
  assert.deepEqual(u.getState("s"), { value: { a: [1, 2], b: "x" }, updatedAt: 42 });
  u.setState("s", 7, 43);
  assert.deepEqual(u.getState<number>("s"), { value: 7, updatedAt: 43 });
});

test("user counters are per user and day", () => {
  const uc = new UserCounters(openDb(":memory:"));
  uc.increment("u1", "2026-10-27", "searches");
  uc.increment("u1", "2026-10-27", "yandex_serpapi");
  assert.deepEqual(uc.get("u1", "2026-10-27"), { searches: 1, yandex: 0, yandexSerpapi: 1 });
  assert.deepEqual(uc.get("u1", "2026-10-28"), { searches: 0, yandex: 0, yandexSerpapi: 0 });
});

test("file database uses WAL", () => {
  const dir = mkdtempSync(join(tmpdir(), "store-test-"));
  const db = openDb(join(dir, "sub", "bot.db"));
  try {
    const row = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    assert.equal(row.journal_mode, "wal");
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
