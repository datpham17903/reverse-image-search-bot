import { isDiscordImageUrl } from "../util/discord-url.ts";

export type ImageErrorCode = "not_allowed" | "too_large" | "fetch_failed" | "decode_failed" | "too_many_pixels" | "unsupported";

export class ImageError extends Error {
  readonly code: ImageErrorCode;
  constructor(code: ImageErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ImageError";
    this.code = code;
  }
}

export async function downloadImage(url: string, o: { maxBytes: number; timeoutMs: number; fetch?: typeof fetch }): Promise<Buffer> {
  if (!isDiscordImageUrl(url)) throw new ImageError("not_allowed");
  const doFetch = o.fetch ?? fetch;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), o.timeoutMs);
  try {
    const res = await doFetch(url, { redirect: "manual", signal: ctl.signal });
    if (res.status < 200 || res.status >= 300) throw new ImageError("fetch_failed", `HTTP ${res.status}`);
    const len = Number(res.headers.get("content-length"));
    if (Number.isFinite(len) && len > o.maxBytes) throw new ImageError("too_large");
    if (!res.body) throw new ImageError("fetch_failed", "empty body");
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > o.maxBytes) {
        await reader.cancel();
        throw new ImageError("too_large");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("fetch_failed", e instanceof Error ? e.message : String(e));
  } finally {
    clearTimeout(timer);
  }
}
