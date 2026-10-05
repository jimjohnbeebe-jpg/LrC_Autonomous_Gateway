// The session loop (AVG-003: Claude orchestrates, the engine is a stateful step function;
// ARCHITECTURE section 4, PRD sections 6.5-6.7, 6.12, 6.13, MCP_TOOLS "Session tools").
//
//   lr_begin_session  -> snapshot, pass 0 (camera profile, lens, intent priors, then the clipping
//                        baseline), preview + metrics + the intent's brief               (begin.ts)
//                        Variants mode: virtual copies A-C, pass 0 on each with its variant's
//                        priors, and a contact sheet             (variants.ts, copies.ts, pass0.ts)
//   lr_step           -> a change per slider, capped by decay and range, checked against the
//                        projected guardrail, written as one History step, rendered and measured;
//                        then the actual guardrail (corrections), region preservation, convergence
//                                                                  (step.ts, guardrail.ts)
//   lr_select_variant -> Variants mode: the user's pick, after one refined pass per copy (pick.ts)
//   lr_approve_pass   -> approve_each_pass mode: the user's approval of the pass waiting for it,
//                        given in chat; lr_step waits for it from pass 2 on        (approval.ts)
//   lr_probe          -> per-slider metric slopes, the photo put back afterwards      (probe.ts)
//   lr_set_regions    -> region boxes measured on every render; `preserve` guards hue and
//                        saturation                                                  (regions.ts)
//   lr_end_session    -> accept (log + recipe) or revert (the pre-session snapshot)   (end.ts)
//
// One session at a time per engine. Every command names the session's photo (C-2), so a change of
// selection in Lightroom can never redirect a write: the plugin refuses it and the session stays
// open (TARGET_CHANGED). In Variants mode each call selects its copy first (targets.ts). Variants
// mode is tested against the Lightroom sim [handle: tests\session-variants.test.ts,
// tests\session-variants-faults.test.ts]; in Lightroom it is [unverified] until PHASE4_PLAN row 10.
// The log is rewritten after every pass (log\session-log.ts). This class holds the open session and
// runs the operations one at a time; io.ts has what they share.
// The HUD (PHASE5_PLAN row 5): the operations report their stages (deps.hud), and this class the
// stage once each is over; the user's Abort, Accept and Pick run in the same queue (hud-actions.ts).

import { randomUUID } from "node:crypto";
import { ToolError } from "../mcp/errors.js";
import type { Region } from "../metrics/index.js";
import type { RenderedPreview } from "../preview/index.js";
import { searchOrder } from "../settings/index.js";
import { engineEndedNote } from "./ai-revert.js";
import { approvePass } from "./approval.js";
import { openSession, runPass0 } from "./begin.js";
import { endSession, readSessionLog } from "./end.js";
import { abortedNote, endedError, idleStage, userAction, userEnded, type ActionHost, type UserAction, type UserEnded } from "./hud-actions.js";
import { abortError, checkAbort, read, render } from "./io.js";
import { createMask, deleteMask, editMask, listMasks } from "./masks.js";
import { selectVariant } from "./pick.js";
import { probe } from "./probe.js";
import { setRegions } from "./regions.js";
import { showCopy, type ShowRecord } from "./show-copy.js";
import { watchRestarts } from "./restart.js";
import { step } from "./step.js";
import { focus, resolveTarget } from "./targets.js";
import { folderOf, type ApproveArgs, type BeginArgs, type CreateMaskArgs, type DeleteMaskArgs, type EditMaskArgs, type EndArgs, type ListMasksArgs, type ProbeArgs, type RegionArgs, type SelectArgs, type Session, type SessionContext, type SessionDeps, type SessionOutput, type StepArgs, type TargetId, type VariantId } from "./types.js";
import { runVariants } from "./variants.js";
import { sessionView, type SessionView } from "./view.js";

/** How long the HUD shows a session the engine ended before it closes itself (D15). */
const ENGINE_END_CLOSE_S = 10;

