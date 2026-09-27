// The checks after a write: the actual clipping guardrail (corrections, ARCHITECTURE section 4)
// and region preservation.

import type { GuardrailAction } from "../log/index.js";
import { summarize, type Metrics } from "../metrics/index.js";
import type { CanonicalSettings, FromSdkResult, ParamMap } from "../params/index.js";
import { historyName, render, write } from "./io.js";
import { fixedCorrection, hueDistance, pullBack, type Change, type Limits } from "./plan.js";
import { HIGH_CORRECTIONS, LOW_CORRECTIONS, MAX_CORRECTIONS, REGION_PRESERVE } from "./rules.js";
import type { Rendered, Session, SessionContext } from "./types.js";

type End = "high" | "low";
/** Per end of the histogram: pull-backs used, and the next row of its fixed correction table. */
type CorrectionState = Record<End, { pulls: number; table: number }>;

const clipOf = (m: Metrics, end: End): number => (end === "high" ? m.clip_high_pct : m.clip_low_pct);
const limitOf = (limits: Limits, end: End): number => (end === "high" ? limits.clipHighPct : limits.clipLowPct);

/**
 * The actual guardrail (ARCHITECTURE section 4): while clipping is over a limit, up to
 * MAX_CORRECTIONS renders. With a step's changes, first pull back half, then all, of the sliders
 * that pushed towards the breach; otherwise, or when none did, the fixed steps (PRD 6.5).
 */
export async function correct(
  ctx: SessionContext,
  s: Session,
  n: number,
  changes: readonly Change[] | null,
  view: FromSdkResult,
  rendered: Rendered,
  historyNames: string[],
): Promise<{ view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[] }> {
  const actions: GuardrailAction[] = [];
  const state: CorrectionState = { high: { pulls: 0, table: 0 }, low: { pulls: 0, table: 0 } };
  let current = view;
  let now = rendered;
  for (let round = 1; round <= MAX_CORRECTIONS; round++) {
    const m = now.metrics;
    const breached = (["high", "low"] as const).filter((end) => clipOf(m, end) > limitOf(s.limits, end));
    if (breached.length === 0) break;
    const fix = nextFix(breached, state, changes, current.settings, ctx.deps.map);
    if (Object.keys(fix).length === 0) break;
    const name = historyName(s, n, n === 0 ? `baseline ${round}` : `guard ${round}`);
    current = await write(ctx, s, fix, name);
    historyNames.push(name);
    now = await render(ctx, s, current.settings);
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

/** One correction for the breached ends, as one write: each end's pull-back, else its next fixed step. */
function nextFix(breached: readonly End[], state: CorrectionState, changes: readonly Change[] | null, settings: CanonicalSettings, map: ParamMap): Record<string, number> {
  const fix: Record<string, number> = {};
  for (const end of breached) {
    const st = state[end];
    let part: Record<string, number> = {};
    if (changes && st.pulls < 2) {
      part = pullBack(changes, end, st.pulls === 0 ? 0.5 : 1);
      if (Object.keys(part).length > 0) st.pulls++;
    }
    const table = end === "high" ? HIGH_CORRECTIONS : LOW_CORRECTIONS;
    while (Object.keys(part).length === 0 && st.table < table.length) {
      part = fixedCorrection(table[st.table] as Record<string, number>, settings, map);
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

/** The first preserved region that drifted past REGION_PRESERVE, described; null when none did. */
export function regionDrift(s: Session, metrics: Metrics): string | null {
  for (const r of s.regions) {
    if (!r.preserve || !r.baseline) continue;
    const m = metrics.regions.find((x) => x.label === r.label);
    if (!m) continue;
    // A region that had a hue and has none now (its pixels went below the chromatic threshold) has
    // lost its colour: a breach, not zero drift (Greptile, PR #23) [handle: tests\session-probe.test.ts
    // "undoes a pass that takes a preserved region's hue away"].
    if (r.baseline.hue_mean !== null && m.hue_mean === null) {
      return `region "${r.label}" lost its hue (no pixel is colourful enough to measure one; it had ${r.baseline.hue_mean} degrees)`;
    }
    const hue = r.baseline.hue_mean !== null && m.hue_mean !== null ? hueDistance(r.baseline.hue_mean, m.hue_mean) : 0;
    const sat = Math.abs(m.saturation_mean - r.baseline.saturation_mean);
    if (hue > REGION_PRESERVE.hueDegrees || sat > REGION_PRESERVE.saturationPoints) {
      return `region "${r.label}" drifted ${Math.round(hue * 10) / 10} degrees in hue and ${Math.round(sat * 10) / 10} points in saturation (limits ${REGION_PRESERVE.hueDegrees} and ${REGION_PRESERVE.saturationPoints})`;
    }
  }
  return null;
}
