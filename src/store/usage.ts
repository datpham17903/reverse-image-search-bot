import type { CallPurpose, ProviderId } from "../engines/types.ts";
import type { Db } from "./db.ts";

export class UsageStore {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  record(provider: ProviderId, purpose: CallPurpose, ts: number): void {
    this.db.prepare("INSERT INTO calls (provider, purpose, ts) VALUES (?, ?, ?)").run(provider, purpose, ts);
  }

  count(provider: ProviderId, fromTs: number, toTs: number, purpose?: CallPurpose): number {
    const row = (purpose === undefined
      ? this.db.prepare("SELECT COUNT(*) AS n FROM calls WHERE provider = ? AND ts >= ? AND ts < ?").get(provider, fromTs, toTs)
      : this.db
          .prepare("SELECT COUNT(*) AS n FROM calls WHERE provider = ? AND ts >= ? AND ts < ? AND purpose = ?")
          .get(provider, fromTs, toTs, purpose)) as { n: number };
    return Number(row.n);
  }

  purgeBefore(ts: number): void {
    this.db.prepare("DELETE FROM calls WHERE ts < ?").run(ts);
  }

  getState<T>(key: string): { value: T; updatedAt: number } | undefined {
    const row = this.db.prepare("SELECT json, updated_at FROM provider_state WHERE key = ?").get(key) as
      | { json: string; updated_at: number }
      | undefined;
    return row && { value: JSON.parse(row.json) as T, updatedAt: row.updated_at };
  }

  setState(key: string, value: unknown, now: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO provider_state (key, json, updated_at) VALUES (?, ?, ?)")
      .run(key, JSON.stringify(value), now);
  }
}
