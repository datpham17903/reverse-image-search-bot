interface ChannelLike { isThread?: () => boolean; nsfw?: boolean; parent?: { nsfw?: boolean } | null }

export function isNsfw(channel: unknown): boolean {
  if (!channel || typeof channel !== "object") return false;
  const c = channel as ChannelLike;
  if (typeof c.isThread === "function" && c.isThread()) return c.parent?.nsfw === true;
  return c.nsfw === true;
}
