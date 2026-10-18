// The HUD's buttons and menu items acting on the open session (PRD 6.3 and FR-1.1, PHASE5_PLAN row 5;
// the events are bridge\hud-protocol.ts's, received by hud\events.ts). Each event is checked against
// the open session, answered at once with a note the HUD shows, and acted on in the session's queue,
// after the running operation:
//   - Abort (PHASE5_PLAN decision 3): the running operation stops before its next write or export
//     (io.ts checkAbort), then the pre-session snapshot is applied, as lr_end_session "revert" does;
//     the log's outcome is "aborted". A revert that fails, or leaves a setting different, keeps the
//     session open, and a second click tries again; Claude's revert while an Abort is pending is
//     logged as the user's (end.ts). While an AI mask has no result (s.aiPending: the engine's wait for
//     it, or after LIGHTROOM_STUCK or AI_MASK_FAILED) the wait ends at its next read (ai-update.ts watch),
//     and if the revert is refused for want of the result (D16) the Abort abandons the edit, nothing
//     written (abandon.ts; issue #124, and issue #181 [stated: Jim, 2026-10-18, "Abort ends the wait now"]);
//   - Accept: after the running operation, as lr_end_session "accept" (Variants mode: after a pick);
//     it waits rather than stops, so no pass is left half done (a write without its corrections);
//   - Pick: as lr_select_variant; Claude learns of it in its next session tool result
//     (`hud_actions`), since an MCP server cannot call the model [inference: PHASE5_PLAN "Assumptions"];
//   - Approve pass (approve_each_pass mode, PHASE5_PLAN row 6): approves the pass the HUD showed, at
//     once and outside the queue, where a step waiting for it holds the queue (approval.ts). Abort and
//     Accept end such a wait at once, so they do not wait behind it.
// A session the user ended answers every later call naming it with SESSION_ENDED (endedError, hud-notes.ts), but for
// lr_end_session asking for the user's own outcome, which succeeds (endedAlike, issue #126).
// The notes are the HUD's, in the photographer's words (PRODUCT.md; fix/hud-p1 copy deck): an "edit",
// not a session; the AI by its client's name (client.ts, issue #155 R2), not the engine; no error codes.
// The AI's tool results keep their own words.
// [handle: tests\hud-abort.test.ts, tests\hud-actions.test.ts, tests\approve-pass-hud.test.ts, against
// the Lightroom sim; in Lightroom [unverified] until the row 5 probe and PHASE5_PLAN row 7.]

import type { HudEvent } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import { approve, wakeApproval } from "./approval.js";
import { abandonedNote, abandonSession } from "./abandon.js";
import { displayName, UNNAMED } from "./client.js";
import { endSession } from "./end.js";
import { failed, reopenLog, saveLog } from "./io.js";
import { selectVariant } from "./pick.js";
import { putBackReported } from "./put-back.js";
import { variant } from "./targets.js";
import type { Session, SessionContext, UserEnd, UserSource, VariantId } from "./types.js";

/** A HUD event as the engine received it: when, and performance.now() then. */
export type UserAction = HudEvent & { received: Date; t0: number };

/** A session the user ended from the HUD or the menu, for the calls that still name it. `put_back`: the HUD's Put back did it (put-back.ts); `abandoned`: an Abort while an AI mask had no result (abandon.ts), `ai_finishing` when Lightroom was likely still computing it (guard "kept"). */
export type UserEnded = { session_id: string; outcome: "aborted" | "accept" | "put_back" | "abandoned"; source: UserSource; at: string; log_path: string; snapshot: string; ai_finishing?: true };

/** What the actions need from the session manager (manager.ts). */
export type ActionHost = {
  ctx: SessionContext;
  session(): Session | null;
  ended(sessionId: string): UserEnded | undefined;
  /** An operation of the session's queue is running now. */
  busy(): boolean;
  /** Run `fn` in the session's queue, after the operations already in it. */
  queue(fn: () => Promise<void>): void;
  /** The session is over: forget it, and answer later calls naming it with SESSION_ENDED. */
  close(s: Session, ended: UserEnded): void;
  /** Lightroom restarted under the session's AI mask: the photo put back as restart.ts does (true); false when it did not restart. */
  restarted(s: Session): Promise<boolean>;
};

