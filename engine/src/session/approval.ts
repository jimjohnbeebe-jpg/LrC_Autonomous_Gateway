// approve_each_pass (PRD 6.2 and 6.3, MCP_TOOLS lr_step AWAITING_APPROVAL and lr_approve_pass;
// PHASE5_PLAN decision 4 and row 6). In this mode, the settings page's, the user approves each pass
// they have seen before Claude's next one is written:
//   - lr_begin_session and pass 0 are not gated, and neither is pass 1: the HUD's Approve names a
//     pass from 1 up [handle: engine\src\bridge\hud-protocol.ts `approve_pass` and hud_approve_pass
//     `pass`, int(1, …)];
//   - lr_step for pass n+1 first waits up to APPROVAL_WAIT_MS for the approval of pass n (the HUD's
//     Approve, or lr_approve_pass after the user approved in chat), else returns AWAITING_APPROVAL
//     with nothing read or written;
//   - the wait runs in the session's queue, so it ends at once on the user's Abort (the queued revert
//     runs next) and Accept (the queued accept runs next); lr_approve_pass and the HUD's Approve act
//     outside the queue, or they would wait behind the step they release (PHASE5_PLAN "From row 5");
//   - Variants mode: the passes of the pick are approved; the pick itself approves the pass it was
//     picked at [stated: Jim, 2026-09-30, "Go with recommendations" on the row 6 plan, D1-A];
//   - an approval stays until the next pass counts, so a step that fails before it counts is tried
//     again without a new click [inference: the approval is of the pass the user saw, which is
//     still the photo's last].
// [handle: tests\approve-pass.test.ts, tests\approve-pass-hud.test.ts, against the Lightroom sim; in
// Lightroom [unverified] until PHASE5_PLAN row 7.]

import { ToolError } from "../mcp/errors.js";
import { abortError, saveLog } from "./io.js";
import { variant } from "./targets.js";
import type { ApprovalBy, ApprovalWait, ApprovalWake, ApproveArgs, Session, SessionContext, SessionOutput, Target } from "./types.js";

/**
 * How long lr_step waits for an approval: PHASE5_PLAN decision 4, approved by Jim 2026-09-28 [stated:
 * "Go with recommendations"]; the number itself is [inference]. It is under the 73.6 s tool call
 * Claude Desktop completed in Phase 4 [handle: vault ARCHITECTURE.md section 6 "Phase 4"]; the
 * step's own work comes on top, and Desktop's timeout is [unverified] (PHASE5_PLAN row 7 records
 * what held).
 */
export const APPROVAL_WAIT_MS = 60000;

/** What a step went ahead on: the pass approved, by whom, and how long the step waited for it. */
export type StepApproval = { pass: number; by: ApprovalBy; waited_ms: number };

/** The session runs in approve_each_pass mode (the settings page's mode, read at lr_begin_session). */
export const approveEachPass = (s: Session): boolean => s.log.settings?.approval === "approve_each_pass";

/** The photo whose passes are approved: the master (Converge mode), the pick (Variants mode; none before it). */
function edited(s: Session): Target | null {
  if (s.mode === "converge") return s.master;
  return s.picked ? variant(s, s.picked) : null;
}

/** The last pass of photo `t` the user approved (0: none). */
const approvedPass = (s: Session, t: Target): number => (s.approval?.target === t.id ? s.approval.pass : 0);

/**
 * The pass waiting for the user's approval, or null: the edited photo's last pass, from 1 up, not yet
 * approved, while another pass may follow.
 */
export function pendingApproval(s: Session): { target: Target; pass: number } | null {
  if (!approveEachPass(s) || s.abort) return null;
  const t = edited(s);
  if (!t || t.passes < 1 || t.endReason !== null || t.passes >= s.maxPasses) return null;
  return approvedPass(s, t) >= t.passes ? null : { target: t, pass: t.passes };
}

/** The HUD's note while a pass waits for approval. */
export const approvalNote = (pass: number): string => `Approve pass ${pass} to let Claude make the next pass (or tell Claude in chat).`;

/** Record the approval of photo `t`'s pass `pass` in the session and its log. */
export function recordApproval(ctx: SessionContext, s: Session, t: Target, pass: number, by: ApprovalBy): void {
  const at = ctx.now().toISOString();
  s.approval = { target: t.id, pass, by, at };
  (s.log.approvals ??= []).push({ at, target: t.id, pass, by });
  try {
    saveLog(s);
  } catch {
    // the approval matters more than the log write
  }
}

/** An approval asked for (the HUD names the pass it showed): approved, already approved, or why not. */
export type ApproveResult = { ok: true; pass: number; already: boolean; woke: boolean } | { ok: false; reason: string };

export function approve(ctx: SessionContext, s: Session, by: ApprovalBy, pass?: number): ApproveResult {
  if (!approveEachPass(s)) return { ok: false, reason: "This session runs in autonomous mode: its passes need no approval." };
  if (s.abort) return { ok: false, reason: "The session is being aborted." };
  const waiting = pendingApproval(s);
  const t = edited(s);
  if (!waiting) {
    const last = t ? approvedPass(s, t) : 0;
    if (t && last >= 1 && last === t.passes && (pass === undefined || pass === last)) return { ok: true, pass: last, already: true, woke: false };
    return { ok: false, reason: `No pass waits for approval: ${notWaitingReason(s, t)}.` };
  }
  if (pass !== undefined && pass !== waiting.pass) return { ok: false, reason: `Pass ${pass} is not the one waiting for approval; pass ${waiting.pass} is.` };
  if (s.approvalWait?.why === "accept") return { ok: false, reason: "Accept came first: the session is ending with the edit kept, and no further pass is made." };
  recordApproval(ctx, s, waiting.target, waiting.pass, by);
  const woke = s.approvalWait !== null;
  s.approvalWait?.wake("approved");
  return { ok: true, pass: waiting.pass, already: false, woke };
}

