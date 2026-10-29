import type { EngineId, Match, Tier, TieredMatch } from "../engines/types.ts";

export const THRESHOLDS = {
  saucenao: { source: 90, maybe: 70 },
  tracemoe: { source: 0.92, maybe: 0.85 },
  danbooru: { source: 90, maybe: 70 },
} as const;

export const KNOWN_SOURCE_DOMAINS = [
  "pixiv.net", "x.com", "twitter.com", "danbooru.donmai.us", "gelbooru.com", "artstation.com", "deviantart.com",
  "imdb.com", "themoviedb.org", "myanimelist.net", "anilist.co",
  "yande.re", "konachan.com", "sankakucomplex.com", "e-hentai.org", "exhentai.org", "nhentai.net", "hitomi.la",
  "kemono.su", "kemono.party", "coomer.su", "fantia.jp", "fanbox.cc", "dlsite.com", "fanza.co.jp", "dmm.co.jp",
  "nijie.info", "nicovideo.jp", "newgrounds.com", "rule34.xxx", "zerochan.net", "anime-pictures.net", "e-shuushuu.net",
  "booth.pm", "skeb.jp", "patreon.com", "bsky.app", "javdb.com", "javlibrary.com", "missav.com", "pornhub.com",
  "xvideos.com", "spankbang.com", "erome.com", "onlyfans.com", "reddit.com", "weibo.com", "bilibili.com",
];

function hostOf(m: Match): string | null {
  if (m.domain) return m.domain.toLowerCase();
  try { return new URL(m.url).hostname.toLowerCase(); } catch { return null; }
}

export function classify(m: Match): Tier | null {
  if (m.engine === "yandex") {
    const host = hostOf(m);
    const known = host !== null && KNOWN_SOURCE_DOMAINS.some(d => host === d || host.endsWith(`.${d}`));
    return known ? "maybe" : "related";
  }
  if (m.score === undefined) return null;
  const th = THRESHOLDS[m.engine as Exclude<EngineId, "yandex">];
  if (m.score >= th.source) return "source";
  if (m.score >= th.maybe) return "maybe";
  return null;
}

export function tierAll(matches: Match[]): TieredMatch[] {
  const out: TieredMatch[] = [];
  for (const m of matches) {
    const tier = classify(m);
    if (tier) out.push({ ...m, tier });
  }
  return out;
}