/**
 * How long an Abort or Accept waits for the bridge when it is not connected: as long as a tool call
 * waits for it (mcp\bridge-gate.ts DEFAULT_WAIT_MS) [inference].
 */
const RECONNECT_WAIT_MS = 15000;

/** Act on a HUD event; returns the note the HUD shows at once. */
export function userAction(host: ActionHost, a: UserAction): string {
  const s = host.session();
  if (!s || s.id !== a.payload.session_id) {
    const ended = host.ended(a.payload.session_id);
    if (ended) return `This edit had already ended: ${ended.outcome === "accept" ? "the edit was kept" : ended.outcome === "abandoned" ? "the photo was left as it was" : "the photo was put back"}.`;
    return `This edit is no longer open in ${UNNAMED}, so nothing was done.`; // hud\events.ts answers it with an `ended` update
  }
  const note = act(host, s, a);
  record(s, a, note);
  return note;
}

function act(host: ActionHost, s: Session, a: UserAction): string {
  switch (a.name) {
    case "hud_abort":
      return abort(host, s, a);
    case "hud_accept":
      return accept(host, s, a);
    case "hud_pick":
      return pick(host, s, a.payload.variant, a.payload.source);
    case "hud_approve_pass":
      return approveFromHud(host, s, a.payload.pass, a.payload.source);
    case "hud_put_back":
      return putBackReported(host, s, a);
  }
}

function approveFromHud(host: ActionHost, s: Session, pass: number, source: UserSource): string {
  const r = approve(host.ctx, s, source, pass);
  if (!r.ok) return r.hud;
  if (r.already) return `Pass ${r.pass} is approved already.`;
  if (r.woke) return `Approved pass ${r.pass}: ${displayName(s.client)}'s next pass goes ahead.`;
  const note = `Approved pass ${r.pass}: ${displayName(s.client)} goes on at its next call.`;
  if (!host.busy()) host.ctx.deps.hud?.stage(s, "awaiting_claude", { note });
  return note;
}

/** The event in the session's log (hud_events), with the note the HUD was given. */
function record(s: Session, a: UserAction, note: string): void {
  const p = a.payload;
  (s.log.hud_events ??= []).push({
    at: a.received.toISOString(),
    name: a.name,
    source: p.source,
    click_id: p.click_id,
    seq_seen: p.seq_seen,
    ...(a.name === "hud_pick" ? { variant: a.payload.variant } : {}),
    ...(a.name === "hud_approve_pass" ? { pass: a.payload.pass } : {}),
    note,
  });
  try {
    saveLog(s);
  } catch {
    // acting on the click matters more than the log write
  }
}

function userEnd(a: UserAction, previous: UserEnd | null): UserEnd {
  const p = a.payload;
  return { source: p.source, click_id: p.click_id, received: a.received, t0: a.t0, state: "pending", interrupted: previous?.interrupted ?? null };
}

/** The record of a session the user ended, for the calls that still name it. */
export function userEnded(ctx: SessionContext, s: Session, outcome: UserEnded["outcome"], by: UserEnd): UserEnded {
  return { session_id: s.id, outcome, source: by.source, at: ctx.now().toISOString(), log_path: s.files.logPath, snapshot: s.snapshot.name };
}

/** The HUD's note once an Abort has put the photo back. */
export function abortedNote(s: Session): string {
  const back = s.mode === "variants" ? "the master photo is as before; the copies stay in the catalog" : "the photo is back as it was before the edit";
  const differing = s.log.revert?.differing.length ?? 0;
  return differing ? `Aborted, but ${settingsCount(differing)} differ from before; the edit's log lists them.` : `Aborted: ${back}.`;
}

const settingsCount = (n: number): string => (n === 1 ? "1 setting" : `${n} settings`);
export const NOT_IN_DEVELOP = "Lightroom must be in Develop to put the photo back. Press D in Lightroom, then click Abort again.";
/** Abort's answer while an AI mask has no result (issue #181): the wait ends now, and the photo goes back only if the result has shown. */
export const ABORT_AI = "Abort: ending the wait for the AI mask. The photo is put back only if Lightroom has finished it.";

