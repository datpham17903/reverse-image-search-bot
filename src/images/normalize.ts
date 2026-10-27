import { createHash } from "node:crypto";
import sharp from "sharp";
import { ImageError } from "./download.ts";

export interface NormalizedImage { jpeg: Buffer; sha256: string; width: number; height: number }

const FORMATS = new Set(["jpeg", "png", "webp", "gif", "heif"]);

export async function normalizeImage(original: Buffer, maxPixels: number): Promise<NormalizedImage> {
  try {
    const img = sharp(original, { limitInputPixels: maxPixels });
    const meta = await img.metadata();
    if (!meta.format || !FORMATS.has(meta.format)) throw new ImageError("unsupported");
    const { data, info } = await img
      .rotate()
      .resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer({ resolveWithObject: true });
    return { jpeg: data, sha256: createHash("sha256").update(original).digest("hex"), width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new ImageError(/pixel limit/i.test(msg) ? "too_many_pixels" : "decode_failed", msg);
  }
}
