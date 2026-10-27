import { downloadBytes, imageUrlArg, saveFixture } from "./lib.ts";

const url = imageUrlArg();

const meRes = await fetch("https://api.trace.moe/me");
const me = (await meRes.json()) as Record<string, unknown>;
saveFixture("tracemoe/me.json", JSON.stringify({ ...me, id: "REDACTED" }, null, 2), []);
console.log(`/me status=${meRes.status} quota=${me.quota} quotaUsed=${me.quotaUsed}`);

const bytes = await downloadBytes(url);
const imgRes = await fetch(url, { method: "HEAD" });
const contentType = imgRes.headers.get("content-type") ?? "image/jpeg";
const res = await fetch("https://api.trace.moe/search?anilistInfo&cutBorders=1", {
  method: "POST",
  headers: { "content-type": contentType },
  body: bytes,
});
const text = await res.text();
saveFixture("tracemoe/search.json", text, []);
let top: number | undefined;
try {
  const results = (JSON.parse(text) as { result?: { similarity: number }[] }).result ?? [];
  top = results.reduce<number | undefined>((m, r) => (m === undefined || r.similarity > m ? r.similarity : m), undefined);
} catch {
  // non-JSON body; status is printed below
}
console.log(`search status=${res.status} topSimilarity=${top}`);
