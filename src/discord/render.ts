import { ButtonStyle, ComponentType, type APIEmbed } from "discord.js";
import type { Config } from "../config.ts";
import { ENGINE_LABEL, type EngineId, type Match, type Mode, type ProviderId, type Tier, type TieredMatch } from "../engines/types.ts";
import type { ImageCandidate } from "../images/candidates.ts";
import type { ImageErrorCode } from "../images/download.ts";
import type { ProviderStats } from "../limits/gates.ts";
import type { DeepLink } from "../search/deeplinks.ts";
import type { Progress, SearchOutcome } from "../search/orchestrator.ts";
import { customId } from "./custom-id.ts";
import { imageErrorText, MODE_LABEL, msg, reason, TIER_LABEL } from "./messages.ts";

export interface Payload { content?: string; embeds: APIEmbed[]; components: unknown[]; allowedMentions: { parse: [] } }
export interface RenderContext { nsfwChannel: boolean; remainingSearches: number; deepLinks: DeepLink[]; showYandexButton: boolean }

const DESCRIPTION_MAX = 4096;
const TITLE_MAX = 256;
const COLOR = { notFound: 0x80848e, incomplete: 0xf0b232, progress: 0x5865f2 };
const TIER_COLOR: Record<Tier, number> = { source: 0x23a55a, maybe: 0xf0b232, related: 0x80848e };
const MODES: Mode[] = ["auto", "anime", "art", "movie"];
const PROVIDER_LABEL: Record<ProviderId, string> = {
  tracemoe: "trace.moe", saucenao: "SauceNAO", danbooru: "Danbooru", iqdb: "IQDB",
  yandex_direct: "Yandex Direct", brightdata: "Bright Data", serpapi: "SerpApi",
};

const payload = (embeds: APIEmbed[], components: unknown[] = [], content?: string): Payload =>
  ({ ...(content === undefined ? {} : { content }), embeds, components, allowedMentions: { parse: [] } });

