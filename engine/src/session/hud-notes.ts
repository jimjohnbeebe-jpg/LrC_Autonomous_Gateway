// The HUD's notes once an operation of the open session is over (idleStage, closeNote), and the answers to calls that name a
// session the user ended from the HUD or the menu (endedError, endedAlike, issue #126). Moved out of hud-actions.ts unchanged
// (module size, rule 01). Only manager.ts and the tests import this file, so it joins none of the session's import cycles.

import type { HudStage } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { approvalNote, pendingApproval } from "./approval.js";
import { displayName, sentenceName } from "./client.js";
import type { UserEnded } from "./hud-actions.js";
import { awaitingPick } from "./pick.js";
import type { Session, SessionOutput } from "./types.js";

/** The HUD's line when the photo's original went missing during the edit (plugin 0.19.0 refuses writes and exports to it). */
export const MISSING_NOTE = "The photo's original file is missing: reconnect it in Lightroom (Library > Find All Missing Photos).";

/**
 * The HUD's stage once an operation of the open session is over (`error`: why it failed, if it did),
 * or null when the HUD is told otherwise (an Abort reports its own stages).
 */
export function idleStage(s: Session, error: unknown): { stage: HudStage; note?: string } | null {
  if (s.abort) return null;
  const given = s.idleNote;
  s.idleNote = null;
  const at = (stage: HudStage, note: string | null): { stage: HudStage; note?: string } => (note ? { stage, note } : { stage });
  const waiting = pendingApproval(s);
  if (error !== undefined) {
    const e = toToolError(error);
    if (e.code === "SESSION_ENDED") return null;
    if (e.code === "TARGET_CHANGED") return at("target_changed", given ?? "Another photo was selected, so nothing was changed; the edit is still open.");
    if (waiting && e.code === "AWAITING_APPROVAL") return at("awaiting_approval", given ?? approvalNote(s, waiting.pass));
    // A missing original outranks any note waiting to be shown, e.g. a version notice (Greptile, PR #101).
    const why = e.code === "ORIGINAL_MISSING" ? MISSING_NOTE : (given ?? `${sentenceName(s.client)}'s last call failed; the edit is still open.`);
    return at(waiting ? "awaiting_approval" : "awaiting_claude", why);
  }
  if (awaitingPick(s)) return at("awaiting_pick", given ?? `Pick a copy here, or tell ${displayName(s.client)} which one.`);
  const t = s.active;
  const finish = "Accept keeps the edit; Abort puts the photo back.";
  if (t.endReason === "converged") return at("converged", given ?? finish);
  if (t.endReason === "cap_reached") return at("awaiting_claude", given ?? `All ${s.maxPasses} passes are used. ${finish}`);
  if (waiting) return at("awaiting_approval", given ?? approvalNote(s, waiting.pass));
  return at("awaiting_claude", given);
}

/** The HUD's note once the AI ended the edit with lr_end_session (manager.ts). */
export function closeNote(s: Session, outcome: "accept" | "revert"): string {
  const name = sentenceName(s.client);
  return outcome === "accept" ? `${name} accepted: the edit is kept.` : `${name} reverted: the photo is back as it was before the edit.`;
}

/** The answer to a call naming a session the user ended from the HUD or the menu. */
export function endedError(e: UserEnded): ToolError {
  const how = {
    aborted: "aborted it: the photo is back as it was before the session",
    put_back: "put the photo back with the HUD's Put back: it is as it was before the session",
    accept: "accepted it: the edit is kept and the recipe written",
    abandoned: `abandoned it while Lightroom's AI mask was still computing: the photo was NOT put back, it keeps the session's edits; the snapshot "${e.snapshot}" puts it back`,
  }[e.outcome];
  const where = e.source === "menu" ? "Lightroom's menu" : "the HUD";
  return new ToolError("SESSION_ENDED", `The user ended session ${e.session_id} from ${where} at ${e.at} and ${how}. Start a new session only if the user asks.`, false, e);
}

/**
 * lr_end_session on a session the user already ended the way Claude asks (accept after Accept; revert after Abort or
 * Put back): success, naming the user's end, instead of SESSION_ENDED; null otherwise (issue #126) [stated: Jim, 2026-10-11].
 */
export function endedAlike(e: UserEnded | null, outcome: "accept" | "revert"): SessionOutput | null {
  if (!e || (outcome === "accept") !== (e.outcome === "accept") || e.outcome === "abandoned") return null;
  const { session_id, log_path } = e;
  return { json: { ok: true, session_id, outcome, already_ended_by_user: { outcome: e.outcome, source: e.source, at: e.at, log_path }, log_path } };
}
