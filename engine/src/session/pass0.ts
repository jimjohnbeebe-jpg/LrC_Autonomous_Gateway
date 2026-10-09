// Pass 0 on one photo (PRD 6.5): the intent's camera profile and priors, plus a variant's priors on
// a copy (Variants mode, PRD 6.6 step 2), written as one History step; then the clipping baseline
// "until under" (guardrail.ts correct, n = 0) [handle: tests\session-begin.test.ts (the master),
// tests\session-variants.test.ts "makes the copies, runs pass 0 on each …" (the copies), both
// against the Lightroom sim].

import type { GuardrailAction, PassEntry } from "../log/index.js";
import { deltaMetrics, summarize, type MetricsDelta } from "../metrics/index.js";
import { priorsFor, type PriorSet } from "../intents/index.js";
import { canonicalValuesEqual, type CanonicalSettings, type CanonicalValue, type FromSdkResult, type ParamMap, type Pipeline } from "../params/index.js";
import { correct } from "./guardrail.js";
import { historyName, render, write } from "./io.js";
import type { Change } from "./plan.js";
import { roundForSlider } from "./rules.js";
import type { Rendered, Session, SessionContext, Target } from "./types.js";

type Priors = Readonly<Record<string, unknown>>;

/** What pass 0 did, for its log entry and its result. */
export type Pass0 = {
  passStarted: string;
  original: Rendered;
  requested: Record<string, unknown>;
  applied: Change[];
  historyNames: string[];
  view: FromSdkResult;
  rendered: Rendered;
  actions: GuardrailAction[];
  delta: MetricsDelta;
};

/**
 * Pass 0 on photo `t`, whose settings are `view`: render it as it is (or take `original`, a render
 * of the same settings), write the changes as one History step, then the clipping baseline. The
 * intent's profile and priors are those of the photo's pipeline (intent schema v2), with `variant`'s
 * priors on top on a copy.
 */
export async function pass0(ctx: SessionContext, s: Session, t: Target, view: FromSdkResult, variant: PriorSet | null, original: Rendered | null): Promise<Pass0> {
  const passStarted = ctx.now().toISOString();
  s.work = { target: t, pass: 0 };
  ctx.deps.hud?.stage(s, "pass0");
  if (original) t.last = original;
  const before = original ?? (await render(ctx, s, t, view));
  const intent = s.intent.intent;
  const priors = combinedPriors(priorsFor(intent, t.pipeline), variant ? priorsFor(variant, t.pipeline) : {}, ctx.deps.map);
  const profile = intent.profile?.[t.pipeline];
  const changes = pass0Changes(profile, priors, view.settings, ctx.deps.map, t.pipeline);
  const historyNames: string[] = [];
  let current = view;
  let rendered = before;
  if (Object.keys(changes).length > 0) {
    const name = historyName(s, t, 0);
    current = await write(ctx, s, t, changes, name);
    historyNames.push(name);
    rendered = await render(ctx, s, t, current);
  }
  const corrected = await correct(ctx, s, t, 0, null, current, rendered, historyNames);
  const applied = Object.entries(changes).map(([name, after]): Change => {
    const was = view.settings[name] ?? null;
    return { name, before: was, requested: after, after, delta: typeof was === "number" && typeof after === "number" ? roundForSlider(name, after - was) : null };
  });
  const requested = { ...(profile ? { camera_profile: profile } : {}), ...priors };
  const delta = deltaMetrics(before.metrics, corrected.rendered.metrics);
  return { passStarted, original: before, requested, applied, historyNames, view: corrected.view, rendered: corrected.rendered, actions: corrected.actions, delta };
}

/** Pass 0's log entry for photo `t`. */
export function pass0Entry(s: Session, t: Target, beforeView: FromSdkResult, p: Pass0, durationMs: number): PassEntry {
  const variant = t.id === "master" ? "" : ` + variant ${t.id} (${t.label ?? "?"}) priors`;
  return {
    n: 0,
    kind: "pass0",
    target: t.id,
    started: p.passStarted,
    duration_ms: durationMs,
    history_names: p.historyNames,
    rationale: `engine: camera profile, lens corrections and intent priors${variant}, then the clipping baseline (PRD 6.5)`,
    requested: p.requested,
    changes: p.applied,
    clamped: [],
    refused: [],
    unchanged: [],
    settings_before: beforeView.settings,
    settings_after: p.view.settings,
    metrics_before: summarize(p.original.metrics),
    metrics_after: summarize(p.rendered.metrics),
    delta_metrics: p.delta,
    preview_hash: p.rendered.hash,
    preview_source: "export",
    guardrail_actions: p.actions,
    converged_by_metrics: false,
  };
}

/**
 * The intent's priors with a variant's on top (PRD 6.6 step 2: "pass 0 plus the intent's
 * per-variant prior"): a number in both is added up, as both are offsets; otherwise the variant's
 * value replaces the intent's [inference: the plan for PHASE4_PLAN row 7, approved by Jim 2026-09-27].
 */
export function combinedPriors(base: Priors, extra: Priors, map: ParamMap): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [name, value] of Object.entries(extra)) {
    const was = out[name];
    out[name] = map.spec(name)?.kind === "number" && typeof was === "number" && typeof value === "number" ? was + value : value;
  }
  return out;
}

/** Pass 0's settings: the camera profile, and the priors (numbers added to the photo's values, within range). */
function pass0Changes(profile: string | undefined, priors: Priors, current: CanonicalSettings, map: ParamMap, pipeline: Pipeline): Record<string, CanonicalValue> {
  const out: Record<string, CanonicalValue> = {};
  if (profile !== undefined && current["camera_profile"] !== profile) out["camera_profile"] = profile;
  for (const [name, value] of Object.entries(priors)) {
    const spec = map.spec(name, pipeline);
    if (spec?.kind === "number") {
      const before = current[name];
      if (typeof before !== "number" || typeof value !== "number") continue; // e.g. dropped by a monochrome profile
      const after = roundForSlider(name, Math.min(spec.max, Math.max(spec.min, before + value)));
      if (after !== before) out[name] = after;
    } else if (!canonicalValuesEqual(current[name], value)) {
      out[name] = value as CanonicalValue;
    }
  }
  return out;
}
