// Pure step planning for the session loop (ARCHITECTURE section 4, PRD section 6.5): what a
// requested step becomes after decay, slider limits and the projected guardrail, which sliders to
// pull back after a breach, and when a session has converged by metrics. No I/O, so the tests can
// check every rule directly.

import type { MetricsDelta, MetricsSummary } from "../metrics/index.js";
import { CAMERA_PROFILE_PARAM, ParamError, SUPPORTED_PROCESS_VERSIONS, type CanonicalSettings, type CanonicalValue, type ParamMap, type Pipeline } from "../params/index.js";
import { CONVERGENCE, CRUSHES_SHADOWS, RAISES_HIGHLIGHTS, baseMaxStep, decayFor, minStep, roundForSlider } from "./rules.js";

/** One setting a step changes. `delta` is set for numeric sliders (after - before), null otherwise. */
export type Change = { name: string; before: CanonicalValue | null; requested: CanonicalValue; after: CanonicalValue; delta: number | null };
export type Clamp = { name: string; requested: number; applied: number; reason: string };
/** `by`: the projected guardrail, or the slider itself (not available, or no room left in its range). */
export type Refusal = { name: string; reason: string; by: "guardrail" | "slider" };
export type StepPlan = { changes: Change[]; clamped: Clamp[]; refused: Refusal[]; unchanged: string[] };
export type Limits = { clipHighPct: number; clipLowPct: number };
/** Metric change per unit of a slider, from lr_probe. */
export type Slope = { luma_mean: number; clip_high_pct: number; clip_low_pct: number };

const EPSILON = 1e-9;
const sign = (x: number): number => (x > EPSILON ? 1 : x < -EPSILON ? -1 : 0);
const fmt = (x: number): string => String(Math.round(x * 1000) / 1000);
const signed = (x: number): string => `${x > 0 ? "+" : ""}${fmt(x)}`;

/**
 * Turn the requested step into changes. Numeric sliders take a CHANGE (added to the current value),
 * capped at base maximum x the pass's decay and at the slider's range, and rounded to the slider's
 * precision. The camera profile, switches, booleans and curves take the value to set. Unknown names
 * and wrong types throw ParamError, so nothing is written for a malformed request.
 */
export function planStep(requested: Readonly<Record<string, unknown>>, current: Readonly<CanonicalSettings>, pass: number, map: ParamMap, decay?: readonly number[], pipeline: Pipeline = "raw"): StepPlan {
  const plan: StepPlan = { changes: [], clamped: [], refused: [], unchanged: [] };
  const context = { processVersion: SUPPORTED_PROCESS_VERSIONS[0] as string, pipeline };
  const factor = decayFor(pass, decay);
  for (const [name, value] of Object.entries(requested)) {
    const spec = map.spec(name, pipeline);
    if (name === CAMERA_PROFILE_PARAM || !spec || spec.kind !== "number") {
      map.toSdk({ [name]: value }, context); // throws for an unknown name, a wrong type or a bad value
      const before = current[name] ?? null;
      if (before !== null && JSON.stringify(before) === JSON.stringify(value)) plan.unchanged.push(name);
      else plan.changes.push({ name, before, requested: value as CanonicalValue, after: value as CanonicalValue, delta: null });
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new ParamError("wrong_type", `${name} takes a change in lr_step (a number added to the current value), got ${JSON.stringify(value)}`, name);
    }
    const before = current[name];
    if (typeof before !== "number") {
      plan.refused.push({ name, by: "slider", reason: `${name} is not available on this photo now (e.g. a monochrome profile drops the colour sliders)` });
      continue;
    }
    const base = baseMaxStep(name, pipeline) ?? spec.max - spec.min;
    const cap = base * factor;
    let applied = value;
    if (Math.abs(applied) > cap + EPSILON) {
      applied = sign(applied) * cap;
      plan.clamped.push({ name, requested: value, applied: roundForSlider(name, applied), reason: `pass ${pass} allows at most ±${fmt(cap)} (${fmt(base)} x decay ${fmt(factor)})` });
    }
    let after = roundForSlider(name, before + applied);
    if (after > spec.max || after < spec.min) {
      after = Math.min(spec.max, Math.max(spec.min, after));
      plan.clamped.push({ name, requested: value, applied: roundForSlider(name, after - before), reason: `the slider's range is ${spec.min}..${spec.max}` });
    }
    const delta = roundForSlider(name, after - before);
    if (Math.abs(delta) < EPSILON) {
      if (Math.abs(value) < EPSILON) plan.unchanged.push(name);
      else plan.refused.push({ name, by: "slider", reason: `no change is left after the limits (${name} is ${fmt(before)})` });
      continue;
    }
    plan.changes.push({ name, before, requested: value, after, delta });
  }
  return plan;
}

/**
 * The projected guardrail (ARCHITECTURE section 4): before writing, refuse a slider that would push
 * further into a clipping limit that is already reached, and, where lr_probe measured a slope, cap
 * a change the slope says would cross the limit. Changes the plan in place and returns it.
 */
