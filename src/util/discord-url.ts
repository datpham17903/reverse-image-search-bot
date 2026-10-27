const HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net"]);
// Discord's external-image proxy shards.
const EXT_PROXY = /^images-ext-\d+\.discordapp\.net$/;

export function isDiscordImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (HOSTS.has(u.hostname) || EXT_PROXY.test(u.hostname));
  } catch {
    return false;
  }
}

export function signedUrlExpiresAt(url: string): number | null {
  try {
    const ex = new URL(url).searchParams.get("ex");
    if (!ex || !/^[0-9a-f]+$/i.test(ex)) return null;
    return parseInt(ex, 16) * 1000;
  } catch {
    return null;
  }
}

export function stripQuery(url: string): string {
  const i = url.indexOf("?");
  return i === -1 ? url : url.slice(0, i);
}