/** Waits for the bridge; a failed wait goes in the log's failures, as the HUD's note names no code. */
async function connected(ctx: SessionContext, s: Session, stage: string): Promise<void> {
  if (ctx.deps.client.getState() === "connected") return;
  await ctx.deps.client.waitConnected(RECONNECT_WAIT_MS).catch((err: unknown) => Promise.reject(failed(ctx, s, stage, err)));
}

function abort(host: ActionHost, s: Session, a: UserAction): string {
  if (s.abort?.state === "pending") return "Abort is already under way.";
  s.abort = userEnd(a, s.abort); // a second click after a failed revert tries again
  const running = host.busy();
  host.queue(() => finishAbort(host, s));
  wakeApproval(s, "abort"); // a step waiting for an approval stops now, and the revert runs next
  // An AI mask's wait (ai-update.ts watch) stops at its next read (checkAbort); the queued revert then goes ahead if the result
  // has shown, else the edit is abandoned (finishAbort; issue #181).
  if (s.aiPending) return ABORT_AI;
  return running ? "Abort: stopping before the next change or preview, then putting the photo back." : "Abort: putting the photo back as it was before the edit.";
}

async function finishAbort(host: ActionHost, s: Session): Promise<void> {
  const by = s.abort;
  if (host.session() !== s || !by) return;
  const { ctx } = host;
  try {
    await connected(ctx, s, "abort (reconnect)");
    await endSession(ctx, s, { session_id: s.id, outcome: "revert" }, by);
  } catch (err) {
    if (s.aiPending) {
      // The AI mask still has no result (its wait ended by this Abort, LIGHTROOM_STUCK or AI_MASK_FAILED), so the revert wrote
      // nothing (settlePending refused it, or the reconnect failed: Greptile, PR #134): the Abort ends the edit without a
      // Lightroom write (abandon.ts; issue #124, D1; issue #181), unless Lightroom restarted: then restart.ts puts it back.
      if (await host.restarted(s)) {
        if (!s.endedByEngine) by.state = "failed"; // the put-back did not go through: a second click tries again
        return;
      }
      const kept = (await abandonSession(ctx, s, by)).json["lightroom_guard"] === "kept";
      host.close(s, { ...userEnded(ctx, s, "abandoned", by), ...(kept ? { ai_finishing: true as const } : {}) });
      ctx.deps.hud?.stage(s, "ended", { note: abandonedNote(s, true, kept) });
      return;
    }
    by.state = "failed"; // the failure is in the log's failures: connected()'s, or endSession's own (io.ts failed())
    // Plugin 0.18.1 (Develop.lua toDevelop): a snapshot applies only in Develop [inference, see there], and Lightroom did not switch there.
    const note = toToolError(err).code === "NOT_IN_DEVELOP" ? NOT_IN_DEVELOP : "Abort could not put the photo back. Click Abort again.";
    ctx.deps.hud?.stage(s, "awaiting_claude", { note });
    return;
  }
  const differing = s.log.revert?.differing ?? [];
  if (differing.length > 0) {
    // Not all the way back: the session stays open, and a second click tries again (Greptile, PR #47)
    // [handle: tests\hud-abort.test.ts "keeps the session open when the photo is only partly back"].
    by.state = "failed";
    reopenLog(s);
    ctx.deps.hud?.stage(s, "awaiting_claude", { note: `Abort left ${settingsCount(differing.length)} different from before. Click Abort again.` });
    return;
  }
  host.close(s, userEnded(ctx, s, "aborted", by));
  ctx.deps.hud?.stage(s, "aborted", { note: abortedNote(s) });
}


export const ACCEPT_AFTER_FAILED = "Lightroom's AI mask failed, so Accept must wait: save your work and restart Lightroom; the photo is then put back by itself.";

/** Why Accept cannot end this session now, or null. A Pick already queued counts (Greptile, PR #47). */
function acceptRefusal(s: Session): string | null {
  // Accept would close the session that restart.ts puts back after AI_MASK_FAILED (ai-update.ts; Greptile, PR #133 review 2).
  if (s.aiPending?.failed) return ACCEPT_AFTER_FAILED;
  if (s.mode === "variants" && s.picked === null && s.pendingPick === null) return "Accept keeps the pick's edit: click Pick first, or Abort.";
  return null;
}

