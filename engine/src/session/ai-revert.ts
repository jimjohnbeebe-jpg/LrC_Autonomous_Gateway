// What the engine does when Lightroom does not give an AI mask (ai-update.ts says when): put the photo back to
// before the session and end it (autoRevert) [stated: Jim, 2026-10-03, "Also auto-revert"] once nothing can
// be computing: Lightroom reported the update failed or dropped it ("dialog"), or Lightroom restarted
// ("restart", restart.ts) [stated: Jim, 2026-10-04, "Yes: revert after restart (Recommended)"]; or, while no
// result came, write nothing and say Lightroom seems stuck (stuckError, D16). Moved out of ai-masks.ts in PR C
// step 2c (module size, rule 01). The HUD's notes are in the photographer's words (no "session", no codes).

import { ToolError, toToolError } from "../mcp/errors.js";
import { KIND_LABELS } from "../params/index.js";
import type { AiJob } from "./ai-masks.js";
import { endSession } from "./end.js";
import { reopenLog } from "./hud-actions.js";
import { saveLog } from "./io.js";
import type { Session, SessionContext } from "./types.js";

const STUCK = "Lightroom's AI mask computation seems stuck";
const RESTARTED = "Lightroom restarted";
/** The HUD's last note when the engine ended the session; the HUD then closes itself (manager.ts, D15). */
export function engineEndedNote(reason: string): string {
  return reason.startsWith(RESTARTED)
    ? "Lightroom restarted while it computed the mask, so the photo was put back as it was before the edit."
    : "Lightroom was busy or showed a dialog, so the photo was put back as it was before the edit.";
}

export type RevertCause = "dialog" | "restart";

const MODES = {
  dialog: {
    code: "LIGHTROOM_DIALOG",
    reason: (label: string, cause: string) => `Lightroom was busy or showed a dialog while it computed the AI ${label} mask (${cause})`,
    done: "Once Lightroom was free again, the engine put the photo back",
    manual: 'if a dialog is open in Lightroom, click OK; then call lr_end_session with outcome "revert"',
  },
  restart: {
    code: "LIGHTROOM_RESTARTED",
    reason: (label: string, cause: string) => `${RESTARTED} while it computed the AI ${label} mask (${cause})`,
    done: "Once Lightroom was back, the engine put the photo back",
    manual: 'call lr_end_session with outcome "revert"',
  },
} as const;

/**
 * The photo back to before the session through the plugin's queued gate, checked, masks included (end.ts
 * revert), and the session ended by the engine. In Variants mode the pick's attempt is taken out first (the
 * session's revert puts only the master back); an attempt left on the copy is reported, not a reason to
 * stop. After a successful end that left anything different, the log is opened again and the session stays
 * open, writes allowed again (Lightroom computes nothing now [inference]), so lr_end_session "revert" can try again.
 * Always throws: LIGHTROOM_DIALOG or LIGHTROOM_RESTARTED.
 */
export async function autoRevert(ctx: SessionContext, s: Session, job: AiJob, cause: string, why: RevertCause, takeOut: (job: AiJob) => Promise<string | null>): Promise<never> {
  s.aiPending = null; // nothing computes now; the put-back's own gate waits for the catalog
  const mode = MODES[why];
  const reason = mode.reason(KIND_LABELS[job.kind], cause);
  let copy: string | null = null;
  if (job.t.id !== "master") copy = await takeOut(job).catch((err: unknown) => `taking the attempt out failed: ${toToolError(err).message}`);
  const onCopy = copy ? ` On copy ${job.t.id}: ${copy}; it stays in the catalog with the attempt.` : "";
  let problem: string | null = null;
  let ended = false;
  try {
    await endSession(ctx, s, { session_id: s.id, outcome: "revert" });
    ended = true;
    const differing = s.log.revert?.differing ?? [];
    if (differing.length > 0) problem = `the put-back left ${differing.join(", ")} different from before the session`;
  } catch (err) {
    problem = `the put-back did not go through: ${toToolError(err).message}`;
  }
  if (ended && problem !== null) reopenLog(s);
  if (problem !== null) {
    throw new ToolError(mode.code, `${reason}. ${problem}.${onCopy} Session ${s.id} is still open. Tell the user: ${mode.manual}. If that fails too: in Lightroom's Develop module, open the Snapshots panel and click "${s.snapshot.name}".`, false, { session_id: s.id, reverted: false, reason });
  }
  s.log.ended_by = { source: "engine", reason };
  s.endedByEngine = reason;
  saveLog(s);
  const told = `${reason}. ${mode.done} as it was before the session (every setting and the masks checked) and ended session ${s.id} with outcome "revert".`;
  throw new ToolError(mode.code, `${told}${onCopy} Tell the user what happened; start a new session only if they ask.`, false, { session_id: s.id, reverted: true, outcome: "revert", ended_by: "engine", reason });
}

/** No result from Lightroom (ai-update.ts "stuck"): nothing written; the session stays open, s.aiPending kept, until the result or a restart. */
export function stuckError(s: Session, job: AiJob, cause: string): ToolError {
  s.idleNote = "Lightroom's AI mask seems stuck. Restart Lightroom: the photo is then put back by itself.";
  return new ToolError(
    "LIGHTROOM_STUCK",
    `${STUCK} (the AI ${KIND_LABELS[job.kind]} mask: ${cause}). Nothing was written after the update, so the photo was not put back while Lightroom may still work on it. Tell the user: restart Lightroom (File > Exit, then start it again). Once it is back, the engine notices the restart, puts the photo back as it was before the session (checked) and ends session ${s.id} by itself; nothing to call. If Lightroom finishes the mask first, the session goes on. Until then session ${s.id} writes, renders and reverts nothing.`,
    false,
    { session_id: s.id, reverted: false, reason: cause },
  );
}
