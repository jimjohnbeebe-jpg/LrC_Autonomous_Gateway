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
//     best-effort, when an AI mask was pending: without that, Lightroom refuses every write to the photo, a new
//     session's snapshot included, until it restarts. Lightroom may still be computing the mask after
//     LIGHTROOM_STUCK, and a write under a running computation is what capture 5's row E is thought to show (D16)
//     [inference], so the result still says a restart of Lightroom is the safe way;
//   - it runs in the session's queue, after the running call (D3), and the user's Abort on the Deck or the menu
//     ends the session this way when its revert is refused because the AI mask is stuck (hud-actions.ts).
// [handle: tests\session-abandon.test.ts, against the Lightroom sim; in Lightroom [unverified] until Jim's check.]

import { HUD_LIMITS } from "../bridge/index.js";
import { GUARD_NOTE, dropGuard } from "./ai-guard.js";
import { putBackByHand } from "./ai-update.js";
import { sentenceName } from "./client.js";
import { endedBy } from "./end.js";
import { saveLog } from "./io.js";
import type { Session, SessionContext, SessionOutput, UserEnd } from "./types.js";

// dropGuard and the guard's notes moved to ai-guard.ts (a leaf file, issue #181); left-open.ts still takes them from here.
export { GUARD_NOTE, dropGuard, type GuardOutcome } from "./ai-guard.js";

/** End `s` without a Lightroom call but clear_pending_ai; the caller closes it. `by`: the user's Abort, else Claude. */
export async function abandonSession(ctx: SessionContext, s: Session, by: UserEnd | null): Promise<SessionOutput> {
  const ai = s.aiPending;
  const { guard, error } = await dropGuard(ctx, ai?.job.t.uuid ?? null);
  s.log.outcome = "abandoned";
  s.log.ended = ctx.now().toISOString();
  s.log.ended_by = endedBy(by);
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
 * not put back, and the snapshot that puts it back, when that fits HUD_LIMITS.text (else the panel alone).
 */
export function abandonedNote(s: Session, byUser: boolean): string {
  const why = byUser ? "Photo not put back (AI mask stuck)." : `${sentenceName(s.client)} ended the edit; not put back.`;
  const named = `${why} To undo: Develop > Snapshots > "${s.snapshot.name}".`;
  return Buffer.byteLength(named) <= HUD_LIMITS.text ? named : `${why} To undo, click its AVG snapshot in Develop > Snapshots.`;
}
