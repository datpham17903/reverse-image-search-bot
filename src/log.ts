import { stripQuery } from "./util/discord-url.ts";

const SECRET_KEY = /token|key|secret|password|authorization/i;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.startsWith("http") ? stripQuery(value) : value;
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? "[redacted]" : redact(v)]),
    );
  }
  return value;
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as object) }));
}
