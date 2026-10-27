import { z } from "zod";

export interface Config {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  saucenaoApiKey: string;
  danbooruLogin: string;
  danbooruApiKey: string;
  danbooruUserId: string;
  brightdataApiKey: string;
  brightdataZone: string;
  serpapiApiKey: string;
  sqlitePath: string;
  brightdataMonthlyCredits: number;
  serpapiMonthlySearches: number;
  imageMaxBytes: number;
  imageMaxPixels: number;
  engineTimeoutMs: number;
  jobDeadlineMs: number;
  maxActiveJobs: number;
  userCooldownMs: number;
  userDailySearches: number;
  userDailyYandex: number;
  userDailyYandexSerpapi: number;
  cacheHitTtlDays: number;
  cacheMissTtlHours: number;
  traceUnknownShare: number;
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration: ${problems.join(", ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

const required = z.string().min(1);
const positiveInt = (def: number) => z.coerce.number().int().positive().default(def);

const schema = z.object({
  DISCORD_TOKEN: required,
  DISCORD_APPLICATION_ID: required,
  DISCORD_GUILD_ID: required,
  SAUCENAO_API_KEY: required,
  DANBOORU_LOGIN: required,
  DANBOORU_API_KEY: required,
  DANBOORU_USER_ID: required,
  BRIGHTDATA_API_KEY: required,
  BRIGHTDATA_ZONE: required,
  SERPAPI_API_KEY: required,
  SQLITE_PATH: z.string().min(1).default("./data/bot.db"),
  BRIGHTDATA_MONTHLY_CREDITS: positiveInt(5000),
  SERPAPI_MONTHLY_SEARCHES: positiveInt(250),
  IMAGE_MAX_BYTES: positiveInt(10485760),
  IMAGE_MAX_PIXELS: positiveInt(20000000),
  ENGINE_TIMEOUT_MS: positiveInt(15000),
  JOB_DEADLINE_MS: positiveInt(60000),
  MAX_ACTIVE_JOBS: positiveInt(100),
  USER_COOLDOWN_MS: positiveInt(10000),
  USER_DAILY_SEARCHES: positiveInt(30),
  USER_DAILY_YANDEX: positiveInt(10),
  USER_DAILY_YANDEX_SERPAPI: positiveInt(2),
  TRACE_UNKNOWN_SHARE: z.coerce.number().min(0).max(1).default(0.5),
  CACHE_HIT_TTL_DAYS: positiveInt(30),
  CACHE_MISS_TTL_HOURS: positiveInt(24),
});

export function loadConfig(env: Record<string, string | undefined>): Config {
  // Empty strings count as unset so a blank line in .env falls back to the default.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ""));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const names = new Set<string>();
    for (const issue of parsed.error.issues) names.add(String(issue.path[0]));
    throw new ConfigError([...names]);
  }
  const e = parsed.data;
  return {
    discordToken: e.DISCORD_TOKEN,
    discordApplicationId: e.DISCORD_APPLICATION_ID,
    discordGuildId: e.DISCORD_GUILD_ID,
    saucenaoApiKey: e.SAUCENAO_API_KEY,
    danbooruLogin: e.DANBOORU_LOGIN,
    danbooruApiKey: e.DANBOORU_API_KEY,
    danbooruUserId: e.DANBOORU_USER_ID,
    brightdataApiKey: e.BRIGHTDATA_API_KEY,
    brightdataZone: e.BRIGHTDATA_ZONE,
    serpapiApiKey: e.SERPAPI_API_KEY,
    sqlitePath: e.SQLITE_PATH,
    brightdataMonthlyCredits: e.BRIGHTDATA_MONTHLY_CREDITS,
    serpapiMonthlySearches: e.SERPAPI_MONTHLY_SEARCHES,
    imageMaxBytes: e.IMAGE_MAX_BYTES,
    imageMaxPixels: e.IMAGE_MAX_PIXELS,
    engineTimeoutMs: e.ENGINE_TIMEOUT_MS,
    jobDeadlineMs: e.JOB_DEADLINE_MS,
    maxActiveJobs: e.MAX_ACTIVE_JOBS,
    userCooldownMs: e.USER_COOLDOWN_MS,
    userDailySearches: e.USER_DAILY_SEARCHES,
    userDailyYandex: e.USER_DAILY_YANDEX,
    userDailyYandexSerpapi: e.USER_DAILY_YANDEX_SERPAPI,
    cacheHitTtlDays: e.CACHE_HIT_TTL_DAYS,
    cacheMissTtlHours: e.CACHE_MISS_TTL_HOURS,
    traceUnknownShare: e.TRACE_UNKNOWN_SHARE,
  };
}