const ABORTING = "The edit is being aborted.";

function accept(host: ActionHost, s: Session, a: UserAction): string {
  if (s.abort) return ABORTING;
  const refused = acceptRefusal(s);
  if (refused) return refused;
  const by = userEnd(a, null);
  const running = host.busy();
  // An Accept that counts on a Pick still queued keeps that pick's copy, or nothing.
  const counted = s.picked === null ? s.pendingPick : null;
  host.queue(() => finishAccept(host, s, by, counted));
  wakeApproval(s, "accept"); // a step waiting for an approval ends now, nothing written
  return running ? `Accept: keeping the edit once ${displayName(s.client)}'s current step is done.` : "Accept: keeping the edit.";
}

async function finishAccept(host: ActionHost, s: Session, by: UserEnd, counted: VariantId | null): Promise<void> {
  if (host.session() !== s || s.abort) return;
  const { ctx } = host;
  const refused =
    counted !== null && s.picked === null
      ? `Pick ${counted} did not go through, so nothing was accepted. Click Pick ${counted} again, then Accept.`
      : counted !== null && s.picked !== counted
        ? `Copy ${s.picked} was picked before your Pick ${counted}; nothing was accepted. Accept keeps copy ${s.picked}.`
        : acceptRefusal(s);
  if (refused) {
    // Greptile, PR #47 (reviews 2 and 3): Claude's pick of another copy, made first, must not be
    // accepted for the user, and a Pick that failed is said to have failed [handle:
    // tests\hud-actions.test.ts "an Accept counting on a Pick that Claude's pick overtook keeps
    // nothing", "an Accept counting on a Pick that failed says so"].
    s.idleNote = refused;
    return;
  }
  try {
    await connected(ctx, s, "accept (reconnect)");
    await endSession(ctx, s, { session_id: s.id, outcome: "accept" }, by);
    host.close(s, userEnded(ctx, s, "accept", by));
    const kept = s.mode === "variants" ? `copy ${s.picked ?? "?"} is kept; the other copies stay in the catalog` : "the edit is kept";
    ctx.deps.hud?.stage(s, "accepted", { note: `Accepted: ${kept}.` });
  } catch {
    s.idleNote = "Accept did not go through; the edit is still open. Click Accept again.";
  }
}

/** Why a Pick of copy `v` cannot be made now, or null. */
function pickRefusal(s: Session, v: VariantId): string | null {
  if (s.mode !== "variants") return "Pick is for a Variants edit.";
  if (!s.ready) return "Not every copy was made; this edit can only be aborted.";
  if (s.picked !== null) return `Copy ${s.picked} is already picked.`;
  if (s.pendingPick !== null) return `Copy ${s.pendingPick} is being picked.`;
  if (!variant(s, v)) return `This edit has no copy ${v}.`;
  return null;
}

function pick(host: ActionHost, s: Session, v: VariantId, source: UserSource): string {
  if (s.abort) return ABORTING;
  const refused = pickRefusal(s, v);
  if (refused) return refused;
  s.pendingPick = v;
  host.queue(() => finishPick(host, s, v, source));
  return `Pick ${v}: selecting copy ${v}.`;
}

async function finishPick(host: ActionHost, s: Session, v: VariantId, source: UserSource): Promise<void> {
  try {
    if (host.session() !== s || s.abort) return;
    s.pendingPick = null; // pickRefusal's own check; still counted by an Accept until the pick is made
    const refused = pickRefusal(s, v);
    if (refused) {
      s.idleNote = refused;
      return;
    }
    s.pendingPick = v;
    await selectVariant(host.ctx, s, { session_id: s.id, variant: v }, source);
    s.notices.push({ action: "pick", variant: v, source, at: host.ctx.now().toISOString() });
    s.idleNote = `Picked ${v}: ${displayName(s.client)} continues on copy ${v} at its next call.`;
  } catch {
    s.idleNote = `Pick ${v} did not go through. Click Pick ${v} again.`;
  } finally {
    s.pendingPick = null;
  }
}
