import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDiscordImageUrl } from "../../src/util/discord-url.ts";

const FIXTURES_DIR = join(import.meta.dirname, "..", "..", "test", "fixtures");

export function requireEnv(names: string[]): Record<string, string> {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length > 0) {
    console.error(`Missing env vars: ${missing.join(", ")}`);
    process.exit(1);
  }
  return Object.fromEntries(names.map((n) => [n, process.env[n] as string]));
}

export function saveFixture(relPath: string, body: string, secrets: string[]): string {
  let out = body;
  for (const s of secrets) if (s) out = out.split(s).join("REDACTED");
  const path = join(FIXTURES_DIR, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  return path;
}

export async function downloadBytes(url: string): Promise<Buffer> {
  if (!isDiscordImageUrl(url)) throw new Error(`Not a Discord image URL: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

export function imageUrlArg(): string {
  const url = process.argv.slice(2).find((a) => a.startsWith("http"));
  if (!url || !isDiscordImageUrl(url)) {
    console.error("Usage: <script> <discord image url> (cdn.discordapp.com or media.discordapp.net)");
    process.exit(1);
  }
  return url;
}
