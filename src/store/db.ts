import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(`
CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY, engine TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS attachment_hash (attachment_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS calls (provider TEXT NOT NULL, purpose TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS calls_provider_ts ON calls (provider, ts);
CREATE TABLE IF NOT EXISTS provider_state (key TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS user_daily (user_id TEXT NOT NULL, day TEXT NOT NULL, searches INTEGER NOT NULL DEFAULT 0, yandex INTEGER NOT NULL DEFAULT 0, yandex_serpapi INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, day));
`);
  return db;
}