export class SessionManager {
  private readonly ctx: SessionContext;
  private session: Session | null = null;
  /** Log files of sessions that ended in this engine run, by id. */
  private readonly ended = new Map<string, string>();
  /** Sessions the user ended from the HUD or the menu, by id. */
  private readonly endedByUser = new Map<string, UserEnded>();
  /** Sessions the engine ended itself (ai-revert.ts autoRevert), by id: why. */
  private readonly endedByEngine = new Map<string, string>();
  /** The end of the queue of session operations (exclusive()). */
  private tail: Promise<unknown> = Promise.resolve();
  /** Operations of the queue running now (0 or 1). */
  private running = 0;

  constructor(deps: SessionDeps) {
    this.ctx = { deps, now: deps.now ?? (() => new Date()), newId: deps.newId ?? (() => randomUUID()) };
    // A Lightroom restart while an AI mask had no result puts the photo back (restart.ts, D16).
    watchRestarts({ ctx: this.ctx, session: () => this.session, queue: (fn) => void this.exclusive(fn).catch(() => undefined), endedByEngine: (s) => this.engineEnded(s) });
  }

  /** The open session, if any: what the other tools need to know about it. */
  current(): SessionView | null {
    const s = this.session;
    return s ? sessionView(s, s.active.id) : null;
  }

  /** An operation of the session queue runs now (the Deck's selection poll waits for an idle queue, hud\selection.ts). */
  busy(): boolean {
    return this.running > 0;
  }

  /** What the running operation tells the HUD (e.g. that Lightroom computes an AI mask), for MCP progress notifications; null when none runs. */
  workNote(): string | null {
    return this.session?.work?.note ?? null;
  }

  /** The open session with this id, seen from one of its photos (a read: lr_get_metrics). */
  viewOf(sessionId: string, target?: TargetId): SessionView {
    const s = this.require(sessionId);
    return sessionView(s, resolveTarget(s, target, "read").id);
  }

  /** The regions of the open session with this id, for a preview render. */
  regionsOf(sessionId: string): Region[] {
    return this.require(sessionId).regions.map((r) => ({ label: r.label, box: r.box }));
  }

  /**
   * lr_get_preview with a session: render a session photo at `longEdge` and make it that photo's
   * last render, so lr_get_metrics and the next step's deltas describe the image just returned
   * (Greptile, PR #23) [handle: tests\mcp-tools.test.ts "says a session is open on the selected photo,
   * and answers lr_get_metrics from the session's last render": the 800 px preview's hash and width].
   */
  preview(sessionId: string, longEdge: number, target?: TargetId): Promise<RenderedPreview> {
    return this.exclusive(async () => {
      const s = this.require(sessionId);
      checkAbort(s);
      const t = resolveTarget(s, target, "read");
      s.work = { target: t, pass: null };
      await focus(this.ctx, s, t);
      const view = await read(this.ctx, s, t);
      return (await render(this.ctx, s, t, view, { longEdge })).preview;
    });
  }

