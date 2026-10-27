import { downloadImage } from "../src/images/download.ts";
import { normalizeImage } from "../src/images/normalize.ts";
import { classify } from "../src/search/tiers.ts";
import { createTraceMoe } from "../src/engines/tracemoe.ts";
import { createSauceNao } from "../src/engines/saucenao.ts";
import { createDanbooru } from "../src/engines/danbooru.ts";
import { yandexViaSerpApi } from "../src/engines/yandex/serpapi.ts";
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
    case "saucenao": {
      const apiKey = process.env.SAUCENAO_API_KEY;
      if (!apiKey) throw new Error("SAUCENAO_API_KEY is required");
      return { engine: createSauceNao({ fetch, apiKey }), provider: "saucenao" };
    }
    case "danbooru": {
      const { DANBOORU_LOGIN: login, DANBOORU_API_KEY: apiKey, DANBOORU_USER_ID: userId } = process.env;
      if (!login || !apiKey || !userId) throw new Error("DANBOORU_LOGIN, DANBOORU_API_KEY and DANBOORU_USER_ID are required");
      return { engine: createDanbooru({ fetch, login, apiKey, userId }), provider: "danbooru" };
    }
    default: throw new Error(`unknown engine: ${name}`);
  }
}

if (engineName === "yandex-serpapi") {
  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) throw new Error("SERPAPI_API_KEY is required");
  const r = await yandexViaSerpApi(url, { fetch, apiKey, signal: AbortSignal.timeout(TIMEOUT_MS) });
  console.log(`status: ${r.status} sent: ${r.sent}`);
  for (const m of r.matches) console.log(`${m.title} | ${m.domain ?? ""} | ${m.url}`);
  process.exit(0);
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
