import { test } from "node:test";
import assert from "node:assert/strict";
import type { Interaction } from "discord.js";
import { PermissionFlagsBits } from "discord.js";
import { createApp, type App } from "../src/app.ts";
import { route } from "../src/discord/router.ts";
import { msg } from "../src/discord/messages.ts";
import { openDb } from "../src/store/db.ts";
import type { LoadedImage } from "../src/images/load.ts";
import type { Engine, EngineId } from "../src/engines/types.ts";
import { testConfig } from "./helpers.ts";

const image = (url: string): LoadedImage => ({ url, sha256: url, jpeg: async () => Buffer.alloc(10), bytesInMemory: () => 10 });

function makeApp() {
  const loaded: string[] = [];
  let searched = 0;
  const mk = (id: EngineId): Engine => ({
    id, providers: [id === "yandex" ? "brightdata" : id], version: 1, cacheParams: () => "x",
    async search() { searched++; return { status: "no_match", matches: [], sent: true }; },
  });
  const app = createApp({
    config: testConfig(), db: openDb(":memory:"),
    engines: { tracemoe: mk("tracemoe"), saucenao: mk("saucenao"), danbooru: mk("danbooru"), yandex: mk("yandex") },
    loadImage: async (i) => { loaded.push(i.url); return image(i.url); },
  });
  return { app, loaded, searched: () => searched };
}

function fake(over: Record<string, unknown>) {
  const calls: { method: string; arg: any }[] = [];
  const rec = (method: string) => async (arg?: unknown) => { calls.push({ method, arg }); };
  const i = {
    user: { id: "u1" }, guildId: "g", channelId: "c", channel: { nsfw: false },
    isChatInputCommand: () => false, isMessageContextMenuCommand: () => false, isMessageComponent: () => false,
    reply: rec("reply"), deferReply: rec("deferReply"), editReply: rec("editReply"), update: rec("update"), deferUpdate: rec("deferUpdate"),
    ...over,
  };
  return { i: i as unknown as Interaction, calls };
}

const session = (app: App, code: string, ownerId: string) =>
  app.sessions.set(code, {
    code, ownerId, guildId: "g", nsfwChannel: false, ephemeral: false, image: image("https://cdn.discordapp.com/a.png"),
    outcome: { code, mode: "auto", outcomes: [], tiered: [], others: [] } as any, sizeBytes: 10,
  });

const att = (id: string, url: string) => ({ id, url, name: `${id}.png`, contentType: "image/png", width: 1, height: 1 });
const text = (c: { arg: any }) => c.arg.embeds[0].description as string;

test("stale or foreign component: ephemeral notice, no quota or counters touched", async () => {
  const { app, searched } = makeApp();
  const stale = fake({ isMessageComponent: () => true, customId: "y:NOPE", user: { id: "u2" } });
  await route(stale.i, app);
  assert.equal(stale.calls.length, 1);
  assert.equal(stale.calls[0]!.method, "reply");
  assert.ok(text(stale.calls[0]!).includes(msg.sessionExpired));
  assert.notEqual(stale.calls[0]!.arg.flags, undefined);

  session(app, "ABC", "u1");
  const foreign = fake({ isMessageComponent: () => true, customId: "y:ABC", user: { id: "u2" } });
  await route(foreign.i, app);
  assert.equal(foreign.calls.length, 1);
  assert.ok(text(foreign.calls[0]!).includes(msg.notOwner));
  assert.equal(app.userLimits.remainingSearches("u2"), app.config.userDailySearches);
  assert.equal(searched(), 0);
});

test("context menu without images replies noImage", async () => {
  const { app } = makeApp();
  const f = fake({ isMessageContextMenuCommand: () => true, targetMessage: { id: "m", attachments: new Map(), embeds: [] } });
  await route(f.i, app);
  assert.equal(f.calls.length, 1);
  assert.ok(text(f.calls[0]!).includes(msg.noImage));
});

test("context menu with several images replies a pick menu", async () => {
  const { app } = makeApp();
  const f = fake({ isMessageContextMenuCommand: () => true, targetMessage: { id: "m", attachments: new Map([["1", att("1", "https://cdn.discordapp.com/1.png")], ["2", att("2", "https://cdn.discordapp.com/2.png")]]), embeds: [] } });
  await route(f.i, app);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.method, "reply");
  assert.equal(f.calls[0]!.arg.components.length, 1);
  assert.ok(f.calls[0]!.arg.components[0].components[0].custom_id.startsWith("p:"));
});

test("pick with an expired signed URL refetches the message", async () => {
  const { app, loaded } = makeApp();
  const oldUrl = "https://cdn.discordapp.com/1.png?ex=1&is=2&hm=3";
  const newUrl = "https://cdn.discordapp.com/1.png?ex=ffffffffff&is=2&hm=4";
  app.picks.set("PICK1", {
    ownerId: "u1", guildId: "g", channelId: "c", messageId: "m", nsfwChannel: false, sizeBytes: 10,
    candidates: [{ kind: "attachment", url: oldUrl, attachmentId: "1", label: "Ảnh 1", description: "d" }],
  });
  const fetched: string[] = [];
  const f = fake({
    isMessageComponent: () => true, customId: "p:PICK1", values: ["0"],
    client: { channels: { fetch: async (id: string) => ({ isTextBased: () => true, messages: { fetch: async (mid: string) => {
      fetched.push(`${id}/${mid}`);
      return { id: mid, attachments: new Map([["1", att("1", newUrl)]]), embeds: [] };
    } } }) } },
  });
  await route(f.i, app);
  assert.deepEqual(fetched, ["c/m"]);
  assert.deepEqual(loaded, [newUrl]);
});

