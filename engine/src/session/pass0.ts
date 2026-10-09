// Pass 0 on one photo (PRD 6.5): the intent's camera profile and priors, plus a variant's priors on
// a copy (Variants mode, PRD 6.6 step 2), written as one History step; then the clipping baseline
// "until under" (guardrail.ts correct, n = 0) [handle: tests\session-begin.test.ts (the master),
// tests\session-variants.test.ts "makes the copies, runs pass 0 on each …" (the copies), both
// against the Lightroom sim].

import type { GuardrailAction, PassEntry } from "../log/index.js";
import { deltaMetrics, summarize, type MetricsDelta } from "../metrics/index.js";
import { CUSTOM_WHITE_BALANCE_PARAMS, WHITE_BALANCE_UNITS, canonicalValuesEqual, type CanonicalSettings, type CanonicalValue, type FromSdkResult, type ParamMap, type Pipeline } from "../params/index.js";
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
  /** What pass 0 changed of the intent for the photo's pipeline (forPipeline). */
  warnings: string[];
};

/**
 * Pass 0 on photo `t`, whose settings are `view`: render it as it is (or take `original`, a render
 * of the same settings), write the changes as one History step, then the clipping baseline.
 */
export async function pass0(ctx: SessionContext, s: Session, t: Target, view: FromSdkResult, variantPriors: Priors | null, original: Rendered | null): Promise<Pass0> {
  const passStarted = ctx.now().toISOString();
  s.work = { target: t, pass: 0 };
  ctx.deps.hud?.stage(s, "pass0");
  if (original) t.last = original;
  const before = original ?? (await render(ctx, s, t, view));
  const asWritten = combinedPriors(s.intent.intent.priors, variantPriors ?? {}, ctx.deps.map);
  const { profile, priors, warnings } = forPipeline(s.intent.intent.default_camera_profile, asWritten, t.pipeline, ctx.deps.map);
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
  return { passStarted, original: before, requested, applied, historyNames, view: corrected.view, rendered: corrected.rendered, actions: corrected.actions, delta, warnings };
}

/**
 * The intent's profile and priors for the photo's pipeline. Schema v1 intents are written for raw
 * files; until v2 names them per pipeline (Phase 8 row 4), on a rendered photo pass 0 sets the
 * rendered profile of the same kind (Monochrome for a grayscale one, else Color) and leaves out
 * temperature and tint, whose priors are Kelvin offsets, and says both in `warnings`
 * [stated: Jim, 2026-10-08, "Go with recommendations" to PHASE8_PLAN, whose row 3 reads "the loader maps a
 * v1 intent's raw profile to the rendered default for the transition and warns"; the kind-for-kind choice
 * and leaving the Kelvin priors out are the row 3 plan, "Go" 2026-10-09].
 */
export function forPipeline(profile: string | undefined, priors: Priors, pipeline: Pipeline, map: ParamMap): { profile: string | undefined; priors: Priors; warnings: string[] } {
  const warnings: string[] = [];
  const profiles = map.cameraProfiles();
  let chosen = profile;
  if (profile !== undefined && profiles.pipeline(profile) !== pipeline) {
    // Monochrome raw profiles: an Adobe one's Look sets ConvertToGrayscale; the seven Nikon "… Monochrome …"
    // ones have no Look, and each dropped the colour keys on the NEF, 159 keys against 177 for the colour
    // profiles [handle: docs\reports\phase0\S5\part1\s5_profiles.log, keys= per CameraProfile] (Greptile, PR #99).
    const entry = profiles.get(profile);
    const grayscale = entry.look?.Parameters["ConvertToGrayscale"] === true || entry.convert_to_grayscale === true || /Monochrome/.test(entry.name);
    chosen = profiles.names().find((n) => profiles.pipeline(n) === pipeline && profiles.get(n).convert_to_grayscale === grayscale);
    const instead = chosen === undefined ? "leaves the photo's profile as it is" : `sets "${chosen}" instead`;
    warnings.push(`The intent's camera profile "${profile}" is a ${profiles.pipeline(profile)}-pipeline profile and this photo is on the ${pipeline} pipeline: pass 0 ${instead}.`);
  }
  const kept: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(priors)) {
    if (pipeline === "rendered" && CUSTOM_WHITE_BALANCE_PARAMS.includes(name)) {
      warnings.push(`The intent's ${name} prior (${JSON.stringify(value)}) is in the raw pipeline's units; this photo's white balance is ${WHITE_BALANCE_UNITS[pipeline]}, so pass 0 leaves it out.`);
    } else kept[name] = value;
  }
  return { profile: chosen, priors: kept, warnings };
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
    ...(p.warnings.length > 0 ? { warnings: p.warnings } : {}),
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
