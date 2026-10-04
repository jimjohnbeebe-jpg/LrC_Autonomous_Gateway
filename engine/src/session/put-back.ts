// The HUD's Put back, reported to the engine (GitHub issue #59, PR C step 2b, plugin 0.13.0): the plugin
// applied the session's pre-session snapshot itself (plugin\LrC-AVG.lrplugin\HudClick.lua) and sends
// hud_put_back with its outcome, at once or at its next connection to the engine. On "done" the engine
// ends that session as reverted: no write or export runs after it (the running operation stops before
// its next one, io.ts checkAbort), the log says outcome "revert", ended_by the HUD, and later calls
// naming the session answer SESSION_ENDED (the lead's review of 79e6e91, 2026-10-03). The engine
// writes nothing here: it only reads the photo to log how it is. [handle: tests\hud-put-back.test.ts,
// against the Lightroom sim; in Lightroom [unverified] until Jim's next HUD check.]

import { differingSettings } from "../params/index.js";
import type { ActionHost, UserAction } from "./hud-actions.js";
import { userEnded } from "./hud-actions.js";
import { wakeApproval } from "./approval.js";
import { ms, saveLog } from "./io.js";
import type { Session, UserEnd } from "./types.js";

export const PUT_BACK_NOTE = "Put back: the photo is back as it was before the edit; this edit is over.";

/** A hud_put_back event for the open session; returns the HUD's note. */
export function putBackReported(host: ActionHost, s: Session, a: Extract<UserAction, { name: "hud_put_back" }>): string {
  if (a.payload.outcome !== "done") return "Put back did not go through; the edit is still open.";
  const p = a.payload;
  const by: UserEnd = { source: p.source, click_id: p.click_id, received: a.received, t0: a.t0, state: "pending", interrupted: s.abort?.interrupted ?? null };
  s.abort ??= by; // refuses writes and exports from now on
  wakeApproval(s, "abort");
  host.queue(() => finish(host, s, by));
  return PUT_BACK_NOTE;
}

async function finish(host: ActionHost, s: Session, by: UserEnd): Promise<void> {
  if (host.session() !== s) return;
  const { ctx } = host;
  let view = null;
  try {
    view = ctx.deps.map.fromSdk((await ctx.deps.client.request("get_settings", { photo_uuid: s.master.uuid })).settings);
  } catch {
    // the log then holds no final settings; the photo was put back by the plugin all the same
  }
  const interrupted = s.abort?.interrupted ?? by.interrupted;
  s.log.outcome = "revert";
  s.log.ended = ctx.now().toISOString();
  s.log.final_settings = view?.settings ?? null;
  s.log.revert = view ? { ms: 0, differing: [...differingSettings(view.settings, s.startSettings), ...(view.masks.fingerprint !== s.startMasks ? ["masks"] : [])] } : null;
  s.log.ended_by = { source: by.source, click_id: by.click_id, received: by.received.toISOString(), interrupted, done_ms: ms(by.t0) };
  saveLog(s);
  host.close(s, userEnded(ctx, s, "put_back", by));
  ctx.deps.hud?.stage(s, "ended", { note: PUT_BACK_NOTE });
}
