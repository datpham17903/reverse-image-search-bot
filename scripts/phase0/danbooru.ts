import { imageUrlArg, requireEnv, saveFixture } from "./lib.ts";

const env = requireEnv(["DANBOORU_LOGIN", "DANBOORU_API_KEY", "DANBOORU_USER_ID"]);
const url = imageUrlArg();

const res = await fetch(
  `https://danbooru.donmai.us/iqdb_queries.json?url=${encodeURIComponent(url)}&limit=5`,
  {
    headers: {
      authorization: `Basic ${Buffer.from(`${env.DANBOORU_LOGIN}:${env.DANBOORU_API_KEY}`).toString("base64")}`,
      "user-agent": `TimNguonBot/1.0 (user #${env.DANBOORU_USER_ID})`,
    },
  },
);
const text = await res.text();
saveFixture("danbooru/iqdb.json", text, [env.DANBOORU_API_KEY]);

console.log(`status=${res.status} x-rate-limit=${res.headers.get("x-rate-limit")}`);
try {
  const items = JSON.parse(text) as { score?: number; post?: { rating?: string } }[];
  for (const it of items) console.log(`score=${it.score} rating=${it.post?.rating}`);
} catch {
  console.log("non-JSON body");
}
