// What the engine does when Lightroom does not give an AI mask (ai-update.ts says when): put the photo
// back to before the session and end it (autoRevert) [stated: Jim, 2026-10-03, "Also auto-revert"], or,
// while Lightroom's own update still runs or the plugin stops answering, write nothing and say Lightroom
// seems stuck (stuckError) (the lead's D13 directive, 2026-10-04). Moved out of ai-masks.ts in PR C step
// 2c (module size, rule 01). The HUD's notes are in the photographer's words (no "session", no codes).

import { ToolError, toToolError } from "../mcp/errors.js";
import { KIND_LABELS } from "../params/index.js";
import type { AiJob } from "./ai-masks.js";
import { STUCK_REVERTED } from "./ai-update.js";
import { endSession } from "./end.js";
import { reopenLog } from "./hud-actions.js";
import { saveLog } from "./io.js";
import type { Session, SessionContext } from "./types.js";

const STUCK = "Lightroom's AI mask computation seems stuck";
/** The HUD's last note when the engine ended the session; the HUD then closes itself (manager.ts, D15). */
export function engineEndedNote(reason: string): string {
  return reason.startsWith(STUCK)
    ? "Lightroom's AI mask seems stuck. The photo is back as before; if the screen still shows the edit, restart Lightroom."
    : "Lightroom was busy or showed a dialog, so the photo was put back as it was before the edit.";
}

/**
 * The photo back to before the session through the plugin's queued gate, checked, masks included (end.ts
 * revert), and the session ended by the engine. In Variants mode the pick's attempt is taken out first (the
 * session's revert puts only the master back); an attempt left on the copy is reported, not a reason to
 * stop. After a successful end that left anything different, the log is opened again. `stuck`: no result
 * from Lightroom in time; the result then says so in the lead's words (STUCK_REVERTED). Always throws:
 * LIGHTROOM_STUCK or LIGHTROOM_DIALOG.
 */
export async function autoRevert(ctx: SessionContext, s: Session, job: AiJob, cause: string, stuck: boolean, takeOut: (job: AiJob) => Promise<string | null>): Promise<never> {
  const pending = s.aiPending;
  s.aiPending = null; // the put-back's own gate waits for the catalog
  const code = stuck ? "LIGHTROOM_STUCK" : "LIGHTROOM_DIALOG";
  const reason = stuck ? `${STUCK} (the AI ${KIND_LABELS[job.kind]} mask: ${cause})` : `Lightroom was busy or showed a dialog while it computed the AI ${KIND_LABELS[job.kind]} mask (${cause})`;
  const manual = `Tell the user: if a dialog is open in Lightroom, click OK${stuck ? ", or restart Lightroom" : ""}; then call lr_end_session with outcome "revert". If that fails too: in Lightroom's Develop module, open the Snapshots panel and click "${s.snapshot.name}".`;
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
    s.aiPending = pending; // nothing more is written or rendered until the session ends
    throw new ToolError(code, `${reason}. ${problem}.${onCopy} Session ${s.id} is still open, and writes and renders nothing more. ${manual}`, false, { session_id: s.id, reverted: false, reason });
  }
  s.log.ended_by = { source: "engine", reason };
  s.endedByEngine = reason;
  saveLog(s);
  const told = stuck
    ? `${STUCK_REVERTED} The engine ended session ${s.id} with outcome "revert" (${cause}).`
    : `${reason}. Once Lightroom was free again, the engine put the photo back as it was before the session (every setting and the masks checked) and ended session ${s.id} with outcome "revert".`;
  throw new ToolError(code, `${told}${onCopy} Tell the user what happened; start a new session only if they ask.`, false, { session_id: s.id, reverted: true, outcome: "revert", ended_by: "engine", reason });
}

/** Lightroom seems stuck with its update running (or not answering): nothing written; the session stays open and writes nothing (s.aiPending stays set). */
export function stuckError(s: Session, job: AiJob, cause: string): ToolError {
  s.idleNote = "Lightroom's AI mask seems stuck. Restart Lightroom, then ask Claude to put the photo back.";
  return new ToolError(
    "LIGHTROOM_STUCK",
    `${STUCK} (the AI ${KIND_LABELS[job.kind]} mask: ${cause}). Nothing was written after the update, so the photo was not put back while Lightroom still works on it. Tell the user: restart Lightroom (File > Exit, then start it again); once it is back, lr_end_session with outcome "revert" puts the photo back as it was before the session. Until then session ${s.id} writes and renders nothing.`,
    false,
    { session_id: s.id, reverted: false, reason: cause },
  );
}
