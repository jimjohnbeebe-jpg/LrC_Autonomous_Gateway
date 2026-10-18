// lr_end_session "abandon" (GitHub issue #124, engine 0.26.0): a way out of a session that cannot end otherwise,
// Lightroom gone or hung, or an AI mask that failed or never answered (AI_MASK_FAILED, LIGHTROOM_STUCK). Before it,
// such a session refused every call, a revert too (ai-update.ts pendingError), and lr_begin_session refused a new
// one, until the user restarted Lightroom [handle: GitHub issue #124, the lr_create_mask error at
// 2026-10-11T05:49:48.588Z in logs\engine-20261010.jsonl]. The shape is Jim's [stated: Jim, 2026-10-11, "go" on
// the #123/#124 plan; "Go with recommendations" on D1-D3 of the #124 plan]:
//   - nothing is read from or written to the photo: it keeps what the session wrote (the AI mask's entry in the
//     mask table included), and the result and the HUD say so and name the pre-session snapshot, which the user
//     applies in Develop's Snapshots panel to put it back by hand (issue #181);
//   - the log is finished with the outcome "abandoned"; the session closes, so a new one can begin;
//   - the plugin's guard on the photo (plugin 0.20.0, Pending.lua) is dropped with clear_pending_ai, once and
//     best-effort, when the AI mask is stuck or failed: without that, Lightroom refuses every write to the photo, a new
//     session's snapshot included, until it restarts. Lightroom may still be computing the mask after
//     LIGHTROOM_STUCK, and a write under a running computation is what capture 5's row E is thought to show (D16)
//     [inference], so the result still says a restart of Lightroom is the safe way;
//   - an AI mask still in its first wait (an Abort during it, or a wait a dropped bridge ended) keeps the guard ("kept"):
//     Lightroom is likely still computing it, so the engine's next writes stay refused until the mask shows, when the plugin
//     drops the guard itself [handle: plugin\LrC-AVG.lrplugin\Pending.lua:120-127 Pending.refusal], or until a restart (D16;
//     the review of issue #181). The result and the HUD tell the user to wait for the mask before clicking the snapshot;
//   - what the AI mask's wait saw (s.aiTrace), when an Abort ended it, goes on a failure entry of the log (issue #123's trace);
//   - it runs in the session's queue, after the running call (D3), and the user's Abort on the Deck or the menu
//     ends the session this way when its revert is refused because an AI mask has no result (hud-actions.ts finishAbort).
// [handle: tests\session-abandon.test.ts, against the Lightroom sim; in Lightroom [unverified] until Jim's check.]

import { HUD_LIMITS, pluginVersionAtLeast } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiTimings } from "./ai-timings.js";
import { putBackByHand } from "./ai-update.js";
import { sentenceName } from "./client.js";
import { endedBy } from "./end.js";
import { saveLog } from "./io.js";
import type { Session, SessionContext, SessionOutput, UserEnd } from "./types.js";

/** The plugin that has clear_pending_ai (Pending.lua); the engine waits for its answer aiTimings' clearMs, 5 s. */
export const CLEAR_PENDING_PLUGIN = "0.20.0";

/** What became of the plugin's guard on the photo. */
export type GuardOutcome = "none" | "cleared" | "not_cleared" | "plugin_too_old" | "kept";

/**
 * Drop the plugin's guard on photo `uuid`, whose AI mask is pending (null: none is); never throws. `ifAny`: a photo that
 * may have none (left-open.ts), so the plugin's answer that it had none is "none".
 */
export async function dropGuard(ctx: SessionContext, uuid: string | null, ifAny = false): Promise<{ guard: GuardOutcome; error?: string }> {
  if (!uuid) return { guard: "none" };
  const { client } = ctx.deps;
  if (client.getState() !== "connected") return { guard: "not_cleared", error: "Lightroom is not connected" };
  if (!pluginVersionAtLeast(client.hello()?.plugin_version, CLEAR_PENDING_PLUGIN)) return { guard: "plugin_too_old" };
  // The bridge's own timeout waits on while the plugin is paused (bridge\client.ts send), so a hung Lightroom with its
  // socket open would hold the queue until the heartbeat drops it (Greptile, PR #134): a deadline of its own.
  const ms = aiTimings(ctx).clearMs;
  const sent = client.request("clear_pending_ai", { photo_uuid: uuid }, { timeoutMs: ms });
  sent.catch(() => undefined); // an answer after the deadline is dropped
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError("BRIDGE_TIMEOUT", `clear_pending_ai: no answer within ${ms} ms`, true)), ms);
  });
  try {
    const res = await Promise.race([sent, deadline]);
    return { guard: ifAny && !res.cleared ? "none" : "cleared" };
  } catch (err) {
    return { guard: "not_cleared", error: toToolError(err).code };
  } finally {
    clearTimeout(timer);
  }
}

