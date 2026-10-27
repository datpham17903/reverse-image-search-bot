import { MessageFlags, type ChatInputCommandInteraction, type MessageComponentInteraction, type MessageContextMenuCommandInteraction } from "discord.js";
import type { Responder } from "./start-search.ts";

type Replyable = ChatInputCommandInteraction | MessageContextMenuCommandInteraction | MessageComponentInteraction;

export function commandResponder(i: Replyable): Responder {
  return {
    replyEphemeral: async (p) => { await i.reply({ ...p, flags: MessageFlags.Ephemeral } as never); },
    defer: async (e) => { await i.deferReply(e ? { flags: MessageFlags.Ephemeral } : {}); },
    edit: async (p) => { await i.editReply(p as never); },
  };
}

export function updateResponder(i: MessageComponentInteraction): Responder {
  return {
    ...commandResponder(i),
    defer: async () => { await i.deferUpdate(); },
  };
}
