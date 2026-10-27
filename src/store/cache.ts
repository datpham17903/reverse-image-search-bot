import type { EngineId } from "../engines/types.ts";
import type { Db } from "./db.ts";

export class ResultCache {
  private readonly db: Db;
  private readonly now: () => number;
  constructor(db: Db, now: () => number) {
    this.db = db;
    this.now = now;
  }

  get(key: string): { engine: EngineId; status: "ok" | "no_match"; payload: string } | undefined {
    const row = this.db
      .prepare("SELECT engine, status, payload FROM cache WHERE key = ? AND expires_at > ?")
      .get(key, this.now()) as { engine: EngineId; status: "ok" | "no_match"; payload: string } | undefined;
    return row && { engine: row.engine, status: row.status, payload: row.payload };
  }

  put(key: string, engine: EngineId, status: "ok" | "no_match", payload: string, ttlMs: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO cache (key, engine, status, payload, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(key, engine, status, payload, this.now() + ttlMs);
  }

  getAttachmentHash(id: string): string | undefined {
    const row = this.db
      .prepare("SELECT sha256 FROM attachment_hash WHERE attachment_id = ? AND expires_at > ?")
      .get(id, this.now()) as { sha256: string } | undefined;
    return row?.sha256;
  }

  putAttachmentHash(id: string, sha256: string, ttlMs: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO attachment_hash (attachment_id, sha256, expires_at) VALUES (?, ?, ?)")
      .run(id, sha256, this.now() + ttlMs);
  }

  purgeExpired(): number {
    const now = this.now();
    const a = this.db.prepare("DELETE FROM cache WHERE expires_at <= ?").run(now);
    const b = this.db.prepare("DELETE FROM attachment_hash WHERE expires_at <= ?").run(now);
    return Number(a.changes) + Number(b.changes);
  }
}
