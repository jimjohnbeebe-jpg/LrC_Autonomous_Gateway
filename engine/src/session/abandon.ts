// lr_end_session "abandon" (GitHub issue #124, engine 0.26.0): a way out of a session that cannot end otherwise,
// Lightroom gone or hung, or an AI mask that failed or never answered (AI_MASK_FAILED, LIGHTROOM_STUCK). Before it,
// such a session refused every call, a revert too (ai-update.ts pendingError), and lr_begin_session refused a new
// one, until the user restarted Lightroom [handle: GitHub issue #124, the lr_create_mask error at
// 2026-10-11T05:49:48.588Z in logs\engine-20261010.jsonl]. The shape is Jim's [stated: Jim, 2026-10-11, "go" on
// the #123/#124 plan; "Go with recommendations" on D1-D3 of the #124 plan]:
//   - nothing is read from or written to the photo: it keeps what the session wrote, and the result names the
//     pre-session snapshot, which the user applies in Develop's Snapshots panel to put it back by hand;
//   - the log is finished with the outcome "abandoned"; the session closes, so a new one can begin;
//   - the plugin's guard on the photo (plugin 0.20.0, Pending.lua) is dropped with clear_pending_ai, once and
//     best-effort, when an AI mask was pending: without that, Lightroom refuses every write to the photo, a new
//     session's snapshot included, until it restarts. Lightroom may still be computing the mask after
//     LIGHTROOM_STUCK, and a write under a running computation is what capture 5's row E is thought to show (D16)
//     [inference], so the result still says a restart of Lightroom is the safe way;
//   - it runs in the session's queue, after the running call (D3), and the user's Abort on the Deck or the menu
//     ends the session this way when its revert is refused because the AI mask is stuck (hud-actions.ts).
// [handle: tests\session-abandon.test.ts, against the Lightroom sim; in Lightroom [unverified] until Jim's check.]

import { pluginVersionAtLeast } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiTimings } from "./ai-update.js";
import { sentenceName } from "./client.js";
import { endedBy } from "./end.js";
import { saveLog } from "./io.js";
import type { Session, SessionContext, SessionOutput, UserEnd } from "./types.js";

/** The plugin that has clear_pending_ai (Pending.lua); the engine waits for its answer aiTimings' clearMs, 5 s. */
export const CLEAR_PENDING_PLUGIN = "0.20.0";

/** What became of the plugin's guard on the photo. */
export type GuardOutcome = "none" | "cleared" | "not_cleared" | "plugin_too_old";

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
};

/** End `s` without a Lightroom call but clear_pending_ai; the caller closes it. `by`: the user's Abort, else Claude. */
export async function abandonSession(ctx: SessionContext, s: Session, by: UserEnd | null): Promise<SessionOutput> {
  const ai = s.aiPending;
  const { guard, error } = await dropGuard(ctx, ai?.job.t.uuid ?? null);
  s.log.outcome = "abandoned";
  s.log.ended = ctx.now().toISOString();
  s.log.ended_by = endedBy(by);
  if (error) s.log.failures.push({ at: s.log.ended, stage: "abandon (clear_pending_ai)", error: { code: error, message: GUARD_NOTE.not_cleared.trim(), recoverable: false } });
  saveLog(s);
  const note =
    `Nothing was read from or written to the photo: it keeps what the session did. To put it back, the user selects it in Develop ` +
    `and clicks the snapshot "${s.snapshot.name}" in the Snapshots panel.${GUARD_NOTE[guard]}`;
  const json = {
    ok: true,
    session_id: s.id,
    outcome: "abandoned",
    ended_by: s.log.ended_by,
    log_path: s.files.logPath,
    snapshot: s.snapshot.name,
    ...(ai ? { ai_mask: { kind: ai.kind, since: ai.since, state: ai.failed ? "failed" : ai.stuck ? "stuck" : "pending" } } : {}),
    lightroom_guard: guard,
    note,
  };
  return { json, log: { session_id: s.id, outcome: "abandoned", ended_by: s.log.ended_by, log_path: s.files.logPath, lightroom_guard: guard } };
}

/** The HUD's note once edit `s` was abandoned, by the user's Abort or by the AI (the photographer's words, within HUD_LIMITS.text). */
export function abandonedNote(s: Session, byUser: boolean): string {
  const why = byUser ? "Ended as it is, as Lightroom's AI mask is stuck." : `${sentenceName(s.client)} ended the edit as it is.`;
  return `${why} To undo, click its AVG snapshot in Develop > Snapshots.`;
}
