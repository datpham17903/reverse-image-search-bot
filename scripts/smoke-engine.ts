import { downloadImage } from "../src/images/download.ts";
import { normalizeImage } from "../src/images/normalize.ts";
import { classify } from "../src/search/tiers.ts";
import { createTraceMoe } from "../src/engines/tracemoe.ts";
import type { Engine, ProviderId } from "../src/engines/types.ts";

const TIMEOUT_MS = 15_000;
const MAX_BYTES = Number(process.env.IMAGE_MAX_BYTES ?? 10485760);
const MAX_PIXELS = Number(process.env.IMAGE_MAX_PIXELS ?? 20000000);

const [engineName, url] = process.argv.slice(2);
if (!engineName || !url) {
  console.error("usage: node --env-file-if-exists=.env scripts/smoke-engine.ts <engine> <discord image url>");
  process.exit(2);
}

function build(name: string): { engine: Engine; provider: ProviderId } {
  switch (name) {
    case "tracemoe": return { engine: createTraceMoe({ fetch }), provider: "tracemoe" };
    default: throw new Error(`unknown engine: ${name}`);
  }
}

const { engine, provider } = build(engineName);
const original = await downloadImage(url, { maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS });
const norm = await normalizeImage(original, MAX_PIXELS);
const res = await engine.search({
  image: { url, sha256: norm.sha256, jpeg: async () => norm.jpeg },
  mode: "auto", nsfwChannel: false, signal: AbortSignal.timeout(TIMEOUT_MS),
}, provider);

console.log(`status: ${res.status} sent: ${res.sent}`);
for (const m of res.matches) console.log(`[${classify(m) ?? "none"}] ${m.score ?? "-"} ${m.title} | ${m.detail ?? ""} | ${m.url}`);
