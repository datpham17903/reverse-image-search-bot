import type { Config } from "../config.ts";
import type { ImageSource } from "../engines/types.ts";
import type { ResultCache } from "../store/cache.ts";
import { downloadImage } from "./download.ts";
import { normalizeImage } from "./normalize.ts";

export interface LoadedImage extends ImageSource { bytesInMemory(): number }

const DOWNLOAD_TIMEOUT_MS = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function loadImage(
  input: { url: string; attachmentId?: string },
  deps: { cache: ResultCache; config: Config; now: () => number; fetch?: typeof fetch },
): Promise<LoadedImage> {
  const { cache, config } = deps;
  const fetchNormalized = async () => {
    const raw = await downloadImage(input.url, { maxBytes: config.imageMaxBytes, timeoutMs: DOWNLOAD_TIMEOUT_MS, fetch: deps.fetch });
    return normalizeImage(raw, config.imageMaxPixels);
  };

  const known = input.attachmentId ? cache.getAttachmentHash(input.attachmentId) : undefined;
  if (known) {
    let pending: Promise<Buffer> | undefined;
    let loaded = 0;
    return {
      url: input.url,
      sha256: known,
      jpeg() {
        pending ??= fetchNormalized().then(
          (n) => { loaded = n.jpeg.length; return n.jpeg; },
          (e) => { pending = undefined; throw e; },
        );
        return pending;
      },
      bytesInMemory: () => loaded,
    };
  }

  const n = await fetchNormalized();
  if (input.attachmentId) cache.putAttachmentHash(input.attachmentId, n.sha256, 30 * DAY_MS);
  return { url: input.url, sha256: n.sha256, jpeg: async () => n.jpeg, bytesInMemory: () => n.jpeg.length };
}
