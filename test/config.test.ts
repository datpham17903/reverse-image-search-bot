import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, ConfigError } from "../src/config.ts";
import { REQUIRED_ENV } from "./helpers.ts";

test("applies spec defaults", () => {
  const c = loadConfig(REQUIRED_ENV);
  assert.equal(c.sqlitePath, "./data/bot.db");
  assert.equal(c.brightdataMonthlyCredits, 5000);
  assert.equal(c.serpapiMonthlySearches, 250);
  assert.equal(c.imageMaxBytes, 10485760);
  assert.equal(c.imageMaxPixels, 20000000);
  assert.equal(c.engineTimeoutMs, 15000);
  assert.equal(c.jobDeadlineMs, 60000);
  assert.equal(c.maxActiveJobs, 100);
  assert.equal(c.userCooldownMs, 10000);
  assert.equal(c.userDailySearches, 30);
  assert.equal(c.userDailyYandex, 10);
  assert.equal(c.userDailyYandexSerpapi, 2);
  assert.equal(c.traceUnknownShare, 0.5);
  assert.equal(c.cacheHitTtlDays, 30);
  assert.equal(c.cacheMissTtlHours, 24);
});

test("reports every missing required variable and never echoes values", () => {
  assert.throws(() => loadConfig({ DISCORD_TOKEN: "secret-token" }), (e: unknown) =>
    e instanceof ConfigError &&
    e.problems.includes("DISCORD_APPLICATION_ID") &&
    e.problems.includes("DANBOORU_USER_ID") &&
    !e.message.includes("secret-token"));
});

test("rejects invalid numbers", () => {
  assert.throws(() => loadConfig({ ...REQUIRED_ENV, MAX_ACTIVE_JOBS: "abc" }), /MAX_ACTIVE_JOBS/);
  assert.throws(() => loadConfig({ ...REQUIRED_ENV, TRACE_UNKNOWN_SHARE: "1.5" }), /TRACE_UNKNOWN_SHARE/);
});
