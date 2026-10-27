import { MessageFlags, PermissionFlagsBits, type Interaction, type MessageComponentInteraction } from "discord.js";
import type { App } from "../app.ts";
import type { Mode } from "../engines/types.ts";
import { extractCandidates, type ImageCandidate } from "../images/candidates.ts";
import { log } from "../log.ts";
import { newCode } from "../util/code.ts";
import { signedUrlExpiresAt } from "../util/discord-url.ts";
import { parseCustomId } from "./custom-id.ts";
import { msg } from "./messages.ts";
import { isNsfw } from "./nsfw.ts";
import { renderHelp, renderModeSelect, renderNotice, renderPickMenu, renderQuota } from "./render.ts";
import { commandResponder, updateResponder } from "./responders.ts";
import { startExtraYandex, startSearch, type Responder } from "./start-search.ts";

type MessageLike = { attachments: Map<string, any>; embeds: any[] };
const candidatesOf = (m: MessageLike) => extractCandidates({ attachments: [...m.attachments.values()], embeds: m.embeds });
const MODES: readonly string[] = ["auto", "anime", "art", "movie"];
const selected = (i: MessageComponentInteraction) => (i as unknown as { values: string[] }).values[0]!;

async function refetchCandidate(i: MessageComponentInteraction, channelId: string, messageId: string, index: number): Promise<ImageCandidate | undefined> {
  try {
    const channel = await i.client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return undefined;
    return candidatesOf(await channel.messages.fetch(messageId))[index];
  } catch (e) {
    log("warn", "refetch_failed", { error: e instanceof Error ? e.message : String(e) });
    return undefined;
  }
}

async function routeComponent(i: MessageComponentInteraction, app: App): Promise<void> {
  const r = commandResponder(i);
  const ref = parseCustomId(i.customId);
  if (!ref) return r.replyEphemeral(renderNotice(msg.sessionExpired));
  const userId = i.user.id;

  if (ref.kind === "pick") {
    const pick = app.picks.get(ref.key);
    if (!pick) return r.replyEphemeral(renderNotice(msg.sessionExpired));
    if (pick.ownerId !== userId) return r.replyEphemeral(renderNotice(msg.notOwner));
    const index = Number(selected(i));
    let candidate: ImageCandidate | undefined = pick.candidates[index];
    if (!candidate) return r.replyEphemeral(renderNotice(msg.sessionExpired));
    const expires = signedUrlExpiresAt(candidate.url);
    let responder: Responder = updateResponder(i);
    if (expires !== null && expires <= app.now()) {
      await i.deferUpdate();
      responder = {
        replyEphemeral: async (p) => { await i.followUp({ ...p, flags: MessageFlags.Ephemeral } as never); },
        defer: async () => {},
        edit: async (p) => { await i.editReply(p as never); },
      };
      candidate = await refetchCandidate(i, pick.channelId, pick.messageId, index);
      if (!candidate) return responder.edit(renderNotice(msg.imageFetch));
    }
    return startSearch({
      userId, guildId: pick.guildId, nsfwChannel: pick.nsfwChannel, ephemeral: true, mode: "auto",
      image: { url: candidate.url, attachmentId: candidate.attachmentId },
    }, responder, app);
  }

  const session = app.sessions.get(ref.key);
  if (!session) return r.replyEphemeral(renderNotice(msg.sessionExpired));
  if (session.ownerId !== userId) return r.replyEphemeral(renderNotice(msg.notOwner));
  switch (ref.kind) {
    case "mode":
      await i.update({ components: renderModeSelect(ref.key, session.outcome.mode) as never });
      return;
    case "modeSelect": {
      const mode = selected(i);
      if (!MODES.includes(mode)) return r.replyEphemeral(renderNotice(msg.sessionExpired));
      return startSearch({
        userId, guildId: session.guildId, nsfwChannel: session.nsfwChannel, ephemeral: session.ephemeral,
        mode: mode as Mode, image: session.image,
      }, updateResponder(i), app);
    }
    case "yandex":
      return startExtraYandex(ref.key, userId, updateResponder(i), app);
  }
}

async function routeInner(i: Interaction, app: App): Promise<void> {
  if (i.isChatInputCommand()) {
    const r = commandResponder(i);
    switch (i.commandName) {
      case "search": {
        const a = i.options.getAttachment("image", true);
        return startSearch({
          userId: i.user.id, guildId: i.guildId ?? "", nsfwChannel: isNsfw(i.channel),
          ephemeral: i.options.getBoolean("private") ?? false,
          mode: (i.options.getString("mode") ?? "auto") as Mode,
          image: { url: a.url, attachmentId: a.id },
        }, r, app);
      }
      case "quota":
        if (!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return r.replyEphemeral(renderNotice(msg.adminOnly));
        return r.replyEphemeral(renderQuota(app.gates.stats(), app.health.snapshot()));
      case "help":
        return r.replyEphemeral(renderHelp(app.config));
    }
    return;
  }
  if (i.isMessageContextMenuCommand()) {
    const r = commandResponder(i);
    const candidates = candidatesOf(i.targetMessage);
    if (candidates.length === 0) return r.replyEphemeral(renderNotice(msg.noImage));
    const nsfwChannel = isNsfw(i.channel);
    const guildId = i.guildId ?? "";
    if (candidates.length === 1) {
      const c = candidates[0]!;
      return startSearch({
        userId: i.user.id, guildId, nsfwChannel, ephemeral: true, mode: "auto",
        image: { url: c.url, attachmentId: c.attachmentId },
      }, r, app);
    }
    const pickId = newCode();
    app.picks.set(pickId, {
      ownerId: i.user.id, guildId, channelId: i.channelId, messageId: i.targetMessage.id, nsfwChannel,
      candidates, sizeBytes: JSON.stringify(candidates).length,
    });
    return r.replyEphemeral(renderPickMenu(pickId, candidates));
  }
  if (i.isMessageComponent()) await routeComponent(i, app);
}

export async function route(i: Interaction, app: App): Promise<void> {
  try {
    await routeInner(i, app);
  } catch (e) {
    log("error", "error", { flow: "route", error: e instanceof Error ? e.message : String(e) });
    try {
      const x = i as unknown as { deferred: boolean; replied: boolean; reply(p: unknown): Promise<unknown>; editReply(p: unknown): Promise<unknown> };
      const p = renderNotice(msg.genericError);
      if (x.deferred || x.replied) await x.editReply(p);
      else await x.reply({ ...p, flags: MessageFlags.Ephemeral });
    } catch (e2) {
      log("warn", "error_reply_failed", { error: e2 instanceof Error ? e2.message : String(e2) });
    }
  }
}