test("/quota without Manage Server is refused", async () => {
  const { app } = makeApp();
  const denied = fake({ isChatInputCommand: () => true, commandName: "quota", memberPermissions: { has: () => false } });
  await route(denied.i, app);
  assert.ok(text(denied.calls[0]!).includes(msg.adminOnly));
  let asked: unknown;
  const ok = fake({ isChatInputCommand: () => true, commandName: "quota", memberPermissions: { has: (p: unknown) => { asked = p; return true; } } });
  await route(ok.i, app);
  assert.equal(asked, PermissionFlagsBits.ManageGuild);
  assert.ok(!text(ok.calls[0]!).includes(msg.adminOnly));
});

const pickApp = (app: App, owner = "u1") => app.picks.set("PICK2", {
  ownerId: owner, guildId: "g", channelId: "c", messageId: "m", nsfwChannel: false, sizeBytes: 10,
  candidates: [{ kind: "attachment", url: "https://cdn.discordapp.com/1.png", attachmentId: "1", label: "Ảnh 1", description: "d" }],
});

test("pick refetch acks with deferUpdate before fetching the message", async () => {
  const { app } = makeApp();
  app.picks.set("PICK3", {
    ownerId: "u1", guildId: "g", channelId: "c", messageId: "m", nsfwChannel: false, sizeBytes: 10,
    candidates: [{ kind: "attachment", url: "https://cdn.discordapp.com/1.png?ex=1&is=2&hm=3", attachmentId: "1", label: "Ảnh 1", description: "d" }],
  });
  let f: ReturnType<typeof fake>;
  f = fake({
    isMessageComponent: () => true, customId: "p:PICK3", values: ["0"],
    client: { channels: { fetch: async () => ({ isTextBased: () => true, messages: { fetch: async () => {
      f.calls.push({ method: "messages.fetch", arg: undefined });
      throw new Error("gone");
    } } }) } },
  });
  await route(f.i, app);
  assert.deepEqual(f.calls.map((c) => c.method), ["deferUpdate", "messages.fetch", "editReply"]);
  assert.ok(text(f.calls[2]!).includes(msg.imageFetch));
});

test("pick by a non-owner is refused with no side effects", async () => {
  const { app, loaded, searched } = makeApp();
  pickApp(app, "u1");
  const f = fake({ isMessageComponent: () => true, customId: "p:PICK2", values: ["0"], user: { id: "u2" } });
  await route(f.i, app);
  assert.equal(f.calls.length, 1);
  assert.ok(text(f.calls[0]!).includes(msg.notOwner));
  assert.deepEqual(loaded, []);
  assert.equal(searched(), 0);
});

test("context menu with exactly one image starts an ephemeral auto search", async () => {
  const { app, loaded } = makeApp();
  const url = "https://cdn.discordapp.com/1.png";
  const f = fake({ isMessageContextMenuCommand: () => true, targetMessage: { id: "m", attachments: new Map([["1", att("1", url)]]), embeds: [] } });
  await route(f.i, app);
  assert.equal(f.calls[0]!.method, "deferReply");
  assert.notEqual(f.calls[0]!.arg.flags, undefined);
  assert.deepEqual(loaded, [url]);
});

test("mode button updates with the mode select", async () => {
  const { app } = makeApp();
  session(app, "ABC", "u1");
  const f = fake({ isMessageComponent: () => true, customId: "m:ABC" });
  await route(f.i, app);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.method, "update");
  assert.ok(f.calls[0]!.arg.components[0].components[0].custom_id.startsWith("ms:ABC"));
});

test("mode select re-searches with the chosen mode and session image", async () => {
  const { app, loaded, searched } = makeApp();
  session(app, "ABC", "u1");
  const f = fake({ isMessageComponent: () => true, customId: "ms:ABC", values: ["anime"] });
  await route(f.i, app);
  assert.equal(f.calls[0]!.method, "deferUpdate");
  assert.deepEqual(loaded, []);
  assert.ok(searched() > 0);
  assert.equal(f.calls.at(-1)!.method, "editReply");
});

test("invalid mode value is rejected without searching", async () => {
  const { app, searched } = makeApp();
  session(app, "ABC", "u1");
  const f = fake({ isMessageComponent: () => true, customId: "ms:ABC", values: ["bogus"] });
  await route(f.i, app);
  assert.equal(searched(), 0);
  assert.equal(f.calls[0]!.method, "reply");
});

test("yandex button goes through startExtraYandex", async () => {
  const { app } = makeApp();
  session(app, "ABC", "u1");
  const f = fake({ isMessageComponent: () => true, customId: "y:ABC" });
  await route(f.i, app);
  assert.equal(f.calls[0]!.method, "deferUpdate");
});

test("a throwing handler answers with the generic notice", async () => {
  const { app } = makeApp();
  app.gates.stats = () => { throw new Error("boom"); };
  const f = fake({ isChatInputCommand: () => true, commandName: "quota", memberPermissions: { has: () => true } });
  await route(f.i, app);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.method, "reply");
  assert.ok(text(f.calls[0]!).includes(msg.genericError));

  const g = fake({ isChatInputCommand: () => true, commandName: "quota", memberPermissions: { has: () => true }, deferred: true });
  await route(g.i, app);
  assert.equal(g.calls[0]!.method, "editReply");
});
