// The checks after a write: the actual clipping guardrail (corrections, ARCHITECTURE section 4),
// region preservation, and the undo of a pass that breaches either.

import type { GuardrailAction } from "../log/index.js";
import { summarize, type Metrics } from "../metrics/index.js";
import { canonicalValuesEqual, type CanonicalSettings, type CanonicalValue, type FromSdkResult, type ParamMap } from "../params/index.js";
import { historyName, render, write } from "./io.js";
import { fixedCorrection, hueDistance, pullBack, type Change, type Limits } from "./plan.js";
import { HIGH_CORRECTIONS, LOW_CORRECTIONS, MAX_BASELINE_CORRECTIONS, MAX_CORRECTIONS, REGION_PRESERVE } from "./rules.js";
import type { Rendered, Session, SessionContext, Target } from "./types.js";

type End = "high" | "low";
/** Per end of the histogram: pull-backs used, and the next row of its fixed correction table. */
type CorrectionState = Record<End, { pulls: number; table: number }>;
/** Why a pass is undone: the limit it breached, described. */
export type Breach = { limit: GuardrailAction["limit"]; reason: string };

const clipOf = (m: Metrics, end: End): number => (end === "high" ? m.clip_high_pct : m.clip_low_pct);
const limitOf = (limits: Limits, end: End): number => (end === "high" ? limits.clipHighPct : limits.clipLowPct);

/**
 * The actual guardrail (ARCHITECTURE section 4) on photo `t`: while clipping is over a limit, up to
 * MAX_CORRECTIONS renders in a step, MAX_BASELINE_CORRECTIONS in pass 0 (n = 0, "until under",
 * PRD 6.5). With a step's changes, first pull back half, then all, of the sliders that pushed
 * towards the breach; otherwise, or when none did, the fixed steps (PRD 6.5).
 */
export async function correct(
  ctx: SessionContext,
  s: Session,
  t: Target,
  n: number,
  changes: readonly Change[] | null,
  view: FromSdkResult,
  rendered: Rendered,
  historyNames: string[],
): Promise<{ view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[] }> {
  const actions: GuardrailAction[] = [];
  const state: CorrectionState = { high: { pulls: 0, table: 0 }, low: { pulls: 0, table: 0 } };
  const baseline = n === 0;
  let current = view;
  let now = rendered;
  for (let round = 1; round <= (baseline ? MAX_BASELINE_CORRECTIONS : MAX_CORRECTIONS); round++) {
    const m = now.metrics;
    const breached = (["high", "low"] as const).filter((end) => clipOf(m, end) > limitOf(s.limits, end));
    if (breached.length === 0) break;
    const fix = nextFix(breached, state, changes, current.settings, ctx.deps.map, baseline);
    if (Object.keys(fix).length === 0) break;
    const name = historyName(s, t, n, baseline ? `baseline ${round}` : `guard ${round}`);
    current = await write(ctx, s, t, fix, name);
    historyNames.push(name);
    now = await render(ctx, s, t, current.settings);
    for (const end of breached) {
      actions.push({
        kind: "corrected",
        limit: end === "high" ? "clip_high" : "clip_low",
        reason: `clip_${end}_pct was ${clipOf(m, end)} %, over the limit of ${limitOf(s.limits, end)} %`,
        history_name: name,
        changes: fix,
        metrics_after: summarize(now.metrics),
      });
    }
  }
  actions.push(...unmet(now.metrics, s.limits));
  return { view: current, rendered: now, actions };
}

/**
 * One correction for the breached ends, as one write: each end's pull-back, else its next fixed
 * step. With `repeat` (pass 0) the fixed table starts again from the top; a row whose sliders are
 * all at their range's end is skipped, one round of the table at most per call.
 */
function nextFix(
  breached: readonly End[],
  state: CorrectionState,
  changes: readonly Change[] | null,
  settings: CanonicalSettings,
  map: ParamMap,
  repeat: boolean,
): Record<string, number> {
  const fix: Record<string, number> = {};
  for (const end of breached) {
    const st = state[end];
    let part: Record<string, number> = {};
    if (changes && st.pulls < 2) {
      part = pullBack(changes, end, st.pulls === 0 ? 0.5 : 1);
      if (Object.keys(part).length > 0) st.pulls++;
    }
    const table = end === "high" ? HIGH_CORRECTIONS : LOW_CORRECTIONS;
    const stop = repeat ? st.table + table.length : table.length;
    while (Object.keys(part).length === 0 && st.table < stop) {
      part = fixedCorrection(table[st.table % table.length] as Record<string, number>, settings, map);
      st.table++;
    }
    for (const [k, v] of Object.entries(part)) if (!(k in fix)) fix[k] = v;
  }
  return fix;
}