export function escapeMd(text: string): string {
  return text.replace(/[\\*_~`|>[\]()#]/g, "\\$&");
}

function safeUrl(url: string | undefined): string | null {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  return url.replace(/\)/g, "%29").replace(/\s/g, "%20");
}

const mdLink = (text: string, url: string | undefined): string => {
  const u = safeUrl(url);
  return u ? `[${text}](${u})` : text;
};

export function previewAllowed(m: Match, nsfwChannel: boolean): boolean {
  if (nsfwChannel) return true;
  switch (m.engine) {
    case "yandex": return false;
    case "danbooru": return m.rating === "g";
    case "tracemoe": return m.adult === false;
    case "saucenao": return m.adult !== true;
  }
}

function pct(m: Match): string | null {
  if (m.score === undefined) return null;
  if (m.engine === "tracemoe") return `${Math.round(m.score * 100)}%`;
  if (m.engine === "saucenao" || m.engine === "danbooru") return `${Math.round(m.score)}%`;
  return null;
}

const joinParts = (parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).join(" · ");
const engineList = (ids: EngineId[]): string => [...new Set(ids)].map(e => ENGINE_LABEL[e]).join(", ");

function detailLine(m: Match, nsfwChannel: boolean): string {
  const p = pct(m);
  return joinParts([
    m.detail && escapeMd(m.detail),
    p && `khớp ${p}`,
    ENGINE_LABEL[m.engine],
    previewAllowed(m, nsfwChannel) && safeUrl(m.videoUrl) && mdLink(msg.watchClip, m.videoUrl),
  ]);
}

function candidateLine(i: number, m: TieredMatch, withTier: boolean): string {
  const p = pct(m);
  return `${i}. ${joinParts([
    mdLink(escapeMd(m.title), m.url),
    m.detail && escapeMd(m.detail),
    p ? `${p} ${ENGINE_LABEL[m.engine]}` : ENGINE_LABEL[m.engine],
    withTier && TIER_LABEL[m.tier].toLowerCase(),
  ])}`;
}

const deepLinkLine = (links: DeepLink[]): string =>
  `**${msg.searchYourself}** ${links.map(l => `[${l.name}](${l.url})`).join(" · ")}`;

// Ghép các khối; vượt giới hạn thì bỏ link tự tìm từ cuối, rồi bỏ dòng ứng viên từ cuối.
function fitDescription(head: string[], candidates: string[], candidatesHeader: string | null, links: DeepLink[]): string {
  const build = (nLinks: number, nCand: number): string => {
    const blocks = [...head];
    if (nCand > 0) blocks.push([...(candidatesHeader ? [candidatesHeader] : []), ...candidates.slice(0, nCand)].join("\n"));
    if (nLinks > 0) blocks.push(deepLinkLine(links.slice(0, nLinks)));
    return blocks.filter(Boolean).join("\n\n");
  };
  let nLinks = links.length;
  let nCand = candidates.length;
  while (nLinks > 0 && build(nLinks, nCand).length > DESCRIPTION_MAX) nLinks--;
  while (nCand > 0 && build(nLinks, nCand).length > DESCRIPTION_MAX) nCand--;
  return build(nLinks, nCand).slice(0, DESCRIPTION_MAX);
}

function buttonRow(code: string, showYandex: boolean): unknown[] {
  const button = (label: string, id: string) => ({ type: ComponentType.Button, style: ButtonStyle.Secondary, label, custom_id: id });
  return [{
    type: ComponentType.ActionRow,
    components: [
      button(msg.changeMode, customId({ kind: "mode", key: code })),
      ...(showYandex ? [button(msg.moreYandex, customId({ kind: "yandex", key: code }))] : []),
    ],
  }];
}

export function renderProgress(p: Progress, deadlineSec: number): Payload {
  const lines = [
    p.done.length > 0 ? msg.progressDone(engineList(p.done)) : null,
    p.current ? msg.progressAsking(ENGINE_LABEL[p.current]) : null,
  ].filter((l): l is string => l !== null);
  return payload([{
    author: { name: msg.searching }, color: COLOR.progress, description: lines.join("\n"),
    footer: { text: msg.progressMax(deadlineSec) },
  }]);
}

export function renderOutcome(o: SearchOutcome, ctx: RenderContext): Payload {
  const searched = o.outcomes.filter(x => x.status === "ok" || x.status === "no_match").map(x => x.engine);
  const searchedText = engineList(searched) || "–";
  const footer = { text: msg.footer(searchedText, ctx.remainingSearches, o.code) };
  const components = buttonRow(o.code, ctx.showYandexButton);

  if (o.state === "found" && o.main) {
    const main = o.main;
    const candidates = o.others.map((m, i) => candidateLine(i + 2, m, true));
    const embed: APIEmbed = {
      author: { name: TIER_LABEL[main.tier] }, color: TIER_COLOR[main.tier],
      title: escapeMd(main.title).slice(0, TITLE_MAX),
      description: fitDescription([detailLine(main, ctx.nsfwChannel)], candidates, `**${msg.others}**`, ctx.deepLinks),
      footer,
    };
    const url = safeUrl(main.url);
    if (url) embed.url = url;
    const preview = previewAllowed(main, ctx.nsfwChannel) ? safeUrl(main.previewUrl) : null;
    if (preview) embed.image = { url: preview };
    return payload([embed], components);
  }

  if (o.state === "incomplete") {
    const reasons = o.outcomes.filter(x => x.status !== "ok" && x.status !== "no_match")
      .map(x => `${ENGINE_LABEL[x.engine]}: ${reason(x.status)}`).join("\n");
    const related = o.tiered.filter(m => m.tier === "related").map((m, i) => candidateLine(i + 1, m, false));
    return payload([{
      author: { name: msg.incomplete }, color: COLOR.incomplete,
      description: fitDescription([reasons], related, null, ctx.deepLinks), footer,
    }], components);
  }

  return payload([{
    author: { name: msg.notFound }, color: COLOR.notFound,
    description: fitDescription([msg.notFoundBody(searchedText)], [], null, ctx.deepLinks), footer,
  }], components);
}

const withLinks = (text: string, deepLinks: DeepLink[] = []): string =>
  deepLinks.length > 0 ? `${text}\n\n${deepLinkLine(deepLinks)}` : text;

const round1 = (n: number): number => Math.round(n * 10) / 10;

export function renderImageError(code: ImageErrorCode, cfg: Pick<Config, "imageMaxBytes" | "imageMaxPixels">, deepLinks: DeepLink[]): Payload {
  const text = imageErrorText(code, round1(cfg.imageMaxBytes / 1048576), round1(cfg.imageMaxPixels / 1_000_000));
  return renderNotice(text, deepLinks);
}

export function renderNotice(text: string, deepLinks?: DeepLink[]): Payload {
  return payload([{ description: withLinks(text, deepLinks).slice(0, DESCRIPTION_MAX) }]);
}

export function renderPickMenu(pickId: string, candidates: ImageCandidate[]): Payload {
  const shown = candidates.slice(0, 25);
  return payload([], [{
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.StringSelect, custom_id: customId({ kind: "pick", key: pickId }), placeholder: msg.pickPlaceholder,
      options: shown.map((c, i) => ({ label: c.label.slice(0, 100), description: c.description.slice(0, 100), value: String(i) })),
    }],
  }], msg.pickPrompt(candidates.length));
}

export function renderModeSelect(code: string, current: Mode): unknown[] {
  return [{
    type: ComponentType.ActionRow,
    components: [{
      type: ComponentType.StringSelect, custom_id: customId({ kind: "modeSelect", key: code }), placeholder: msg.changeMode,
      options: MODES.map(m => ({ label: MODE_LABEL[m], value: m, default: m === current })),
    }],
  }];
}

export function renderQuota(stats: ProviderStats[], health: Record<string, { healthy: boolean }>): Payload {
  const lines = stats.map(s => {
    const status = s.blocked ? "hết lượt"
      : s.provider === "brightdata" && health[s.provider]?.healthy === false ? "đang tạm chuyển sang SerpApi"
      : "bình thường";
    const label = `**${PROVIDER_LABEL[s.provider]}**`;
    if (s.provider === "tracemoe") return `${label} · 24 giờ ${s.usedPeriod}/${s.periodLimit ?? "–"} · ${status}`;
    if (s.provider === "saucenao" || s.provider === "danbooru" || s.provider === "iqdb" || s.provider === "yandex_direct") {
      const left = s.remaining !== undefined ? ` · còn ${s.remaining}` : "";
      return `${label} · hôm nay ${s.usedToday}${left} · ${status}`;
    }
    return `${label} · hôm nay ${s.usedToday}/${s.allowanceToday ?? "–"} · tháng ${s.usedPeriod}/${s.periodLimit ?? "–"} · ${status}`;
  });
  return payload([{ description: lines.join("\n") }]);
}

export function renderHelp(cfg: Pick<Config, "userDailySearches" | "userDailyYandex">): Payload {
  const lines = [
    "**Cách dùng**",
    "• `/search` rồi tải ảnh lên. Chọn chế độ: Tự động, Cảnh anime, Art / tranh, Phim người đóng. Thêm `private` để chỉ mình bạn thấy kết quả.",
    "• Hoặc bấm chuột phải vào tin nhắn có ảnh, chọn Apps, rồi chọn \"Tìm nguồn ảnh\".",
    `Hạn mức: ${cfg.userDailySearches} lượt/ngày, trong đó ${cfg.userDailyYandex} lượt Yandex.`,
    msg.privacy,
  ];
  return payload([{ description: lines.join("\n") }]);
}
