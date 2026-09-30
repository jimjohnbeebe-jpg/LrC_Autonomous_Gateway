// The HUD's buttons and menu items acting on the open session (PRD 6.3 and FR-1.1, PHASE5_PLAN row 5;
// the events are bridge\hud-protocol.ts's, received by hud\events.ts). Each event is checked against
// the open session, answered at once with a note the HUD shows, and acted on in the session's queue,
// after the running operation:
//   - Abort (PHASE5_PLAN decision 3): the running operation stops before its next write or export
//     (io.ts checkAbort), then the pre-session snapshot is applied, as lr_end_session "revert" does;
//     the log's outcome is "aborted";
//   - Accept: after the running operation, as lr_end_session "accept" (Variants mode: after a pick);
//     it waits rather than stops, so no pass is left half done (a write without its corrections);
//   - Pick: as lr_select_variant; Claude learns of it in its next session tool result
//     (`hud_actions`), since an MCP server cannot call the model [inference: PHASE5_PLAN "Assumptions"];
//   - Approve pass: answered only; approve_each_pass is PHASE5_PLAN row 6.
// A session the user ended answers every later call naming it with SESSION_ENDED (endedError).
// [handle: tests\hud-abort.test.ts, tests\hud-actions.test.ts, against the Lightroom sim; in
// Lightroom [unverified] until the row 5 probe and PHASE5_PLAN row 7.]

import type { HudEvent, HudStage } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { endSession } from "./end.js";
import { saveLog } from "./io.js";
import { awaitingPick, selectVariant } from "./pick.js";
import { variant } from "./targets.js";
import type { Session, SessionContext, UserEnd, UserSource, VariantId } from "./types.js";

/** A HUD event as the engine received it: when, and performance.now() then. */
export type UserAction = HudEvent & { received: Date; t0: number };

/** A session the user ended from the HUD or the menu, for the calls that still name it. */
export type UserEnded = { session_id: string; outcome: "aborted" | "accept"; source: UserSource; at: string; log_path: string };

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
    if (ended) return `The session had already ended (${ended.outcome === "aborted" ? "aborted" : "accepted"}).`;
    return "That session is not open in the engine.";
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
      return "Approve is not acted on yet: this engine does not wait for an approval between passes.";
  }
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

function ended(ctx: SessionContext, s: Session, outcome: UserEnded["outcome"], by: UserEnd): UserEnded {
  return { session_id: s.id, outcome, source: by.source, at: ctx.now().toISOString(), log_path: s.files.logPath };
}

async function connected(ctx: SessionContext): Promise<void> {
  if (ctx.deps.client.getState() !== "connected") await ctx.deps.client.waitConnected(RECONNECT_WAIT_MS);
}

function abort(host: ActionHost, s: Session, a: UserAction): string {
  if (s.abort?.state === "pending") return "Abort is already under way.";
  s.abort = userEnd(a, s.abort); // a second click after a failed revert tries again
  const running = host.busy();
  host.queue(() => finishAbort(host, s));
  return running ? "Abort: stopping before the next write or preview, then putting the photo back." : "Abort: putting the photo back as it was before the session.";
}

async function finishAbort(host: ActionHost, s: Session): Promise<void> {
  const by = s.abort;
  if (host.session() !== s || !by) return;
  const { ctx } = host;
  try {
    await connected(ctx);
    await endSession(ctx, s, { session_id: s.id, outcome: "revert" }, by);
    host.close(s, ended(ctx, s, "aborted", by));
    const differing = s.log.revert?.differing.length ?? 0;
    const back = s.mode === "variants" ? "the master is as before; the copies stay in the catalog" : "the photo is back as it was before the session";
    ctx.deps.hud?.stage(s, "aborted", { note: differing ? `Aborted, but ${differing} setting(s) differ from before: see the session log.` : `Aborted: ${back}.` });
  } catch (err) {
    by.state = "failed";
    ctx.deps.hud?.stage(s, "awaiting_claude", { note: `Abort could not put the photo back (${toToolError(err).code}). Click Abort again.` });
  }
}

/** Why Accept cannot end this session now, or null. */
function acceptRefusal(s: Session): string | null {
  if (s.mode === "variants" && s.picked === null) return "Accept keeps the pick's edit: click Pick first, or Abort.";
  return null;
}

