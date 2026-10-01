// lr_step: a change per slider, capped by decay and range, checked against the projected
// guardrail, written as one History step, rendered and measured; then the actual guardrail
// (corrections), the undo of a pass that still breaches a limit or moves a preserved region, and
// convergence. In Variants mode the step names its copy (targets.ts), each copy takes one refined
// pass before the pick, and the step that completes that round returns the contact sheet (pick.ts)
// [handle: tests\session-variants.test.ts "steps each copy once, refuses a second step before the
// pick, and ends the round with awaiting_pick and the contact sheet", against the Lightroom sim].
// In approve_each_pass mode a step from pass 2 on first waits for the user's approval (approval.ts).

import type { GuardrailAction } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { deltaMetrics, summarize, type MetricsDelta } from "../metrics/index.js";
import type { CanonicalValue, FromSdkResult } from "../params/index.js";
import { approveEachPass, awaitApproval } from "./approval.js";
import { clipBreach, correct, regionDrift, undo } from "./guardrail.js";
import { brief, describe, failed, fresh, historyName, image, ms, read, recordPass, render, write } from "./io.js";
import { awaitingPick, checkVariantStep, pickRound } from "./pick.js";
import { applyProjectedGuardrail, convergedByMetrics, planStep, type StepPlan } from "./plan.js";
import { focus, resolveTarget } from "./targets.js";
import type { Rendered, Session, SessionContext, SessionOutput, StepArgs, Target } from "./types.js";

/** What a step wrote and measured, for its log entry and its result. */
type Applied = { view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[]; historyNames: string[] };

export async function step(ctx: SessionContext, s: Session, args: StepArgs): Promise<SessionOutput> {
  const started = performance.now();
  const t = resolveTarget(s, args.target, "write");
  checkCanStep(s, t, args);
  const n = t.passes + 1;
  // approve_each_pass: names and types are checked before the wait, so a typo is not heard of only
  // after it (ParamError: nothing written); then the approval of pass n-1 (approval.ts).
  if (approveEachPass(s) && t.passes >= 1) planStep(args.settings, t.last?.settings ?? s.startSettings, n, ctx.deps.map, s.decay);
  const approval = await awaitApproval(ctx, s, t);
  const passStarted = ctx.now().toISOString();
  s.work = { target: t, pass: n };
  await focus(ctx, s, t);
  const beforeView = await read(ctx, s, t);
  const plan = planStep(args.settings, beforeView.settings, n, ctx.deps.map, s.decay); // ParamError: nothing written
  let baseline: { last: Rendered; refreshed: boolean };
  try {
    baseline = await fresh(ctx, s, t, beforeView);
  } catch (err) {
    throw failed(ctx, s, `step ${n}${label(t)} (render before the step)`, err);
  }
  applyProjectedGuardrail(plan, summarize(baseline.last.metrics), s.limits, t.slopes);
  if (plan.changes.length === 0) refuseEmpty(s, plan);

  try {
    const beforeRender = baseline.last;
    const done = await apply(ctx, s, t, n, plan, beforeView, beforeRender);
    const delta = deltaMetrics(beforeRender.metrics, done.rendered.metrics);
    const converged = convergedByMetrics(delta, plan.changes);
    t.passes = n;
    if (converged) t.endReason = "converged";
    else if (n >= s.maxPasses) t.endReason = "cap_reached";
    recordPass(s, {
      n,
      kind: "step",
      target: t.id,
      started: passStarted,
      duration_ms: ms(started),
      history_names: done.historyNames,
      rationale: args.rationale,
      requested: args.settings,
      changes: plan.changes,
      clamped: plan.clamped,
      refused: plan.refused,
      unchanged: plan.unchanged,
      settings_before: beforeView.settings,
      settings_after: done.view.settings,
      metrics_before: summarize(beforeRender.metrics),
      metrics_after: summarize(done.rendered.metrics),
      delta_metrics: delta,
      preview_hash: done.rendered.hash,
      preview_source: "export",
      guardrail_actions: done.actions,
      converged_by_metrics: converged,
      ...(approval ? { approval } : {}),
    });
    const json: Record<string, unknown> = { ...stepJson(s, t, n, plan, done, delta, converged, baseline.refreshed, started), ...(approval ? { approval } : {}) };
    const round = awaitingPick(s) ? await pickRound(s, args.return_image ?? "after") : null;
    const img = round ? round.image : await image(s, args.return_image ?? "after", beforeRender, done.rendered, `pass ${n - 1}`, `pass ${n}`);
    return {
      json: round ? { ...json, ...round.json } : json,
      ...(img ? { image: img } : {}),
      log: {
        session_id: s.id,
        pass: json["pass"],
        ...(t.id !== "master" ? { target: t.id } : {}),
        history_names: done.historyNames,
        changes: plan.changes.length,
        refused: plan.refused.length,
        guardrail_actions: done.actions.length,
        metrics: brief(done.rendered.metrics),
        converged,
        ...(baseline.refreshed ? { metrics_refreshed: true } : {}),
        ...(json["undone"] ? { undone: (json["undone"] as { limit: string }).limit } : {}),
        ...(round ? { awaiting_pick: true } : {}),
        ...(approval ? { approval } : {}),
      },
    };
  } catch (err) {
    throw failed(ctx, s, `step ${n}${label(t)}`, err);
  }
}