export const GUARD_NOTE: Record<GuardOutcome, string> = {
  none: "",
  cleared:
    " Lightroom was told to stop holding writes to the photo for the AI mask; if Lightroom may still be working on it, restarting Lightroom first is the safe way.",
  not_cleared: " Lightroom could not be told to stop holding writes to the photo for the AI mask: it refuses them until it restarts.",
  plugin_too_old: ` Lightroom refuses writes to the photo until it restarts (the plugin before ${CLEAR_PENDING_PLUGIN} cannot be told to stop).`,
  kept: " Lightroom is still finishing the AI mask: it refuses the engine's writes to the photo until the mask's shape shows (or Lightroom restarts). Wait until the mask shows in Lightroom before clicking the snapshot or starting a new edit.",
};

/** The HUD's note when the abandon kept the guard (`kept`): wait for the mask before the snapshot (at most HUD_LIMITS.text). */
export const FINISHING_NOTE = "Photo not put back; Lightroom is finishing the AI mask. Once it shows, click the AVG snapshot in Develop > Snapshots.";

/** End `s` without a Lightroom call but clear_pending_ai; the caller closes it. `by`: the user's Abort, else Claude. */
export async function abandonSession(ctx: SessionContext, s: Session, by: UserEnd | null): Promise<SessionOutput> {
  const ai = s.aiPending;
  const { guard, error }: { guard: GuardOutcome; error?: string } = ai && !ai.stuck && !ai.failed ? { guard: "kept" } : await dropGuard(ctx, ai?.job.t.uuid ?? null);
  s.log.outcome = "abandoned";
  s.log.ended = ctx.now().toISOString();
  s.log.ended_by = endedBy(by);
  if (s.aiTrace) {
    // The wait an Abort ended logged nothing (io.ts failed: SESSION_ENDED is no failure); its trace goes here (review of #181).
    const message = "The user's Abort ended the wait for Lightroom's AI mask before a result showed.";
    s.log.failures.push({ at: s.log.ended, stage: "ai mask (wait ended by the user's Abort)", error: { code: "SESSION_ENDED", message, recoverable: false }, ai_trace: s.aiTrace });
    s.aiTrace = null;
  }
  if (error) s.log.failures.push({ at: s.log.ended, stage: "abandon (clear_pending_ai)", error: { code: error, message: GUARD_NOTE.not_cleared.trim(), recoverable: false } });
  saveLog(s);
  const entry = ai ? " The AI mask's entry stays in the photo's mask list (it may have no shape yet)." : "";
  const note =
    `The photo was NOT put back. Nothing was read from or written to the photo: it keeps what the session did.${entry} ` +
    `${putBackByHand(s.snapshot.name)}${GUARD_NOTE[guard]}`;
  const json = {
    ok: true,
    session_id: s.id,
    outcome: "abandoned",
    ended_by: s.log.ended_by,
    log_path: s.files.logPath,
    photo_put_back: false,
    snapshot: s.snapshot.name,
    ...(ai ? { ai_mask: { kind: ai.kind, since: ai.since, state: ai.failed ? "failed" : ai.stuck ? "stuck" : "pending" } } : {}),
    lightroom_guard: guard,
    note,
  };
  return { json, log: { session_id: s.id, outcome: "abandoned", ended_by: s.log.ended_by, log_path: s.files.logPath, lightroom_guard: guard } };
}

/**
 * The HUD's note once edit `s` was abandoned, by the user's Abort or by the AI (the photographer's words): the photo was
 * not put back, and the snapshot that puts it back, when that fits HUD_LIMITS.text (else the panel alone); `finishing`: the
 * guard was kept (Lightroom still computes the mask), so the user waits for it first.
 */
export function abandonedNote(s: Session, byUser: boolean, finishing = false): string {
  if (finishing) return FINISHING_NOTE;
  const why = byUser ? "Photo not put back (AI mask unfinished)." : `${sentenceName(s.client)} ended the edit; not put back.`;
  const named = `${why} To undo: Develop > Snapshots > "${s.snapshot.name}".`;
  return Buffer.byteLength(named) <= HUD_LIMITS.text ? named : `${why} To undo, click its AVG snapshot in Develop > Snapshots.`;
}