  /**
   * Select a session photo and run `fn` on it (a region preview, rendered outside the manager), in
   * the session's queue: in Variants mode no other session call can select another copy between the
   * selection and `fn`'s renders.
   */
  withPhoto<T>(sessionId: string, target: TargetId | undefined, fn: (photo: { target: TargetId; uuid: string }) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const s = this.require(sessionId);
      checkAbort(s); // the region preview renders outside render(), which checks it too
      const t = resolveTarget(s, target, "read");
      s.work = { target: t, pass: null };
      await focus(this.ctx, s, t);
      return fn({ target: t.id, uuid: t.uuid });
    });
  }

  /** lr_begin_session. The session is open once the snapshot exists, so a failed pass 0 can be reverted. */
  begin(args: BeginArgs): Promise<SessionOutput> {
    return this.exclusive(async () => {
      if (this.session) {
        throw new ToolError(
          "SESSION_ALREADY_ACTIVE",
          `A session is already open on "${this.session.master.filename ?? this.session.master.uuid}" (${this.session.id}). End it with lr_end_session (accept or revert) first.`,
          false,
          { session_id: this.session.id },
        );
      }
      const opened = await openSession(this.ctx, args);
      this.session = opened.s;
      // The HUD opens by itself once, at lr_begin_session (PHASE5_PLAN decision 6).
      this.ctx.deps.hud?.stage(opened.s, "begin", { open: true });
      return opened.s.mode === "variants" ? runVariants(this.ctx, opened, args) : runPass0(this.ctx, opened, args);
    });
  }

  step(args: StepArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => step(this.ctx, s, args)));
  }

  selectVariant(args: SelectArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => selectVariant(this.ctx, s, args)));
  }

  probe(args: ProbeArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => probe(this.ctx, s, args)));
  }

  setRegions(args: RegionArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => setRegions(s, args)));
  }

  /** The mask tools (masks.ts): a listing, and one pass per change. */
  listMasks(args: ListMasksArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => listMasks(this.ctx, s, args)));
  }

  createMask(args: CreateMaskArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => createMask(this.ctx, s, args)));
  }

  editMask(args: EditMaskArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => editMask(this.ctx, s, args)));
  }

  deleteMask(args: DeleteMaskArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.withNotices(args.session_id, (s) => deleteMask(this.ctx, s, args)));
  }

  /**
   * lr_approve_pass (approval.ts): at once, outside the queue, where an lr_step waiting for this
   * approval holds it [handle: tests\approve-pass.test.ts "lr_approve_pass releases a step that is
   * waiting for it"].
   */
  approvePass(args: ApproveArgs): Promise<SessionOutput> {
    return this.withNotices(args.session_id, async (s) => approvePass(this.ctx, s, args, this.running > 0));
  }

  end(args: EndArgs): Promise<SessionOutput> {
    return this.exclusive(() =>
      this.withNotices(args.session_id, async (s) => {
        // After the user's Abort, "revert" still ends the session (the way out when the Abort's own
        // revert failed); "accept" is refused, as the user asked for the photo back.
        if (s.abort && args.outcome === "accept") throw abortError(s);
        const out = await endSession(this.ctx, s, args);
        // A revert while the user's Abort is pending ends the session as the user's Abort (end.ts).
        const user = args.outcome === "revert" ? s.abort : null;
        this.close(s, user ? userEnded(this.ctx, s, "aborted", user) : null);
        if (user) this.ctx.deps.hud?.stage(s, "aborted", { note: abortedNote(s) });
        else if (args.outcome === "accept") this.ctx.deps.hud?.stage(s, "accepted", { note: "Claude accepted: the edit is kept." });
        else this.ctx.deps.hud?.stage(s, "ended", { note: "Claude reverted: the photo is back as it was before the edit." });
        return out;
      }, true),
    );
  }

  /**
   * A HUD or menu event (hud\events.ts): checked against the open session and acted on in its
   * queue (hud-actions.ts). Returns the note the HUD shows at once.
   */
  userAction(action: UserAction): string {
    return userAction(this.actionHost(), action);
  }

  /** The Deck chose copy `variant` (E12): select it in Lightroom while the edit waits for the pick (show-copy.ts). */
  showCopy(sessionId: string, variant: VariantId, report: (r: ShowRecord) => void): void {
    showCopy(this.actionHost(), sessionId, variant, report);
  }

  private actionHost(): ActionHost {
    return {
      ctx: this.ctx,
      session: () => this.session,
      ended: (id) => this.endedByUser.get(id),
      busy: () => this.running > 0,
      queue: (fn) => void this.exclusive(fn).catch(() => undefined),
      close: (s, ended) => this.close(s, ended),
    };
  }

  /** SESSION_ENDED for a session the user ended from the HUD or the menu; null otherwise. */
  userEndedError(sessionId: string): ToolError | null {
    const ended = this.endedByUser.get(sessionId);
    return ended && this.session?.id !== sessionId ? endedError(ended) : null;
  }

  private close(s: Session, byUser: UserEnded | null): void {
    this.ended.set(s.id, s.files.logPath);
    if (byUser) this.endedByUser.set(s.id, byUser);
    if (this.session === s) this.session = null;
  }

  /**
   * Once the engine put the photo back and ended the session (ai-revert.ts autoRevert, s.endedByEngine): it is
   * closed, and the HUD shows that for 10 s, then closes itself [stated: Jim, 2026-10-04, "Show, then close (Recommended)"].
   */
  private engineEnded(s: Session): void {
    if (!s.endedByEngine || this.session !== s) return;
    this.endedByEngine.set(s.id, s.endedByEngine);
    this.close(s, null);
    this.ctx.deps.hud?.stage(s, "ended", { note: engineEndedNote(s.endedByEngine), closeAfter: ENGINE_END_CLOSE_S });
  }

  /**
   * Run a session call and add the HUD actions Claude has not heard of yet (a pick) to its result.
   * Once the user has aborted the session, only lr_end_session runs (`whileAborting`).
   */
  private async withNotices(sessionId: string, fn: (s: Session) => Promise<SessionOutput>, whileAborting = false): Promise<SessionOutput> {
    const s = this.require(sessionId);
    if (s.abort && !whileAborting) throw abortError(s);
    let out: SessionOutput;
    try {
      out = await fn(s);
    } finally {
      this.engineEnded(s);
    }
    if (s.notices.length === 0) return out;
    return { ...out, json: { ...out.json, hud_actions: s.notices.splice(0) } };
  }

  /** lr_get_session_log (no Lightroom call). */
  getLog(args: { session_id: string }): SessionOutput {
    const dirs = searchOrder(folderOf(this.ctx.deps.logDir), this.ctx.deps.logFolders?.list() ?? []);
    return readSessionLog(dirs, this.session, this.ended, args.session_id);
  }

  /**
   * Run `fn` in the session queue while no session is open (lr_sync_series, PHASE4_PLAN row 8): it
   * is refused with SESSION_ALREADY_ACTIVE when one is, and no session can begin, nor any other
   * session call run, until it ends [stated: Jim, 2026-09-27, "go with recommendations" on the row 8
   * plan, decision 6; handle: tests\sync.test.ts "refuses while a session is open, and a session
   * begun during a sync waits for it"].
   */
  whenIdle<T>(tool: string, fn: () => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      const s = this.session;
      if (s) {
        throw new ToolError(
          "SESSION_ALREADY_ACTIVE",
          `A session is open on "${s.master.filename ?? s.master.uuid}" (${s.id}); ${tool} runs only between sessions. End it with lr_end_session first.`,
          false,
          { session_id: s.id },
        );
      }
      return fn();
    });
  }

  private require(sessionId: string): Session {
    const s = this.session;
    const byUser = this.userEndedError(sessionId);
    if (byUser) throw byUser;
    const byEngine = s?.id === sessionId ? undefined : this.endedByEngine.get(sessionId);
    if (byEngine !== undefined) {
      throw new ToolError("SESSION_ENDED", `The engine ended session ${sessionId}: ${byEngine}. The photo was put back as it was before the session. Start a new session only if the user asks.`, false, { session_id: sessionId, ended_by: "engine", reason: byEngine });
    }
    if (!s || s.id !== sessionId) {
      throw new ToolError(
        "SESSION_NOT_ACTIVE",
        s ? `Session ${sessionId} is not the open one (${s.id}).` : `No session is open (asked for ${sessionId}); start one with lr_begin_session.`,
        false,
      );
    }
    return s;
  }

  /**
   * Run session operations one at a time, in the order called (Greptile, PR #23: parallel steps
   * could share a pass number) [handle: tests\session-step.test.ts "runs steps sent at the same time one
   * after the other, each with its own pass number"].
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const task = async (): Promise<T> => {
      this.running++;
      let error: unknown = undefined;
      try {
        return await fn();
      } catch (err) {
        error = err;
        throw err;
      } finally {
        this.running--;
        this.afterOperation(error);
      }
    };
    const run = this.tail.then(task, task);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /** Once an operation is over, the HUD's stage for the session still open (hud-actions.ts idleStage). */
  private afterOperation(error: unknown): void {
    const s = this.session;
    if (!s) return;
    s.work = null;
    const next = idleStage(s, error);
    if (next) this.ctx.deps.hud?.stage(s, next.stage, next.note !== undefined ? { note: next.note } : {});
  }
}
