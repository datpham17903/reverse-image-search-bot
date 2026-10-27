import { downloadBytes, imageUrlArg, requireEnv, saveFixture } from "./lib.ts";

const { SAUCENAO_API_KEY } = requireEnv(["SAUCENAO_API_KEY"]);
const url = imageUrlArg();
const args = process.argv.slice(2);
const movies = args.includes("--movies");
const hideArg = args.find((a) => /^\d+$/.test(a));

const params = new URLSearchParams({ output_type: "2", numres: "8", api_key: SAUCENAO_API_KEY });
if (movies) params.set("dbmask", "25165824");
else params.set("db", "999");
if (hideArg !== undefined) params.set("hide", hideArg);

const form = new FormData();
form.set("file", new Blob([new Uint8Array(await downloadBytes(url))]), "image");
const res = await fetch(`https://saucenao.com/search.php?${params}`, { method: "POST", body: form });
const text = await res.text();

const name = movies ? "saucenao/search-movies.json" : `saucenao/search-hide${hideArg ?? ""}.json`;
console.log(`status=${res.status} saved=${saveFixture(name, text, [SAUCENAO_API_KEY])}`);

const json = JSON.parse(text) as {
  header?: Record<string, unknown>;
  results?: { header: Record<string, unknown> }[];
};
const h = json.header ?? {};
console.log(
  `short_limit=${h.short_limit} long_limit=${h.long_limit} short_remaining=${h.short_remaining} long_remaining=${h.long_remaining}`,
);
for (const r of json.results ?? []) {
  console.log(
    `index_id=${r.header.index_id} index_name=${r.header.index_name} similarity=${r.header.similarity} hidden=${r.header.hidden}`,
  );
}