function accept(host: ActionHost, s: Session, a: UserAction): string {
  if (s.abort) return "The session is being aborted.";
  const refused = acceptRefusal(s);
  if (refused) return refused;
  const by = userEnd(a, null);
  const running = host.busy();
  host.queue(() => finishAccept(host, s, by));
  return running ? "Accept: keeping the edit once the running call is done." : "Accept: keeping the edit.";
}

async function finishAccept(host: ActionHost, s: Session, by: UserEnd): Promise<void> {
  if (host.session() !== s || s.abort) return;
  const { ctx } = host;
  const refused = acceptRefusal(s);
  if (refused) {
    s.idleNote = refused;
    return;
  }
  try {
    await connected(ctx);
    await endSession(ctx, s, { session_id: s.id, outcome: "accept" }, by);
    host.close(s, ended(ctx, s, "accept", by));
    const kept = s.mode === "variants" ? `on copy ${s.picked ?? "?"}; the other copies stay in the catalog` : "and the recipe written";
    ctx.deps.hud?.stage(s, "accepted", { note: `Accepted: the edit is kept ${kept}.` });
  } catch (err) {
    s.idleNote = `Accept failed (${toToolError(err).code}); the session is still open. Click Accept again.`;
  }
}

/** Why a Pick of copy `v` cannot be made now, or null. */
function pickRefusal(s: Session, v: VariantId): string | null {
  if (s.mode !== "variants") return "Pick is for a Variants session.";
  if (!s.ready) return "Not every copy was made; the session can only be aborted.";
  if (s.picked !== null) return `Copy ${s.picked} is already picked.`;
  if (!variant(s, v)) return `This session has no copy ${v}.`;
  return null;
}

function pick(host: ActionHost, s: Session, v: VariantId, source: UserSource): string {
  if (s.abort) return "The session is being aborted.";
  const refused = pickRefusal(s, v);
  if (refused) return refused;
  host.queue(() => finishPick(host, s, v, source));
  return `Pick ${v}: selecting copy ${v}.`;
}

async function finishPick(host: ActionHost, s: Session, v: VariantId, source: UserSource): Promise<void> {
  if (host.session() !== s || s.abort) return;
  const refused = pickRefusal(s, v);
  if (refused) {
    s.idleNote = refused;
    return;
  }
  try {
    await selectVariant(host.ctx, s, { session_id: s.id, variant: v }, source);
    s.notices.push({ action: "pick", variant: v, source, at: host.ctx.now().toISOString() });
    s.idleNote = `Picked ${v}: Claude continues on copy ${v} at its next call.`;
  } catch (err) {
    s.idleNote = `Pick ${v} failed (${toToolError(err).code}). Click Pick again.`;
  }
}

/**
 * The HUD's stage once an operation of the open session is over (`error`: why it failed, if it did),
 * or null when the HUD is told otherwise (an Abort reports its own stages).
 */
export function idleStage(s: Session, error: unknown): { stage: HudStage; note?: string } | null {
  if (s.abort) return null;
  const given = s.idleNote;
  s.idleNote = null;
  const at = (stage: HudStage, note: string | null): { stage: HudStage; note?: string } => (note ? { stage, note } : { stage });
  if (error !== undefined) {
    const e = toToolError(error);
    if (e.code === "SESSION_ENDED") return null;
    if (e.code === "TARGET_CHANGED") return at("target_changed", given ?? "Lightroom's selection changed, so nothing was written; the session is still open.");
    return at("awaiting_claude", given ?? `Claude's last call failed (${e.code}); the session is still open.`);
  }
  if (awaitingPick(s)) return at("awaiting_pick", given ?? "Pick a copy here, or tell Claude which one.");
  const t = s.active;
  if (t.endReason === "converged") return at("converged", given ?? "Converged: Accept keeps the edit, Abort puts the photo back.");
  if (t.endReason === "cap_reached") return at("awaiting_claude", given ?? `All ${s.maxPasses} passes are used: Accept keeps the edit, Abort puts the photo back.`);
  return at("awaiting_claude", given);
}

/** The answer to a call naming a session the user ended from the HUD or the menu. */
export function endedError(e: UserEnded): ToolError {
  const how = e.outcome === "aborted" ? "aborted it: the photo is back as it was before the session" : "accepted it: the edit is kept and the recipe written";
  const where = e.source === "menu" ? "Lightroom's menu" : "the HUD";
  return new ToolError("SESSION_ENDED", `The user ended session ${e.session_id} from ${where} at ${e.at} and ${how}. Start a new session only if the user asks.`, false, e);
}
