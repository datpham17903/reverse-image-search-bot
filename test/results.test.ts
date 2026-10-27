import { test } from "node:test";
import assert from "node:assert/strict";
import type { EngineId, Match, Tier, TieredMatch } from "../src/engines/types.ts";
import { classify, tierAll } from "../src/search/tiers.ts";
import { pickResults } from "../src/search/select.ts";
import { buildDeepLinks } from "../src/search/deeplinks.ts";

const m = (engine: EngineId, score?: number): Match => ({ engine, title: "t", url: `https://x/${engine}/${score}`, score, adult: null });
const t = (engine: EngineId, tier: Tier, score?: number, url?: string): TieredMatch => ({ ...m(engine, score), tier, ...(url ? { url } : {}) });

test("thresholds", () => {
  assert.equal(classify(m("saucenao", 90)), "source"); assert.equal(classify(m("saucenao", 89.9)), "maybe");
  assert.equal(classify(m("saucenao", 70)), "maybe"); assert.equal(classify(m("saucenao", 69.9)), null);
  assert.equal(classify(m("tracemoe", 0.92)), "source"); assert.equal(classify(m("tracemoe", 0.9199)), "maybe");
  assert.equal(classify(m("tracemoe", 0.85)), "maybe"); assert.equal(classify(m("tracemoe", 0.8499)), null);
  assert.equal(classify(m("danbooru", 90)), "source"); assert.equal(classify(m("danbooru", 69)), null);
  assert.equal(classify(m("saucenao")), null);
});

test("yandex is never source", () => {
  const y = (domain: string): Match => ({ engine: "yandex", title: "t", url: `https://${domain}/a`, domain, adult: null });
  assert.equal(classify(y("www.pixiv.net")), "maybe");
  assert.equal(classify(y("pixiv.net.evil.com")), "related");
  assert.equal(classify(y("example.com")), "related");
});

test("yandex falls back to url hostname", () => {
  assert.equal(classify({ engine: "yandex", title: "t", url: "https://x.com/a", adult: null }), "maybe");
});

test("tierAll drops null", () => {
  const r = tierAll([m("saucenao", 95), m("saucenao", 10)]);
  assert.equal(r.length, 1); assert.equal(r[0].tier, "source");
});

test("pickResults orders and dedupes", () => {
  const r = pickResults([
    t("saucenao", "maybe", 80, "https://a/1"),
    t("tracemoe", "maybe", 0.9, "https://a/2"),
    t("saucenao", "maybe", 85, "https://a/3"),
    t("yandex", "related", undefined, "https://a/4"),
    t("danbooru", "source", 95, "https://a/5"),
    t("saucenao", "maybe", 99, "https://a/3"),
  ]);
  assert.equal(r.main?.url, "https://a/5");
  assert.deepEqual(r.others.map(x => x.url), ["https://a/2", "https://a/3"]);
  assert.deepEqual(pickResults([]), { main: undefined, others: [] });
});

test("deep links order and encoding", () => {
  const l = buildDeepLinks("https://cdn.discordapp.com/a.png?ex=1&hm=2");
  assert.deepEqual(l.map(x => x.name), ["Yandex", "SauceNAO", "Google Lens", "trace.moe", "IQDB", "ascii2d", "Bing", "TinEye"]);
  assert.equal(l[0].url, "https://yandex.com/images/search?rpt=imageview&url=https%3A%2F%2Fcdn.discordapp.com%2Fa.png%3Fex%3D1%26hm%3D2");
});
