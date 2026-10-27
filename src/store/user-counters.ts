import type { Db } from "./db.ts";

export class UserCounters {
  private readonly db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  get(userId: string, day: string): { searches: number; yandex: number; yandexSerpapi: number } {
    const row = this.db
      .prepare("SELECT searches, yandex, yandex_serpapi FROM user_daily WHERE user_id = ? AND day = ?")
      .get(userId, day) as { searches: number; yandex: number; yandex_serpapi: number } | undefined;
    return {
      searches: row?.searches ?? 0,
      yandex: row?.yandex ?? 0,
      yandexSerpapi: row?.yandex_serpapi ?? 0,
    };
  }

  increment(userId: string, day: string, field: "searches" | "yandex" | "yandex_serpapi"): void {
    // field is a closed union, safe to interpolate as a column name
    this.db
      .prepare(
        `INSERT INTO user_daily (user_id, day, ${field}) VALUES (?, ?, 1)
         ON CONFLICT (user_id, day) DO UPDATE SET ${field} = ${field} + 1`,
      )
      .run(userId, day);
  }
}
