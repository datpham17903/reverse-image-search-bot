export interface DeepLink { name: string; url: string }

const TEMPLATES: ReadonlyArray<readonly [string, string]> = [
  ["Yandex", "https://yandex.com/images/search?rpt=imageview&url={u}"],
  ["SauceNAO", "https://saucenao.com/search.php?url={u}"],
  ["Google Lens", "https://lens.google.com/uploadbyurl?url={u}"],
  ["trace.moe", "https://trace.moe/?url={u}"],
  ["IQDB", "https://iqdb.org/?url={u}"],
  ["ascii2d", "https://ascii2d.net/search/url/{u}"],
  ["Bing", "https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:{u}"],
  ["TinEye", "https://tineye.com/search?url={u}"],
];

export function buildDeepLinks(imageUrl: string): DeepLink[] {
  const u = encodeURIComponent(imageUrl);
  return TEMPLATES.map(([name, tpl]) => ({ name, url: tpl.replace("{u}", u) }));
}
