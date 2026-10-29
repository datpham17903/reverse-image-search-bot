import type { YandexSite } from "./types.ts";

export class YandexParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YandexParseError";
  }
}

// PROVISIONAL: written without a real Bright Data page. Rewrite extractSites once the real fixture exists.
const ENTITIES: Record<string, string> = { "&quot;": '"', "&amp;": "&", "&#39;": "'", "&apos;": "'", "&lt;": "<", "&gt;": ">" };
const unescapeHtml = (s: string) => s.replace(/&(quot|amp|#39|apos|lt|gt);/g, (m) => ENTITIES[m] ?? m);

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

function toSite(title: unknown, url: unknown, thumb: unknown, description?: unknown): YandexSite | null {
  if (typeof title !== "string" || !title.trim() || typeof url !== "string" || !/^https?:\/\//i.test(url)) return null;
  if (!hostname(url)) return null;
  const t = typeof thumb === "string" && /^(https?:)?\/\//i.test(thumb) ? thumb.replace(/^\/\//, "https://") : undefined;
  const desc = typeof description === "string" && description.trim() ? description.trim() : undefined;
  return { title, url, domain: hostname(url), ...(t ? { thumbnailUrl: t } : {}), ...(desc ? { description: desc } : {}) };
}

// Extracts site matches from both legacy data-state.sites and modern initialState.cbirSites structures.
function extractCandidateSites(state: unknown): unknown[] | null {
  if (!state || typeof state !== "object") return null;
  const s = state as Record<string, any>;
  if (Array.isArray(s.sites)) return s.sites;
  if (Array.isArray(s.cbirSites?.sites)) return s.cbirSites.sites;
  const init = s.initialState as Record<string, any> | undefined;
  if (init && typeof init === "object") {
    const a = Array.isArray(init.cbirSites?.sites) ? init.cbirSites.sites : null;
    const b = Array.isArray(init.cbirSitesList?.sites) ? init.cbirSitesList.sites : null;
    if (a && a.length > 0) return a;
    if (b && b.length > 0) return b;
    if (a || b) return [];
  }
  return null;
}

function sitesFromState(html: string): YandexSite[] | null {
  let foundEmpty = false;
  for (const m of html.matchAll(/data-state=(?:"([^"]*)"|'([^']*)')/g)) {
    let state: unknown;
    try { state = JSON.parse(unescapeHtml(m[1] ?? m[2] ?? "")); } catch { continue; }
    const sites = extractCandidateSites(state);
    if (!sites) continue;
    const out: YandexSite[] = [];
    for (const s of sites as Record<string, any>[]) {
      const site = toSite(s?.title, s?.url, s?.thumb?.url ?? s?.thumb ?? s?.originalImage?.url, s?.description);
      if (site) out.push(site);
    }
    if (out.length > 0) return out;
    foundEmpty = true;
  }
  return foundEmpty ? [] : null;
}

function sitesFromDom(html: string): YandexSite[] | null {
  const out: YandexSite[] = [];
  let anchors = 0;
  for (const m of html.matchAll(/<a\b[^>]*class="[^"]*CbirSites-ItemTitle[^"]*"[^>]*>[\s\S]*?<\/a>/g)) {
    anchors++;
    const href = /href="([^"]*)"/.exec(m[0])?.[1];
    const title = unescapeHtml(m[0].replace(/<[^>]*>/g, "").trim());
    const site = toSite(title, href && unescapeHtml(href), undefined);
    if (site) out.push(site);
  }
  return anchors > 0 ? out : null;
}

function extractSites(html: string): YandexSite[] {
  const sites = sitesFromState(html) ?? sitesFromDom(html);
  if (!sites) throw new YandexParseError("no sites container");
  return sites;
}

export function parseYandexSites(html: string): YandexSite[] {
  if (/showcaptcha|SmartCaptcha/i.test(html)) throw new YandexParseError("captcha page");
  if (!html.includes("CbirSites") && !html.includes("cbirSites")) throw new YandexParseError("unrecognized page");
  return extractSites(html);
}
