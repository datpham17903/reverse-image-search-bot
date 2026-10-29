import { loadConfig, type Config } from "../src/config.ts";

export const REQUIRED_ENV: Record<string, string> = {
  DISCORD_TOKEN: "test-token",
  DISCORD_APPLICATION_ID: "100",
  DISCORD_GUILD_ID: "200",
  SAUCENAO_API_KEY: "test-saucenao",
  DANBOORU_LOGIN: "test-login",
  DANBOORU_API_KEY: "test-danbooru",
  DANBOORU_USER_ID: "300",
  BRIGHTDATA_API_KEY: "test-brightdata",
  BRIGHTDATA_ZONE: "test-zone",
  SERPAPI_API_KEY: "test-serpapi",
};

export function testConfig(over: Partial<Config> = {}): Config {
  return {
    ...loadConfig(REQUIRED_ENV),
    maxActiveJobs: 100,
    userCooldownMs: 10000,
    userDailySearches: 30,
    userDailyYandex: 10,
    userDailyYandexSerpapi: 2,
    traceUnknownShare: 0.5,
    unlimitedGates: false,
    parallelSearch: false,
    allowConcurrentUserSearches: false,
    ...over,
  };
}

export function fakeClock(start = 0): { now(): number; set(t: number): void; advance(ms: number): void } {
  let t = start;
  return {
    now: () => t,
    set: (v) => { t = v; },
    advance: (ms) => { t += ms; },
  };
}
