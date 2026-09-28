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

import { randomUUID } from "node:crypto";
import { ToolError } from "../mcp/errors.js";
import type { Metrics, Region } from "../metrics/index.js";
import type { RenderedPreview } from "../preview/index.js";
import { openSession, runPass0 } from "./begin.js";
import { endSession, readSessionLog } from "./end.js";
import { read, render } from "./io.js";
import { selectVariant } from "./pick.js";
import { probe } from "./probe.js";
import { setRegions } from "./regions.js";
import { step } from "./step.js";
import { allTargets, focus, resolveTarget } from "./targets.js";
import type { BeginArgs, EndArgs, ProbeArgs, RegionArgs, SelectArgs, Session, SessionContext, SessionDeps, SessionOutput, StepArgs, TargetId } from "./types.js";
import { runVariants } from "./variants.js";

/** The open session as the other tools see it: its photos, and the one the last call worked on. */
export type SessionView = {
  id: string;
  mode: Session["mode"];
  /** The photo the last call worked on (Converge mode: the master; after a pick: the pick). */
  target: TargetId;
  uuid: string;
  filename: string | null;
  /** Every photo of the session, the master first, with its pass. */
  photos: Array<{ target: TargetId; uuid: string; pass: string }>;
  pass: string;
  last: { metrics: Metrics; hash: string; width: number; height: number } | null;
};

export class SessionManager {
  private readonly ctx: SessionContext;
  private session: Session | null = null;
  /** Log files of sessions that ended in this engine run, by id. */
  private readonly ended = new Map<string, string>();
  /** The end of the queue of session operations (exclusive()). */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(deps: SessionDeps) {
    this.ctx = { deps, now: deps.now ?? (() => new Date()), newId: deps.newId ?? (() => randomUUID()) };
  }

  /** The open session, if any: what the other tools need to know about it. */
  current(): SessionView | null {
    const s = this.session;
    return s ? this.view(s, s.active.id) : null;
  }

  /** The open session with this id, seen from one of its photos (a read: lr_get_metrics). */
  viewOf(sessionId: string, target?: TargetId): SessionView {
    const s = this.require(sessionId);
    return this.view(s, resolveTarget(s, target, "read").id);
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
      const t = resolveTarget(s, target, "read");
      await focus(this.ctx, s, t);
      const view = await read(this.ctx, s, t);
      return (await render(this.ctx, s, t, view.settings, { longEdge })).preview;
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
      const t = resolveTarget(s, target, "read");
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
      return opened.s.mode === "variants" ? runVariants(this.ctx, opened, args) : runPass0(this.ctx, opened, args);
    });
  }

  step(args: StepArgs): Promise<SessionOutput> {
    return this.exclusive(() => step(this.ctx, this.require(args.session_id), args));
  }

  selectVariant(args: SelectArgs): Promise<SessionOutput> {
    return this.exclusive(() => selectVariant(this.ctx, this.require(args.session_id), args));
  }

  probe(args: ProbeArgs): Promise<SessionOutput> {
    return this.exclusive(() => probe(this.ctx, this.require(args.session_id), args));
  }

  setRegions(args: RegionArgs): Promise<SessionOutput> {
    return this.exclusive(() => setRegions(this.require(args.session_id), args));
  }

  end(args: EndArgs): Promise<SessionOutput> {
    return this.exclusive(async () => {
      const s = this.require(args.session_id);
      const out = await endSession(this.ctx, s, args);
      this.ended.set(s.id, s.files.logPath);
      this.session = null;
      return out;
    });
  }

  /** lr_get_session_log (no Lightroom call). */
  getLog(args: { session_id: string }): SessionOutput {
    return readSessionLog(this.ctx.deps.logDir, this.session, this.ended, args.session_id);
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

  private view(s: Session, id: TargetId): SessionView {
    const t = allTargets(s).find((x) => x.id === id) ?? s.active;
    return {
      id: s.id,
      mode: s.mode,
      target: t.id,
      uuid: t.uuid,
      filename: t.filename,
      photos: allTargets(s).map((x) => ({ target: x.id, uuid: x.uuid, pass: `${x.passes}/${s.maxPasses}` })),
      pass: `${t.passes}/${s.maxPasses}`,
      last: t.last ? { metrics: t.last.metrics, hash: t.last.hash, width: t.last.width, height: t.last.height } : null,
    };
  }

  private require(sessionId: string): Session {
    const s = this.session;
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
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }
}