export function applyProjectedGuardrail(plan: StepPlan, last: MetricsSummary | null, limits: Limits, slopes: ReadonlyMap<string, Slope> = new Map(), pipeline: Pipeline = "raw"): StepPlan {
  if (!last) return plan;
  const kept: Change[] = [];
  for (const change of plan.changes) {
    if (change.delta === null || typeof change.before !== "number") {
      kept.push(change);
      continue;
    }
    const direction = sign(change.delta);
    let refusedFor: string | null = null;
    if (RAISES_HIGHLIGHTS[change.name] === direction && last.clip_high_pct >= limits.clipHighPct) {
      refusedFor = `clip_high_pct is ${fmt(last.clip_high_pct)} %, at or over the limit of ${fmt(limits.clipHighPct)} %; ${change.name} ${signed(change.delta)} would push it higher`;
    } else if (CRUSHES_SHADOWS[change.name] === direction && last.clip_low_pct >= limits.clipLowPct) {
      refusedFor = `clip_low_pct is ${fmt(last.clip_low_pct)} %, at or over the limit of ${fmt(limits.clipLowPct)} %; ${change.name} ${signed(change.delta)} would push it higher`;
    }
    if (refusedFor) {
      plan.refused.push({ name: change.name, by: "guardrail", reason: refusedFor });
      continue;
    }
    const slope = slopes.get(change.name);
    if (slope) {
      let allowed = change.delta;
      const cap = (slopePerUnit: number, now: number, limit: number): void => {
        if (slopePerUnit * allowed <= 0) return; // this change lowers that clipping
        const room = (limit - now) / slopePerUnit; // signed change that reaches the limit
        if (Math.abs(room) < Math.abs(allowed)) allowed = room;
      };
      cap(slope.clip_high_pct, last.clip_high_pct, limits.clipHighPct);
      cap(slope.clip_low_pct, last.clip_low_pct, limits.clipLowPct);
      if (allowed !== change.delta) {
        // Whole minimum steps within the room; the epsilon keeps 0.3 / 0.05 from flooring to 5.
        const steps = Math.floor(Math.abs(allowed) / minStep(change.name, pipeline) + 1e-6);
        const delta = roundForSlider(change.name, sign(change.delta) * steps * minStep(change.name, pipeline));
        if (Math.abs(delta) < minStep(change.name, pipeline) - EPSILON || sign(delta) !== direction) {
          plan.refused.push({ name: change.name, by: "guardrail", reason: `the probe's slope projects a clipping breach for any ${change.name} change of at least ${fmt(minStep(change.name, pipeline))}` });
          continue;
        }
        plan.clamped.push({ name: change.name, requested: change.requested as number, applied: delta, reason: "the probe's slope projects a clipping breach beyond this change" });
        kept.push({ ...change, after: roundForSlider(change.name, change.before + delta), delta });
        continue;
      }
    }
    kept.push(change);
  }
  plan.changes = kept;
  return plan;
}

/**
 * The values that pull back, by `fraction` of their change, the sliders of a step that pushed in
 * the breaching direction ("high": towards clipped highlights; "low": towards crushed shadows).
 * Empty when no slider of the step pushed that way.
 */
export function pullBack(changes: readonly Change[], kind: "high" | "low", fraction: number): Record<string, number> {
  const table = kind === "high" ? RAISES_HIGHLIGHTS : CRUSHES_SHADOWS;
  const out: Record<string, number> = {};
  for (const c of changes) {
    if (c.delta === null || typeof c.before !== "number" || table[c.name] !== sign(c.delta)) continue;
    out[c.name] = roundForSlider(c.name, (c.after as number) - fraction * c.delta);
  }
  return out;
}

/**
 * A fixed correction step (HIGH_CORRECTIONS / LOW_CORRECTIONS) applied to the current values and
 * kept inside each slider's range; the sliders it would not move are left out.
 */
export function fixedCorrection(step: Readonly<Record<string, number>>, current: Readonly<CanonicalSettings>, map: ParamMap): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, change] of Object.entries(step)) {
    const spec = map.spec(name);
    const now = current[name];
    if (!spec || spec.kind !== "number" || typeof now !== "number") continue;
    const next = roundForSlider(name, Math.min(spec.max, Math.max(spec.min, now + change)));
    if (Math.abs(next - now) > EPSILON) out[name] = next;
  }
  return out;
}

/** The angle between two hues in degrees, 0-180 (the shorter way round the circle). */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Converged by metrics (PRD 6.5, AVG-009): mean luma moved less than 1/255 of the range, both
 * clipping figures less than 0.1 point, and no slider more than its minimum step.
 */
export function convergedByMetrics(delta: MetricsDelta | null, changes: readonly Change[], pipeline: Pipeline = "raw"): boolean {
  if (!delta) return false;
  if (Math.abs(delta.luma_mean) >= CONVERGENCE.lumaMean) return false;
  if (Math.abs(delta.clip_high_pct) >= CONVERGENCE.clipPct || Math.abs(delta.clip_low_pct) >= CONVERGENCE.clipPct) return false;
  return changes.every((c) => c.delta !== null && Math.abs(c.delta) <= minStep(c.name, pipeline) + EPSILON);
}
