// A Lightroom restart while an AI mask had no result (GitHub issue #59, PR C step 2d, D16) [stated: Jim,
// 2026-10-04, "Yes: revert after restart (Recommended)"]: nothing writes to the photo while Lightroom may
// still compute (ai-update.ts); when no result comes, the user restarts Lightroom and the engine puts the
// photo back by itself. The restart shows in the plugin's hello at the reconnect: another process_started_at
// than the one the update was sent under (plugin 0.16.0, Bridge.lua) [inference: a Reload Plug-in keeps it,
// a restart does not]. The put-back is ai-revert.ts autoRevert's ("restart"), in the session's queue after
// the running operation: the engine ends the session (the HUD shows it for 10 s, D15) and later calls naming
// it get SESSION_ENDED (manager.ts); a put-back that does not go through leaves the session open, writes
// allowed again, and the HUD says to ask Claude. [handle: tests\session-ai-restart.test.ts, against the
// Lightroom sim; in Lightroom [unverified] until capture 6.]

import { revertAfterRestart } from "./ai-masks.js";
import { saveLog } from "./io.js";
import type { Session, SessionContext } from "./types.js";

export type RestartHost = {
  ctx: SessionContext;
  session(): Session | null;
  /** Run `fn` in the session's queue, after the operations already in it. */
  queue(fn: () => Promise<void>): void;
  /** The engine ended `s` (s.endedByEngine is set): close it and tell the HUD. */
  endedByEngine(s: Session): void;
};

/** The process the update went to and the plugin's now, when they differ (Lightroom restarted); else null. */
function restartOf(ctx: SessionContext, s: Session): { before: string; now: string } | null {
  const before = s.aiPending?.process;
  const now = ctx.deps.client.hello()?.process_started_at;
  return typeof before === "string" && typeof now === "string" && before !== now ? { before, now } : null;
}

/** At each connection of the bridge: a restart while the open session's AI update has no result is acted on. */
export function watchRestarts(host: RestartHost): void {
  host.ctx.deps.client.onStateChange((state) => {
    const s = host.session();
    if (state === "connected" && s && restartOf(host.ctx, s)) host.queue(() => afterRestart(host, s));
  });
}

async function afterRestart(host: RestartHost, s: Session): Promise<void> {
  const restart = host.session() === s ? restartOf(host.ctx, s) : null;
  if (!restart) return; // the result came first, or the session ended meanwhile
  const err = await revertAfterRestart(host.ctx, s, `the plugin now runs in a Lightroom started at ${restart.now}; the update went to the one started at ${restart.before}`);
  if (s.endedByEngine) return host.endedByEngine(s);
  s.log.failures.push({ at: host.ctx.now().toISOString(), stage: "revert after a Lightroom restart", error: err.body() });
  try {
    saveLog(s);
  } catch {
    // the HUD's note matters more than the log write
  }
  s.idleNote = "Lightroom restarted, but the photo could not be put back. Ask Claude to put it back.";
}
