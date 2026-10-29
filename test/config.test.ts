import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError } from "../src/config.ts";
import { REQUIRED_ENV } from "./helpers.ts";

test("applies unlimited and zero-delay defaults and works with only Discord env vars", () => {
  const c = loadConfig({
    DISCORD_TOKEN: "test-token",
    DISCORD_APPLICATION_ID: "100",
    DISCORD_GUILD_ID: "200",
  });
  assert.equal(c.sqlitePath, "./data/bot.db");
  assert.equal(c.brightdataMonthlyCredits, 5000);
  assert.equal(c.serpapiMonthlySearches, 250);
  assert.equal(c.imageMaxBytes, 10485760);
  assert.equal(c.imageMaxPixels, 20000000);
  assert.equal(c.engineTimeoutMs, 15000);
  assert.equal(c.jobDeadlineMs, 60000);
  assert.equal(c.maxActiveJobs, 500);
  assert.equal(c.userCooldownMs, 0);
  assert.equal(c.userDailySearches, 1000000);
  assert.equal(c.userDailyYandex, 1000000);
  assert.equal(c.userDailyYandexSerpapi, 250);
  assert.equal(c.traceUnknownShare, 1);
  assert.equal(c.cacheHitTtlDays, 30);
  assert.equal(c.cacheMissTtlHours, 24);
  assert.equal(c.unlimitedGates, true);
  assert.equal(c.parallelSearch, true);
  assert.equal(c.allowConcurrentUserSearches, true);
});

test("parses multiple SauceNAO API keys from SAUCENAO_API_KEYS and SAUCENAO_API_KEY", () => {
  const c = loadConfig({
    ...REQUIRED_ENV,
    SAUCENAO_API_KEYS: "key1, key2",
    SAUCENAO_API_KEY: "key2, key3",
  });
  assert.deepEqual(c.saucenaoApiKeys, ["key1", "key2", "key3"]);
  assert.equal(c.saucenaoApiKey, "key1");
});

test("reports missing required Discord variables and never echoes values", () => {
  assert.throws(() => loadConfig({ DISCORD_TOKEN: "secret-token" }), (e: unknown) =>
    e instanceof ConfigError &&
    e.problems.includes("DISCORD_APPLICATION_ID") &&
    e.problems.includes("DISCORD_GUILD_ID") &&
    !e.message.includes("secret-token"));
});

test("rejects invalid numbers", () => {
  assert.throws(() => loadConfig({ ...REQUIRED_ENV, MAX_ACTIVE_JOBS: "abc" }), /MAX_ACTIVE_JOBS/);
  assert.throws(() => loadConfig({ ...REQUIRED_ENV, TRACE_UNKNOWN_SHARE: "1.5" }), /TRACE_UNKNOWN_SHARE/);
});
