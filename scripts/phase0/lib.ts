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

// Discord signed-URL params (ex, is, hm) in plain, percent-encoded and HTML-escaped (&amp;) forms.
const SIGNED_PARAM = /((?:[?&;]|%3F|%26)(?:ex|is|hm)(?:=|%3D))[0-9a-f]+/gi;

export function saveFixture(relPath: string, body: string, secrets: string[]): string {
  let out = body;
  for (const s of secrets) if (s) out = out.split(s).join("REDACTED");
  out = out.replace(SIGNED_PARAM, "$1REDACTED");
  const path = join(FIXTURES_DIR, relPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out);
  return path;
}

export async function downloadBytes(url: string): Promise<Buffer> {
  if (!isDiscordImageUrl(url)) {
    let shown = "<invalid url>";
    try {
      const u = new URL(url);
      shown = u.origin + u.pathname;
    } catch {
      // keep placeholder
    }
    throw new Error(`Not a Discord image URL: ${shown}`);
  }
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
