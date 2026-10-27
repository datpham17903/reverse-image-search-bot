export interface AttachmentLike { id: string; url: string; name: string; contentType: string | null; width: number | null; height: number | null }
export interface EmbedLike { url: string | null; image: { proxyURL?: string | null } | null; thumbnail: { proxyURL?: string | null } | null }
export interface ImageCandidate { kind: "attachment" | "embed_image" | "embed_thumbnail"; url: string; attachmentId?: string; label: string; description: string }

const MAX_CANDIDATES = 25;
const IMAGE_NAME = /\.(png|gif|jpe?g|jfif|webp|avif)$/i;

function isImageAttachment(a: AttachmentLike): boolean {
  return (a.contentType?.startsWith("image/") ?? false) || IMAGE_NAME.test(a.name);
}

function hostOf(url: string | null): string {
  if (!url) return "";
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function extractCandidates(msg: { attachments: AttachmentLike[]; embeds: EmbedLike[] }): ImageCandidate[] {
  const out: Omit<ImageCandidate, "label">[] = [];
  for (const a of msg.attachments) {
    if (!isImageAttachment(a)) continue;
    const size = a.width && a.height ? ` · ${a.width}×${a.height}` : "";
    out.push({ kind: "attachment", url: a.url, attachmentId: a.id, description: `${a.name}${size}` });
  }
  for (const e of msg.embeds) {
    const desc = `ảnh xem trước của link ${hostOf(e.url)}`;
    if (e.image?.proxyURL) out.push({ kind: "embed_image", url: e.image.proxyURL, description: desc });
    if (e.thumbnail?.proxyURL) out.push({ kind: "embed_thumbnail", url: e.thumbnail.proxyURL, description: desc });
  }
  return out.slice(0, MAX_CANDIDATES).map((c, i) => ({
    ...c,
    label: `Ảnh ${i + 1}`,
    description: c.description.slice(0, 100),
  }));
}
