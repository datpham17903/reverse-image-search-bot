import type { Mode } from "../engines/types.ts";
import { ImageError } from "../images/download.ts";
import type { LoadedImage } from "../images/load.ts";
import { log } from "../log.ts";
import { buildDeepLinks } from "../search/deeplinks.ts";
import { runExtraYandex, runSearch, type SearchOutcome } from "../search/orchestrator.ts";
import { newCode } from "../util/code.ts";
import type { App } from "../app.ts";
import { msg } from "./messages.ts";
import { renderImageError, renderNotice, renderOutcome, renderProgress, type Payload } from "./render.ts";

export interface Responder { replyEphemeral(p: Payload): Promise<void>; defer(ephemeral: boolean): Promise<void>; edit(p: Payload): Promise<void> }
export interface StartSearchParams {
  userId: string; guildId: string; nsfwChannel: boolean; ephemeral: boolean; mode: Mode;
  image: { url: string; attachmentId?: string } | LoadedImage;
}

const isLoaded = (i: StartSearchParams["image"]): i is LoadedImage => "sha256" in i;

function showYandexButton(app: App, userId: string, outcome: SearchOutcome): boolean {
  const done = outcome.outcomes.some((o) => o.engine === "yandex" && (o.status === "ok" || o.status === "no_match"));
  return app.yandexAvailable(userId) && !done;
}

function outcomePayload(app: App, userId: string, nsfwChannel: boolean, image: LoadedImage, outcome: SearchOutcome): Payload {
  return renderOutcome(outcome, {
    nsfwChannel, remainingSearches: app.userLimits.remainingSearches(userId),
    deepLinks: buildDeepLinks(image.url), showYandexButton: showYandexButton(app, userId, outcome),
  });
}

function logSearchDone(o: SearchOutcome, nsfw: boolean, durationMs: number): void {
  const pick = (m: { engine: string; tier: string; score?: number; url: string }) =>
    ({ engine: m.engine, tier: m.tier, score: m.score, url: m.url });
  log("info", "search_done", {
    code: o.code, mode: o.mode, nsfw,
    engines: o.outcomes.map((e) => ({
      engine: e.engine, status: e.status, via: e.via, fromCache: e.fromCache ?? false,
      scores: e.matches.map((m) => m.score),
    })),
    tiers: o.tiered.map((m) => ({ engine: m.engine, tier: m.tier })),
    main: o.main ? pick(o.main) : undefined,
    others: o.others.map(pick),
    durationMs,
  });
}

async function safeEdit(r: Responder, p: Payload): Promise<void> {
  try {
    await r.edit(p);
  } catch (e) {
    log("warn", "edit_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}

export async function startSearch(p: StartSearchParams, r: Responder, app: App): Promise<void> {
  const { userId } = p;
  const receivedAt = app.now();
  const links = buildDeepLinks(p.image.url);

  if (app.jobs.stopping) return r.replyEphemeral(renderNotice(msg.restarting));
  const check = app.userLimits.checkStart(userId, "search");
  if (!check.ok) {
    switch (check.reason) {
      case "cooldown": return r.replyEphemeral(renderNotice(msg.cooldown(check.waitSec)));
      case "daily_limit": return r.replyEphemeral(renderNotice(msg.dailyLimit(app.config.userDailySearches), links));
      case "active": return r.replyEphemeral(renderNotice(msg.active));
    }
  }
  if (!app.jobs.tryStart()) return r.replyEphemeral(renderNotice(msg.busy, links));

  app.userLimits.begin(userId, "search");
  try {
    await r.defer(p.ephemeral);
    let image: LoadedImage;
    if (isLoaded(p.image)) image = p.image;
    else {
      try {
        image = await app.loadImage(p.image);
      } catch (e) {
        if (e instanceof ImageError) return await r.edit(renderImageError(e.code, app.config, links));
        throw e;
      }
    }
    const code = newCode();
    const deadlineSec = Math.ceil(app.config.jobDeadlineMs / 1000);
    const outcome = await runSearch({
      code, guildId: p.guildId, userId, mode: p.mode, nsfwChannel: p.nsfwChannel, image,
      deadlineAt: receivedAt + app.config.jobDeadlineMs,
      onProgress: (pr) => safeEdit(r, renderProgress(pr, deadlineSec)),
    }, app.runner);
    app.sessions.set(code, {
      code, ownerId: userId, guildId: p.guildId, nsfwChannel: p.nsfwChannel, ephemeral: p.ephemeral,
      image, outcome, sizeBytes: image.bytesInMemory(),
    });
    await r.edit(outcomePayload(app, userId, p.nsfwChannel, image, outcome));
    logSearchDone(outcome, p.nsfwChannel, app.now() - receivedAt);
  } catch (e) {
    log("error", "error", { flow: "search", error: e instanceof Error ? e.message : String(e) });
    await safeEdit(r, renderNotice(msg.genericError, links));
  } finally {
    app.userLimits.end(userId);
    app.jobs.finish();
  }
}

export async function startExtraYandex(code: string, userId: string, r: Responder, app: App): Promise<void> {
  const session = app.sessions.get(code);
  if (!session) return r.replyEphemeral(renderNotice(msg.sessionExpired));
  const check = app.userLimits.checkStart(userId, "extra");
  if (!check.ok) return r.replyEphemeral(renderNotice(msg.active));
  if (!app.yandexAvailable(userId)) return r.replyEphemeral(renderNotice(msg.yandexUnavailable));
  if (!app.jobs.tryStart()) return r.replyEphemeral(renderNotice(msg.busy, buildDeepLinks(session.image.url)));

  const receivedAt = app.now();
  app.userLimits.begin(userId, "extra");
  try {
    await r.defer(session.ephemeral);
    const outcome = await runExtraYandex(session.outcome, {
      code, guildId: session.guildId, userId, mode: session.outcome.mode, nsfwChannel: session.nsfwChannel,
      image: session.image, deadlineAt: receivedAt + app.config.jobDeadlineMs,
    }, app.runner);
    app.sessions.set(code, { ...session, outcome, sizeBytes: session.image.bytesInMemory() });
    await r.edit(outcomePayload(app, userId, session.nsfwChannel, session.image, outcome));
  } catch (e) {
    log("error", "error", { flow: "extra_yandex", error: e instanceof Error ? e.message : String(e) });
    await safeEdit(r, renderNotice(msg.genericError, buildDeepLinks(session.image.url)));
  } finally {
    app.userLimits.end(userId);
    app.jobs.finish();
  }
}
