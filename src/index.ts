import { Client, Events, GatewayIntentBits } from "discord.js";
import { createApp } from "./app.ts";
import { ConfigError, loadConfig, type Config } from "./config.ts";
import { registerCommands } from "./discord/commands.ts";
import { route } from "./discord/router.ts";
import { createEngines } from "./engines/index.ts";
import { log } from "./log.ts";
import { openDb } from "./store/db.ts";

const TRACE_SYNC_MS = 600_000;
const HOUR_MS = 3_600_000;
const USAGE_RETENTION_MS = 40 * 86_400_000;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

let config: Config;
try {
  config = loadConfig(process.env);
} catch (e) {
  if (e instanceof ConfigError) {
    for (const p of e.problems) console.error(p);
    process.exit(1);
  }
  throw e;
}

const db = openDb(config.sqlitePath);
const { engines, traceMe, serpapiAccount } = createEngines(config, fetch);
const app = createApp({ config, db, engines });

const syncTrace = () => traceMe().then((me) => app.gates.noteTraceMe(me)).catch((e) => log("warn", "trace_sync_failed", { error: errMsg(e) }));
const syncSerpapi = () => serpapiAccount().then((a) => app.gates.noteSerpapiAccount(a)).catch((e) => log("warn", "serpapi_sync_failed", { error: errMsg(e) }));
await Promise.all([syncTrace(), syncSerpapi()]);

await registerCommands(config);

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.on(Events.InteractionCreate, (i) => {
  route(i, app).catch((e) => log("error", "error", { flow: "route", error: errMsg(e) }));
});

setInterval(syncTrace, TRACE_SYNC_MS).unref();
setInterval(syncSerpapi, HOUR_MS).unref();
setInterval(() => {
  try {
    app.cache.purgeExpired();
    app.usage.purgeBefore(app.now() - USAGE_RETENTION_MS);
  } catch (e) {
    log("warn", "purge_failed", { error: errMsg(e) });
  }
}, HOUR_MS).unref();

async function shutdown(): Promise<void> {
  app.jobs.stopAccepting();
  await app.jobs.drain(config.jobDeadlineMs);
  await client.destroy();
  db.close();
  process.exit(0);
}
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });

await client.login(config.discordToken);
log("info", "ready", {});