const label = (t: Target): string => (t.id === "master" ? "" : ` of copy ${t.id}`);

function checkCanStep(s: Session, t: Target, args: StepArgs): void {
  checkVariantStep(s, t);
  const copy = t.id === "master" ? "" : ` of copy ${t.id}`;
  if (t.endReason === "converged") {
    const who = t.id === "master" ? "The session" : `Copy ${t.id}`;
    throw new ToolError("CONVERGED", `${who} converged by metrics; further steps are refused. Call lr_end_session (accept or revert).`, false, { session_id: s.id });
  }
  if (t.endReason === "cap_reached" || t.passes >= s.maxPasses) {
    throw new ToolError("CAP_REACHED", `All ${s.maxPasses} passes${copy} are used. Call lr_end_session (accept or revert).`, false, { session_id: s.id });
  }
  if (Object.keys(args.settings).length === 0) throw new ToolError("INVALID_ARGUMENTS", "settings must name at least one parameter.", false);
}

/** A plan with no change left: nothing is written and the pass is not used. */
function refuseEmpty(s: Session, plan: StepPlan): never {
  const details = { session_id: s.id, refused: plan.refused, clamped: plan.clamped, unchanged: plan.unchanged };
  const listed = plan.refused.map((r) => `${r.name}: ${r.reason}`).join("; ");
  if (plan.refused.some((r) => r.by === "guardrail")) {
    throw new ToolError("GUARDRAIL_REFUSED", `Nothing was written: every change was refused (${listed}). The pass is not used.`, false, details);
  }
  throw new ToolError(
    "NO_CHANGE",
    `Nothing was written: ${listed ? `no requested change can be made (${listed})` : "the requested settings are already in place"}. The pass is not used.`,
    false,
    details,
  );
}

/**
 * Write the plan as one History step, render it, then the corrections. The pass is undone when
 * clipping is still over a limit the photo was within before it, or a preserved region drifted
 * too far.
 */
async function apply(ctx: SessionContext, s: Session, t: Target, n: number, plan: StepPlan, beforeView: FromSdkResult, before: Rendered): Promise<Applied> {
  const historyNames: string[] = [];
  const name = historyName(s, t, n);
  const values: Record<string, CanonicalValue> = Object.fromEntries(plan.changes.map((c) => [c.name, c.after]));
  const written = await write(ctx, s, t, values, name);
  historyNames.push(name);
  const corrected = await correct(ctx, s, t, n, plan.changes, written, await render(ctx, s, t, written.settings), historyNames);
  const actions = [...corrected.actions];

  const drift = regionDrift(s, t, corrected.rendered.metrics);
  const breach = clipBreach(s, before.metrics, corrected.rendered.metrics) ?? (drift ? { limit: "region" as const, reason: drift } : null);
  const undone = breach ? await undo(ctx, s, t, n, beforeView, corrected.view, breach, historyNames) : null;
  if (!undone) return { view: corrected.view, rendered: corrected.rendered, actions, historyNames };
  actions.push(undone.action);
  return { view: undone.view, rendered: undone.rendered, actions, historyNames };
}

function stepJson(s: Session, t: Target, n: number, plan: StepPlan, done: Applied, delta: MetricsDelta, converged: boolean, refreshed: boolean, started: number): Record<string, unknown> {
  // An undone pass says so at the top level: `applied` stays the record of what was written
  // (Greptile, PR #27: a reverted pass read as applied).
  const undone = done.actions.find((a) => a.kind === "reverted");
  return {
    ok: true,
    session_id: s.id,
    target: t.id,
    pass: `${n}/${s.maxPasses}`,
    history_names: done.historyNames,
    applied: plan.changes,
    clamped: plan.clamped,
    refused: plan.refused,
    unchanged: plan.unchanged,
    guardrail_actions: done.actions,
    settings: done.view.settings,
    metrics: summarize(done.rendered.metrics),
    delta_metrics: delta,
    converged_by_metrics: converged,
    cap_reached: t.endReason === "cap_reached",
    passes_left: t.endReason ? 0 : s.maxPasses - n,
    ...(refreshed ? { metrics_refreshed: "the photo's settings had changed since the last render, so it was rendered again before this step" } : {}),
    ...(undone ? { undone: { limit: undone.limit, reason: undone.reason, note: "the changes in `applied` were written, then undone: `settings` are as before this pass" } } : {}),
    ...describe(done.rendered),
    timings: { total_ms: ms(started) },
  };
}