/** An "unmet" action for each end still over its limit after the corrections. */
function unmet(m: Metrics, limits: Limits): GuardrailAction[] {
  const actions: GuardrailAction[] = [];
  for (const end of ["high", "low"] as const) {
    const value = clipOf(m, end);
    const limit = limitOf(limits, end);
    if (value > limit) {
      actions.push({
        kind: "unmet",
        limit: end === "high" ? "clip_high" : "clip_low",
        reason: `clip_${end}_pct is still ${value} %, over the limit of ${limit} %, after the corrections this pass allows`,
        history_name: null,
        changes: {},
        metrics_after: summarize(m),
      });
    }
  }
  return actions;
}

/**
 * The first end still over its limit after a step's corrections that was within it before the
 * step; null when none. Such a step is undone [stated: Jim, 2026-09-27, PHASE4_PLAN decision 1].
 * An end already over its limit before the step (pass 0 left it there) does not undo the step.
 */
export function clipBreach(s: Session, before: Metrics, after: Metrics): Breach | null {
  for (const end of ["high", "low"] as const) {
    const limit = limitOf(s.limits, end);
    if (clipOf(after, end) > limit && clipOf(before, end) <= limit) {
      return {
        limit: end === "high" ? "clip_high" : "clip_low",
        reason: `clip_${end}_pct is ${clipOf(after, end)} % after the corrections, over the limit of ${limit} %; it was ${clipOf(before, end)} % before the pass`,
      };
    }
  }
  return null;
}

/** The first preserved region of photo `t` that drifted past REGION_PRESERVE, described; null when none did. */
export function regionDrift(s: Session, t: Target, metrics: Metrics): string | null {
  for (const r of s.regions) {
    const baseline = r.baselines[t.id];
    if (!r.preserve || !baseline) continue;
    const m = metrics.regions.find((x) => x.label === r.label);
    if (!m) continue;
    // A region that had a hue and has none now (its pixels went below the chromatic threshold) has
    // lost its colour: a breach, not zero drift (Greptile, PR #23) [handle: tests\session-probe.test.ts
    // "undoes a pass that takes a preserved region's hue away"].
    if (baseline.hue_mean !== null && m.hue_mean === null) {
      return `region "${r.label}" lost its hue (no pixel is colourful enough to measure one; it had ${baseline.hue_mean} degrees)`;
    }
    const hue = baseline.hue_mean !== null && m.hue_mean !== null ? hueDistance(baseline.hue_mean, m.hue_mean) : 0;
    const sat = Math.abs(m.saturation_mean - baseline.saturation_mean);
    if (hue > REGION_PRESERVE.hueDegrees || sat > REGION_PRESERVE.saturationPoints) {
      return `region "${r.label}" drifted ${Math.round(hue * 10) / 10} degrees in hue and ${Math.round(sat * 10) / 10} points in saturation (limits ${REGION_PRESERVE.hueDegrees} and ${REGION_PRESERVE.saturationPoints})`;
    }
  }
  return null;
}

/**
 * Undo pass n of photo `t`: write back the settings from before it as one History step ("… clip
 * revert" or "… region revert"), render again, and describe it as a "reverted" action. Null when no
 * setting differs.
 */
export async function undo(
  ctx: SessionContext,
  s: Session,
  t: Target,
  n: number,
  beforeView: FromSdkResult,
  current: FromSdkResult,
  breach: Breach,
  historyNames: string[],
): Promise<{ view: FromSdkResult; rendered: Rendered; action: GuardrailAction } | null> {
  const back: Record<string, CanonicalValue> = {};
  for (const [key, value] of Object.entries(beforeView.settings)) if (!canonicalValuesEqual(current.settings[key], value)) back[key] = value;
  if (Object.keys(back).length === 0) return null;
  const name = historyName(s, t, n, breach.limit === "region" ? "region revert" : "clip revert");
  const view = await write(ctx, s, t, back, name);
  historyNames.push(name);
  const rendered = await render(ctx, s, t, view.settings);
  const changes = Object.fromEntries(Object.entries(back).filter((e): e is [string, number] => typeof e[1] === "number"));
  return { view, rendered, action: { kind: "reverted", limit: breach.limit, reason: breach.reason, history_name: name, changes, metrics_after: summarize(rendered.metrics) } };
}