function notWaitingReason(s: Session, t: Target | null): string {
  if (!t) return "no copy is picked yet (a Variants session's passes are approved after the pick)";
  if (t.endReason === "converged") return "the session converged; no further pass follows";
  if (t.endReason === "cap_reached" || t.passes >= s.maxPasses) return `all ${s.maxPasses} passes are used`;
  if (t.passes < 1) return "no pass after pass 0 has been made yet (pass 1 needs no approval)";
  return `pass ${t.passes} is approved already`;
}

/** End a waiting step's wait at once: the user approved, or clicked Abort or Accept. */
export function wakeApproval(s: Session, why: ApprovalWake): void {
  s.approvalWait?.wake(why);
}

const STRENGTH = { timeout: 0, approved: 1, accept: 2, abort: 3 } as const;

/**
 * Wait until woken or `waitMs` pass. Every event the bridge client handles before the step resumes
 * (one read can carry several [handle: engine\src\bridge\client.ts onData, the `for (const line of
 * lines)` loop]) still counts, and the strongest wins: Abort, then Accept, then the approval, so the
 * order of two clicks in one read cannot let the step write a pass the user ended the session before
 * (Greptile, PR #48) [handle: tests\approve-pass-hud.test.ts "… in one bridge read: …"].
 */
async function waitForWake(s: Session, waitMs: number): Promise<ApprovalWake | "timeout"> {
  const wait: ApprovalWait = { why: null, wake: () => {} };
  await new Promise<void>((resolve) => {
    const end = (w: ApprovalWake | "timeout"): void => {
      if (wait.why === null || STRENGTH[w] > STRENGTH[wait.why]) wait.why = w;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => end("timeout"), waitMs);
    wait.wake = end;
    s.approvalWait = wait;
  });
  s.approvalWait = null;
  return wait.why ?? "timeout";
}

/**
 * Before step n+1 of photo `t`: wait for the approval of pass n, when one is needed. Returns what the
 * step goes ahead on (null: no approval needed); throws SESSION_ENDED on the user's Abort and
 * AWAITING_APPROVAL on the user's Accept or once `waitMs` pass.
 */
export async function awaitApproval(ctx: SessionContext, s: Session, t: Target): Promise<StepApproval | null> {
  if (!approveEachPass(s) || t.passes < 1) return null;
  const given = (waited: number): StepApproval | null => (s.approval && approvedPass(s, t) >= t.passes ? { pass: s.approval.pass, by: s.approval.by, waited_ms: waited } : null);
  const already = given(0);
  if (already) return already;
  const started = performance.now();
  s.work = { target: t, pass: t.passes };
  ctx.deps.hud?.stage(s, "awaiting_approval", { note: `Claude's pass ${t.passes + 1} waits for your Approve of pass ${t.passes}.` });
  const why = await waitForWake(s, ctx.deps.approvalWaitMs ?? APPROVAL_WAIT_MS);
  const waited = Math.round(performance.now() - started);
  if (s.abort) {
    s.abort.interrupted ??= `step ${t.passes + 1} (waiting for approval)`;
    throw abortError(s);
  }
  // What ended the wait comes before an approval recorded meanwhile (waitForWake).
  const details = { session_id: s.id, target: t.id, pass: t.passes, waited_ms: waited };
  if (why === "accept") {
    throw new ToolError("AWAITING_APPROVAL", `The user clicked Accept while pass ${t.passes + 1} waited for approval: nothing was written, and the session is ending with the edit kept.`, false, details);
  }
  const approved = given(waited);
  if (approved) return approved;
  throw new ToolError(
    "AWAITING_APPROVAL",
    `Pass ${t.passes} waits for the user's approval (${Math.round(waited / 1000)} s waited); nothing was written and the pass is not used. ` +
      `Tell the user pass ${t.passes} is waiting for their Approve in the LrC-AVG HUD (or their go-ahead in chat, then lr_approve_pass), then call lr_step again.`,
    true,
    details,
  );
}

/** lr_approve_pass: the user approved the waiting pass in chat. */
export function approvePass(ctx: SessionContext, s: Session, args: ApproveArgs, busy: boolean): SessionOutput {
  if (args.confirmed !== true) {
    throw new ToolError("NOT_CONFIRMED", "Ask the user to approve the pass in the chat first, then call again with confirmed: true.", false);
  }
  const r = approve(ctx, s, "claude");
  if (!r.ok) throw new ToolError("NOT_AWAITING_APPROVAL", r.reason, false, { session_id: s.id });
  if (!r.already && !r.woke && !busy) ctx.deps.hud?.stage(s, "awaiting_claude", { note: `Pass ${r.pass} approved in chat: Claude goes on at its next call.` });
  const next = r.woke ? "The waiting lr_step goes ahead now." : "Call lr_step for the next pass.";
  return {
    json: { ok: true, session_id: s.id, approved_pass: r.pass, ...(r.already ? { already_approved: true } : {}), next },
    log: { session_id: s.id, approved_pass: r.pass, ...(r.already ? { already_approved: true } : {}), woke: r.woke },
  };
}
