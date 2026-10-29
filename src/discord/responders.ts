import { MessageFlags, type ChatInputCommandInteraction, type MessageComponentInteraction, type MessageContextMenuCommandInteraction } from "discord.js";
import type { Payload } from "./render.ts";
import type { Responder } from "./start-search.ts";

type Replyable = ChatInputCommandInteraction | MessageContextMenuCommandInteraction | MessageComponentInteraction;

// Downloads the preview thumbnail and attaches it directly to the Discord message so it renders
// simultaneously with the embed. In SFW channels, NSFW or unrated previews are attached as SPOILER_preview.jpg.
async function withInlinePreview(p: Payload): Promise<Record<string, unknown>> {
  const embed = p.embeds?.[0];
  const spoilerUrl = (p as { spoilerPreviewUrl?: string }).spoilerPreviewUrl;
  const imgUrl = spoilerUrl ?? embed?.image?.url;
  if (!embed || !imgUrl || !/^https?:\/\//i.test(imgUrl)) return p as unknown as Record<string, unknown>;
  try {
    const res = await fetch(imgUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return p as unknown as Record<string, unknown>;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 8 * 1024 * 1024) return p as unknown as Record<string, unknown>;
    if (spoilerUrl) {
      const { image: _omit, ...restEmbed } = embed;
      return {
        ...p,
        embeds: [restEmbed, ...p.embeds.slice(1)],
        files: [{ attachment: buf, name: "SPOILER_preview.jpg" }],
      };
    }
    return {
      ...p,
      embeds: [{ ...embed, image: { url: "attachment://preview.jpg" } }, ...p.embeds.slice(1)],
      files: [{ attachment: buf, name: "preview.jpg" }],
    };
  } catch {
    return p as unknown as Record<string, unknown>;
  }
}

export function commandResponder(i: Replyable): Responder {
  return {
    replyEphemeral: async (p) => { await i.reply({ ...p, flags: MessageFlags.Ephemeral } as never); },
    defer: async (e) => { await i.deferReply(e ? { flags: MessageFlags.Ephemeral } : {}); },
    edit: async (p) => { await i.editReply((await withInlinePreview(p)) as never); },
  };
}

export function updateResponder(i: MessageComponentInteraction): Responder {
  return {
    ...commandResponder(i),
    defer: async () => { await i.deferUpdate(); },
  };
}
