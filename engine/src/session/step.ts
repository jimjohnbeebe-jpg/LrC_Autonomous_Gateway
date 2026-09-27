// lr_step: a change per slider, capped by decay and range, checked against the projected
// guardrail, written as one History step, rendered and measured; then the actual guardrail
// (corrections), region preservation and convergence.

import type { GuardrailAction } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { deltaMetrics, summarize, type MetricsDelta } from "../metrics/index.js";
import { canonicalValuesEqual, type CanonicalValue, type FromSdkResult } from "../params/index.js";
import { correct, regionDrift } from "./guardrail.js";
import { brief, describe, failed, fresh, historyName, image, ms, read, recordPass, render, write } from "./io.js";
import { applyProjectedGuardrail, convergedByMetrics, planStep, type StepPlan } from "./plan.js";
import type { Rendered, Session, SessionContext, SessionOutput, StepArgs } from "./types.js";

/** What a step wrote and measured, for its log entry and its result. */
type Applied = { view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[]; historyNames: string[] };

export async function step(ctx: SessionContext, s: Session, args: StepArgs): Promise<SessionOutput> {
  const started = performance.now();
  checkCanStep(s, args);
  const n = s.passes + 1;
  const passStarted = ctx.now().toISOString();
  const beforeView = await read(ctx, s);
  const plan = planStep(args.settings, beforeView.settings, n, ctx.deps.map, s.decay); // ParamError: nothing written
  let baseline: { last: Rendered; refreshed: boolean };
  try {
    baseline = await fresh(ctx, s, beforeView);
  } catch (err) {
    throw failed(ctx, s, `step ${n} (render before the step)`, err);
  }
  applyProjectedGuardrail(plan, summarize(baseline.last.metrics), s.limits, s.slopes);
  if (plan.changes.length === 0) refuseEmpty(s, plan);

  try {
    const beforeRender = baseline.last;
    const done = await apply(ctx, s, n, plan, beforeView);
    const delta = deltaMetrics(beforeRender.metrics, done.rendered.metrics);
    const converged = convergedByMetrics(delta, plan.changes);
    s.passes = n;
    if (converged) s.endReason = "converged";
    else if (n >= s.maxPasses) s.endReason = "cap_reached";
    recordPass(s, {
      n,
      kind: "step",
      target: "master",
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
    });
    const json = stepJson(s, n, plan, done, delta, converged, baseline.refreshed, started);
    const img = await image(s, args.return_image ?? "after", beforeRender, done.rendered, `pass ${n - 1}`, `pass ${n}`);
    return {
      json,
      ...(img ? { image: img } : {}),
      log: {
        session_id: s.id,
        pass: json["pass"],
        history_names: done.historyNames,
        changes: plan.changes.length,
        refused: plan.refused.length,
        guardrail_actions: done.actions.length,
        metrics: brief(done.rendered.metrics),
        converged,
        ...(baseline.refreshed ? { metrics_refreshed: true } : {}),
      },
    };
  } catch (err) {
    throw failed(ctx, s, `step ${n}`, err);
  }
}

function checkCanStep(s: Session, args: StepArgs): void {
  if (args.target !== undefined && args.target !== "master") {
    throw new ToolError("INVALID_ARGUMENTS", 'Only target "master" exists in Converge mode; A/B/C come with Variants mode (Phase 4).', false);
  }
  if (s.endReason === "converged") {
    throw new ToolError("CONVERGED", "The session converged by metrics; further steps are refused. Call lr_end_session (accept or revert).", false, { session_id: s.id });
  }
  if (s.endReason === "cap_reached" || s.passes >= s.maxPasses) {
    throw new ToolError("CAP_REACHED", `All ${s.maxPasses} passes are used. Call lr_end_session (accept or revert).`, false, { session_id: s.id });
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

/** Write the plan as one History step, render it, then the corrections and region preservation. */
async function apply(ctx: SessionContext, s: Session, n: number, plan: StepPlan, beforeView: FromSdkResult): Promise<Applied> {
  const historyNames: string[] = [];
  const name = historyName(s, n);
  const values: Record<string, CanonicalValue> = Object.fromEntries(plan.changes.map((c) => [c.name, c.after]));
  let current = await write(ctx, s, values, name);
  historyNames.push(name);
  let rendered = await render(ctx, s, current.settings);
  const corrected = await correct(ctx, s, n, plan.changes, current, rendered, historyNames);
  current = corrected.view;
  rendered = corrected.rendered;
  const actions = [...corrected.actions];

  // Region preservation: a preserved region whose hue or saturation drifted too far undoes the pass.
  const drift = regionDrift(s, rendered.metrics);
  if (drift) {
    const back: Record<string, CanonicalValue> = {};
    for (const [key, value] of Object.entries(beforeView.settings)) if (!canonicalValuesEqual(current.settings[key], value)) back[key] = value;
    if (Object.keys(back).length > 0) {
      const revertName = historyName(s, n, "region revert");
      current = await write(ctx, s, back, revertName);
      historyNames.push(revertName);
      rendered = await render(ctx, s, current.settings);
      actions.push({ kind: "reverted", limit: "region", reason: drift, history_name: revertName, changes: numericOnly(back), metrics_after: summarize(rendered.metrics) });
    }
  }
  return { view: current, rendered, actions, historyNames };
}

function stepJson(s: Session, n: number, plan: StepPlan, done: Applied, delta: MetricsDelta, converged: boolean, refreshed: boolean, started: number): Record<string, unknown> {
  return {
    ok: true,
    session_id: s.id,
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
    cap_reached: s.endReason === "cap_reached",
    passes_left: s.endReason ? 0 : s.maxPasses - n,
    ...(refreshed ? { metrics_refreshed: "the photo's settings had changed since the last render, so it was rendered again before this step" } : {}),
    ...describe(done.rendered),
    timings: { total_ms: ms(started) },
  };
}

function numericOnly(values: Record<string, CanonicalValue>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).filter((e): e is [string, number] => typeof e[1] === "number"));
}
