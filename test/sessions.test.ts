import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/discord/sessions.ts";
import { JobRegistry } from "../src/discord/jobs.ts";
import { fakeClock } from "./helpers.ts";

test("session store expires and evicts the oldest by bytes", () => {
  const clock = fakeClock(0);
  const s = new SessionStore<{ sizeBytes: number; n: number }>({ ttlMs: 1000, maxBytes: 100, now: clock.now });
  s.set("a", { sizeBytes: 40, n: 1 });
  s.set("b", { sizeBytes: 40, n: 2 });
  assert.equal(s.get("a")?.n, 1); // refreshes a, so b is now the oldest
  s.set("c", { sizeBytes: 40, n: 3 });
  assert.equal(s.get("b"), undefined);
  assert.equal(s.get("a")?.n, 1);
  assert.equal(s.get("c")?.n, 3);
  clock.advance(1001);
  assert.equal(s.get("a"), undefined);
  s.set("d", { sizeBytes: 10, n: 4 });
  s.delete("d");
  assert.equal(s.get("d"), undefined);
});

test("job registry caps active jobs and drains on shutdown", async () => {
  const j = new JobRegistry(2);
  assert.equal(j.tryStart(), true);
  assert.equal(j.tryStart(), true);
  assert.equal(j.tryStart(), false);
  assert.equal(j.active, 2);
  j.stopAccepting();
  assert.equal(j.stopping, true);
  assert.equal(j.tryStart(), false);
  let drained = false;
  const p = j.drain(5000).then(() => { drained = true; });
  j.finish();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(drained, false);
  j.finish();
  await p;
  assert.equal(j.active, 0);
  await new JobRegistry(1).drain(10);
});
