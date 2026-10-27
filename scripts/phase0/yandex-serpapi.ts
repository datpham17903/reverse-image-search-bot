import { imageUrlArg, requireEnv, saveFixture } from "./lib.ts";

const { SERPAPI_API_KEY } = requireEnv(["SERPAPI_API_KEY"]);
const url = imageUrlArg();

const res = await fetch(
  `https://serpapi.com/search.json?engine=yandex_images&url=${encodeURIComponent(url)}&api_key=${SERPAPI_API_KEY}`,
);
const text = await res.text();
saveFixture("yandex/serpapi.json", text, [SERPAPI_API_KEY]);
console.log(`status=${res.status}`);
try {
  console.log(`keys=${Object.keys(JSON.parse(text) as object).join(", ")}`);
} catch {
  console.log("non-JSON body");
}

const accRes = await fetch(`https://serpapi.com/account.json?api_key=${SERPAPI_API_KEY}`);
const acc = (await accRes.json()) as Record<string, unknown>;
saveFixture("yandex/serpapi-account.json", JSON.stringify({ ...acc, account_email: "REDACTED" }, null, 2), [
  SERPAPI_API_KEY,
]);
console.log(`total_searches_left=${acc.total_searches_left} this_month_usage=${acc.this_month_usage}`);
