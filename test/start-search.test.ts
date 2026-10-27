import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp, type App } from "../src/app.ts";
import { startSearch, startExtraYandex, type Responder } from "../src/discord/start-search.ts";
import { openDb } from "../src/store/db.ts";
import { ImageError } from "../src/images/download.ts";
import type { LoadedImage } from "../src/images/load.ts";
import type { Engine, EngineId, Match } from "../src/engines/types.ts";
import type { Payload } from "../src/discord/render.ts";
import { fakeClock, testConfig } from "./helpers.ts";

const match = (engine: EngineId): Match => ({ engine, title: "Title", url: "https://example.com/x", adult: false, score: 95 });

function engines(delay: () => number = () => 0): Record<EngineId, Engine> {
  const mk = (id: EngineId, providers: Engine["providers"]): Engine => ({
    id, providers, version: 1, cacheParams: ({ mode }) => mode,
    async search() {
      const d = delay();
      if (d > 0) await new Promise((r) => setTimeout(r, d));
      return { status: "ok", matches: [match(id)], sent: true };
    },
  });
  return {
    tracemoe: mk("tracemoe", ["tracemoe"]), saucenao: mk("saucenao", ["saucenao"]),
    danbooru: mk("danbooru", ["danbooru"]), yandex: mk("yandex", ["brightdata", "serpapi"]),
  };
}

const image = (url: string): LoadedImage => ({ url, sha256: url, jpeg: async () => Buffer.alloc(10), bytesInMemory: () => 10 });

function makeApp(over: { config?: Parameters<typeof testConfig>[0]; loadImage?: App["loadImage"]; delay?: () => number; now?: () => number } = {}) {
  return createApp({
    config: testConfig(over.config), db: openDb(":memory:"), engines: engines(over.delay),
    now: over.now, loadImage: over.loadImage ?? (async (i) => image(i.url)),
  });
}

function responder() {
  const calls: { kind: string; at: number; payload?: Payload; ephemeral?: boolean }[] = [];
  const r: Responder = {
    async replyEphemeral(p) { calls.push({ kind: "reply", at: Date.now(), payload: p }); },
    async defer(e) { calls.push({ kind: "defer", at: Date.now(), ephemeral: e }); },
    async edit(p) { calls.push({ kind: "edit", at: Date.now(), payload: p }); },
  };
  return { r, calls, last: () => calls.filter((c) => c.kind === "edit").at(-1)?.payload };
}

const params = (userId: string, url = "https://cdn.discordapp.com/a.png") => ({
  userId, guildId: "g", nsfwChannel: false, ephemeral: false, mode: "auto" as const, image: { url },
});

test("cooldown is answered ephemerally without defer", async () => {
  const app = makeApp();
  await startSearch(params("u1"), responder().r, app);
  const second = responder();
  await startSearch(params("u1"), second.r, app);
  assert.deepEqual(second.calls.map((c) => c.kind), ["reply"]);
  assert.match(JSON.stringify(second.calls[0].payload), /Đợi/);
});

test("image error edits the deferred reply with the error and deep links", async () => {
  const app = makeApp({ loadImage: async () => { throw new ImageError("decode_failed"); } });
  const res = responder();
  await startSearch(params("u1"), res.r, app);
  assert.deepEqual(res.calls.map((c) => c.kind), ["defer", "edit"]);
  const text = JSON.stringify(res.last());
  assert.match(text, /Không đọc được ảnh/);
  assert.match(text, /Yandex/);
  assert.equal(app.jobs.active, 0);
});

test("successful search stores a session and renders the outcome with its code", async () => {
  const app = makeApp();
  const res = responder();
  await startSearch(params("u1"), res.r, app);
  assert.equal(res.calls[0].kind, "defer");
  const text = JSON.stringify(res.last());
  const code = /Mã: ([A-Z0-9]{6})/.exec(text)?.[1];
  assert.ok(code, text);
  const session = app.sessions.get(code);
  assert.equal(session?.ownerId, "u1");
  assert.equal(session?.sizeBytes, 10);
  assert.equal(app.jobs.active, 0);
});

test("a failed progress edit does not abort the search", async () => {
  const app = makeApp();
  const res = responder();
  let first = true;
  const r: Responder = { ...res.r, async edit(p) {
    if (first) { first = false; throw new Error("discord down"); }
    await res.r.edit(p);
  } };
  await startSearch(params("u1"), r, app);
  assert.match(JSON.stringify(res.last()), /Mã: /);
});

