import type { EngineId, Match, Tier, TieredMatch } from "../engines/types.ts";

export const THRESHOLDS = {
  saucenao: { source: 90, maybe: 70 },
  tracemoe: { source: 0.92, maybe: 0.85 },
  danbooru: { source: 90, maybe: 70 },
  avscan: { source: 88, maybe: 82 },
} as const;

export const KNOWN_SOURCE_DOMAINS = [
  "pixiv.net", "x.com", "twitter.com", "danbooru.donmai.us", "gelbooru.com", "artstation.com", "deviantart.com",
  "imdb.com", "themoviedb.org", "myanimelist.net", "anilist.co",
  "yande.re", "konachan.com", "sankakucomplex.com", "e-hentai.org", "exhentai.org",
  "nhentai.net", "nhentai.to", "nhentai.xxx", "nhentai.com", "hitomi.la",
  "vi-hentai.net", "vi-hentai.moe", "vi-hentai.org", "vi-hentai.pro", "vi-hentai.com",
  "mimihentai.com", "hentaivn.tv", "hentaivn.moe", "hentaivn.fun", "hentaivn.la", "hentaicube.xyz",
  "sayhentai.tv", "sayhentai.me", "sayhentai.art",
  "imhentai.xxx", "hentaifox.com", "pururin.to", "3hentai.net", "asmhentai.com", "tsumino.com",
  "hentai2read.com", "luscious.net", "8muses.com", "multporn.net", "fakku.net", "doujins.com",
  "wnacg.com", "18comic.vip", "18comic.org", "manhwa18.cc", "manhwa18.com", "manhwa18.net",
  "kemono.su", "kemono.party", "coomer.su", "fantia.jp", "fanbox.cc", "dlsite.com", "fanza.co.jp", "dmm.co.jp",
  "nijie.info", "nicovideo.jp", "newgrounds.com", "rule34.xxx", "zerochan.net", "anime-pictures.net", "e-shuushuu.net",
  "booth.pm", "skeb.jp", "patreon.com", "bsky.app", "javdb.com", "javlibrary.com", "missav.com", "pornhub.com",
  "xvideos.com", "spankbang.com", "erome.com", "onlyfans.com", "reddit.com", "weibo.com", "bilibili.com",
  "shikimori.io", "shikimori.one", "anisearch.com", "anime-planet.com", "kitsu.app", "kitsu.io",
  "livechart.me", "bgm.tv", "bangumi.tv", "vndb.org", "crunchyroll.com", "otakomu.jp", "anitubu.com", "animeyt.cc",
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

const NSFW_HINT_RE = /nsfw|r-?18|18\+|hentai|ecchi|lewd|uncensored|decensored|rule34|nhentai|e-hentai|exhentai|hitomi\.la|vi-hentai|mimihentai|hentaivn|sayhentai|hentaicube|imhentai|hentaifox|pururin|3hentai|asmhentai|tsumino|hentai2read|luscious|8muses|multporn|fakku|doujins\.com|wnacg|18comic|manhwa18|gelbooru|yande\.re|sankaku|fanza|dlsite|kemono|coomer|fantia|missav|javdb|javlibrary|avscan|pornhub|xvideos|spankbang|onlyfans|erome/i;

const DOUJIN_HOST_RE = /(?:^|\.)(?:nhentai\.(?:net|to|xxx|com)|hitomi\.la|e-hentai\.org|exhentai\.org|vi-hentai\.(?:net|moe|org|pro|com)|mimihentai\.com|hentaivn\.(?:tv|moe|fun|la)|hentaicube\.xyz|sayhentai\.(?:tv|me|art)|imhentai\.xxx|hentaifox\.com|pururin\.to|3hentai\.net|asmhentai\.com|tsumino\.com|hentai2read\.com|luscious\.net|8muses\.com|multporn\.net|fakku\.net|doujins\.com|wnacg\.com|18comic\.(?:vip|org)|manhwa18\.(?:cc|com|net))$/i;

export function hasNsfwHint(m: Match): boolean {
  return NSFW_HINT_RE.test(m.url) || NSFW_HINT_RE.test(m.title) || (m.detail !== undefined && NSFW_HINT_RE.test(m.detail));
}

export function isDoujinMatch(m: Match): boolean {
  const host = hostOf(m);
  if (host && DOUJIN_HOST_RE.test(host)) return true;
  if (m.detail && /(?:Mã #\d+|Hitomi #\d+)/i.test(m.detail)) return true;
  return false;
}

export function tierAll(matches: Match[]): TieredMatch[] {
  const out: TieredMatch[] = [];
  for (const m of matches) {
    const tier = classify(m);
    if (tier) {
      const adult = m.adult === true || hasNsfwHint(m) ? true : m.adult;
      out.push({ ...m, adult, tier });
    }
  }
  return out;
}