test("50 concurrent users are all deferred within 3 s and all get a final message", { timeout: 60_000 }, async () => {
  const app = makeApp({ delay: () => 50 + Math.random() * 250 });
  const start = Date.now();
  const rs = Array.from({ length: 50 }, (_, i) => ({ id: `user${i}`, res: responder() }));
  await Promise.all(rs.map(({ id, res }) => startSearch(params(id, `https://cdn.discordapp.com/${id}.png`), res.r, app)));
  for (const { res } of rs) {
    const defer = res.calls.find((c) => c.kind === "defer");
    assert.ok(defer && defer.at - start <= 3000);
    const embeds = res.last()?.embeds ?? [];
    assert.ok(embeds.length > 0);
  }
  assert.equal(app.jobs.active, 0);
});

test("the 101st concurrent search gets the busy notice", async () => {
  const app = makeApp({ config: { maxActiveJobs: 100 }, delay: () => 100 });
  const all = Array.from({ length: 101 }, (_, i) => ({ id: `user${i}`, res: responder() }));
  await Promise.all(all.map(({ id, res }) => startSearch(params(id, `https://cdn.discordapp.com/${id}.png`), res.r, app)));
  const busy = all.filter(({ res }) => res.calls.length === 1 && res.calls[0].kind === "reply");
  assert.equal(busy.length, 1);
  assert.match(JSON.stringify(busy[0].res.calls[0].payload), /Bot đang bận/);
});

test("startExtraYandex refuses when Yandex is unavailable", async () => {
  const clock = fakeClock(1_000_000);
  const app = makeApp({ config: { userDailyYandex: 1 }, now: clock.now });
  const res = responder();
  await startSearch(params("u1"), res.r, app);
  const code = /Mã: ([A-Z0-9]{6})/.exec(JSON.stringify(res.last()))![1];
  app.userLimits.recordYandex("u1", false);
  const extra = responder();
  await startExtraYandex(code, "u1", extra.r, app);
  assert.deepEqual(extra.calls.map((c) => c.kind), ["reply"]);
  assert.match(JSON.stringify(extra.calls[0].payload), /Yandex hiện đã hết lượt/);
  const missing = responder();
  await startExtraYandex("NOPE22", "u1", missing.r, app);
  assert.match(JSON.stringify(missing.calls[0].payload), /Phiên đã hết/);
});

test("startExtraYandex rejects a user who does not own the session", async () => {
  const app = makeApp();
  const res = responder();
  await startSearch(params("u1"), res.r, app);
  const code = /Mã: ([A-Z0-9]{6})/.exec(JSON.stringify(res.last()))![1];
  const other = responder();
  await startExtraYandex(code, "u2", other.r, app);
  assert.deepEqual(other.calls.map((c) => c.kind), ["reply"]);
  assert.match(JSON.stringify(other.calls[0].payload), /Chỉ người tìm/);
  assert.equal(app.jobs.active, 0);
});

test("startExtraYandex answers with the restarting notice while stopping", async () => {
  const app = makeApp();
  const res = responder();
  await startSearch(params("u1"), res.r, app);
  const code = /Mã: ([A-Z0-9]{6})/.exec(JSON.stringify(res.last()))![1];
  app.jobs.stopAccepting();
  const extra = responder();
  await startExtraYandex(code, "u1", extra.r, app);
  assert.deepEqual(extra.calls.map((c) => c.kind), ["reply"]);
  assert.match(JSON.stringify(extra.calls[0].payload), /khởi động lại/);
});

test("a throwing defer does not leak the job slot or the user", async () => {
  const app = makeApp();
  const res = responder();
  const r: Responder = { ...res.r, async defer() { throw new Error("boom"); } };
  await startSearch(params("u1"), r, app);
  assert.equal(app.jobs.active, 0);
  assert.equal(app.userLimits.checkStart("u1", "extra").ok, true);
});

test("a failing final edit keeps the result and is not replaced by the generic error", async () => {
  const app = makeApp();
  const res = responder();
  const r: Responder = { ...res.r, async edit(p) {
    if (JSON.stringify(p).includes("Mã: ")) throw new Error("discord down");
    await res.r.edit(p);
  } };
  await startSearch(params("u1"), r, app);
  assert.ok(!res.calls.some((c) => JSON.stringify(c.payload ?? "").includes("Có lỗi khi tìm")));
  assert.equal(app.jobs.active, 0);
});

test("cleanup runs when runSearch throws unexpectedly", async () => {
  const clock = fakeClock(1_000_000);
  const app = makeApp({ now: clock.now });
  const good = app.runner;
  app.runner = async () => { throw new Error("unexpected"); };
  const res = responder();
  await startSearch(params("u1"), res.r, app);
  assert.match(JSON.stringify(res.last()), /Có lỗi khi tìm/);
  assert.equal(app.jobs.active, 0);
  app.runner = good;
  clock.advance(60_000);
  const again = responder();
  await startSearch(params("u1"), again.r, app);
  assert.match(JSON.stringify(again.last()), /Mã: /);
});
