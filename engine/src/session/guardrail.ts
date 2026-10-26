// The checks after a write: the actual clipping guardrail (corrections, ARCHITECTURE section 4),
// region preservation, the undo of a pass that breaches either, and the undo of a step Lightroom
// took only in part (issue #187).

import type { GuardrailAction } from "../log/index.js";
import { OTHERS_WRITTEN, ToolError, toToolError } from "../mcp/errors.js";
import { summarize, type Metrics } from "../metrics/index.js";
import { canonicalValuesEqual, companionsBack, type CanonicalSettings, type CanonicalValue, type FromSdkResult, type ParamMap, type ReadbackMismatch, type SdkSettings } from "../params/index.js";
import { historyName, read, render, write } from "./io.js";
import { fixedCorrection, hueDistance, pullBack, type Change, type Limits } from "./plan.js";
import { HIGH_CORRECTIONS, LOW_CORRECTIONS, MAX_BASELINE_CORRECTIONS, MAX_CORRECTIONS, REGION_PRESERVE } from "./rules.js";
import type { Rendered, Session, SessionContext, Target } from "./types.js";

type End = "high" | "low";
/** Per end of the histogram: pull-backs used, and the next row of its fixed correction table. */
type CorrectionState = Record<End, { pulls: number; table: number }>;
/** Why a pass is undone: the limit it breached, described. */
export type Breach = { limit: GuardrailAction["limit"]; reason: string };

// The high end is blown tone, two or more channels clipped (issue #186); one channel alone is an advisory.
const clipOf = (m: Metrics, end: End): number => (end === "high" ? m.clip_high_tone_pct : m.clip_low_pct);
const clipName = (end: End): string => (end === "high" ? "clip_high_tone_pct" : "clip_low_pct");
const limitOf = (limits: Limits, end: End): number => (end === "high" ? limits.clipHighPct : limits.clipLowPct);

/**
 * The actual guardrail (ARCHITECTURE section 4) on photo `t`: while clipping is over a limit, up to
 * MAX_CORRECTIONS renders in a step, MAX_BASELINE_CORRECTIONS in pass 0 (n = 0, "until under",
 * PRD 6.5). With a step's changes, first pull back half, then all, of the sliders that pushed
 * towards the breach; otherwise, or when none did, the fixed steps (PRD 6.5).
 * Only with the session's clip_baseline does pass 0 correct at all, and a step an end that was over
 * its limit in `before` (the render before the pass); otherwise a step corrects only the ends it
 * pushed over [stated: Jim, 2026-10-11, issue #130: "each pass should follow the prompt and intent",
 * step guard "Only what the pass caused"]. An end left alone is reported `unmet`, with its own reason.
 */
export async function correct(
  ctx: SessionContext,
  s: Session,
  t: Target,
  n: number,
  changes: readonly Change[] | null,
  before: Metrics,
  view: FromSdkResult,
  rendered: Rendered,
  historyNames: string[],
): Promise<{ view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[] }> {
  const actions: GuardrailAction[] = [];
  const state: CorrectionState = { high: { pulls: 0, table: 0 }, low: { pulls: 0, table: 0 } };
  const baseline = n === 0;
  const guarded = (["high", "low"] as const).filter((end) => s.clipBaseline || (!baseline && clipOf(before, end) <= limitOf(s.limits, end)));
  let current = view;
  let now = rendered;
  for (let round = 1; round <= (baseline ? MAX_BASELINE_CORRECTIONS : MAX_CORRECTIONS); round++) {
    const m = now.metrics;
    const breached = guarded.filter((end) => clipOf(m, end) > limitOf(s.limits, end));
    if (breached.length === 0) break;
    const fix = nextFix(breached, state, changes, current.settings, ctx.deps.map, baseline);
    if (Object.keys(fix).length === 0) break;
    const name = historyName(s, t, n, baseline ? `baseline ${round}` : `guard ${round}`);
    current = await write(ctx, s, t, fix, name);
    historyNames.push(name);
    now = await render(ctx, s, t, current);
    for (const end of breached) {
      actions.push({
        kind: "corrected",
        limit: end === "high" ? "clip_high" : "clip_low",
        reason: `${clipName(end)} was ${clipOf(m, end)} %, over the limit of ${limitOf(s.limits, end)} %`,
        history_name: name,
        changes: fix,
        metrics_after: summarize(now.metrics),
      });
    }
  }
  actions.push(...unmet(now.metrics, s.limits, guarded, before, baseline), ...advisory(now.metrics, s.limits));
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

/**
 * An "unmet" action for each end still over its limit after the corrections. An end the pass did not
 * guard (clip_baseline off) says it was left alone, and why: hud\payload.ts hudGuardrail ranks it
 * below a correction by its "left alone".
 */
function unmet(m: Metrics, limits: Limits, guarded: readonly End[], before: Metrics, baseline: boolean): GuardrailAction[] {
  const actions: GuardrailAction[] = [];
  for (const end of ["high", "low"] as const) {
    const value = clipOf(m, end);
    const limit = limitOf(limits, end);
    if (value > limit) {
      const why = baseline ? "pass 0 corrects no clipping" : `it was ${clipOf(before, end)} % before this pass`;
      actions.push({
        kind: "unmet",
        limit: end === "high" ? "clip_high" : "clip_low",
        reason: guarded.includes(end)
          ? `${clipName(end)} is still ${value} %, over the limit of ${limit} %, after the corrections this pass allows`
          : `${clipName(end)} is ${value} %, over the limit of ${limit} %; left alone (clip_baseline off): ${why}`,
        history_name: null,
        changes: {},
        metrics_after: summarize(m),
      });
    }
  }
  return actions;
}

/**
 * Clipping over the high limit in single channels only (blown tone within it): saturated colour,
 * not blown highlights, so no slider is moved; the row names the channel for Claude to judge
 * [stated: Jim, 2026-10-24, issue #186, "advisory only"].
 */
function advisory(m: Metrics, limits: Limits): GuardrailAction[] {
  if (m.clip_high_pct <= limits.clipHighPct || m.clip_high_tone_pct > limits.clipHighPct) return [];
  const [channel, pct] = (Object.entries(m.clip_high_pct_by_channel) as [string, number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
  const reason =
    `clip_high_pct is ${m.clip_high_pct} % (over the limit of ${limits.clipHighPct} %), mostly the ${channel} channel alone (${pct} %), ` +
    `while blown tone (clip_high_tone_pct) is ${m.clip_high_tone_pct} %: saturated colour, not blown highlights; nothing was moved`;
  return [{ kind: "advisory", limit: "clip_high", reason, history_name: null, changes: {}, metrics_after: summarize(m) }];
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
        reason: `${clipName(end)} is ${clipOf(after, end)} % after the corrections, over the limit of ${limit} %; it was ${clipOf(before, end)} % before the pass`,
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

/** What a revert writes: `values`, the canonical settings; `companions`, the SDK values with them; `notRestored`, keys it cannot put back. */
export type Back = { values: Record<string, CanonicalValue>; companions: SdkSettings; notRestored: string[] };

/**
 * The settings from before a pass that differ on the photo now (a name missing now differs), and what their
 * write changes besides (params companionsBack): the earlier profile pair, unpinned ones included, its
 * ConvertToGrayscale (a photo made black and white with Treatment names a colour profile, review PR B) and
 * the WhiteBalance mode a temperature or tint write set to "Custom" (Greptile, PR #200). Writing them back puts
 * the photo back, except `notRestored`.
 */
export function settingsBack(before: FromSdkResult, current: FromSdkResult): Back {
  const values: Record<string, CanonicalValue> = {};
  for (const [key, value] of Object.entries(before.settings)) if (!canonicalValuesEqual(current.settings[key], value)) values[key] = value;
  const { sdk, not_restored } = companionsBack(before, current, values);
  return { values, companions: sdk, notRestored: not_restored };
}

const isEmpty = (b: Back): boolean => Object.keys(b.values).length === 0 && Object.keys(b.companions).length === 0;

/**
 * A step Lightroom took only in part (issue #187 part 2): WRITE_NOT_TAKEN (a key read back otherwise) or
 * FEATURE_UNAVAILABLE (a key not read back at all) after the step's write. Both leave the step's other
 * values on the photo, so both are undone: the photo is read, every pre-step value that differs is written
 * back as "… pass n/N revert", and the error says so with `undone`. A key Lightroom did not report back
 * cannot be checked, so it is not written back, and the message names it. The pass is not used, as with the
 * depth revert (masks.ts). Returns the error to throw; any other error as it is.
 */
export async function undoRefused(ctx: SessionContext, s: Session, t: Target, n: number, beforeView: FromSdkResult, err: unknown): Promise<unknown> {
  const e = toToolError(err);
  if (e.code !== "WRITE_NOT_TAKEN" && e.code !== "FEATURE_UNAVAILABLE") return err;
  const name = historyName(s, t, n, "revert");
  const details = typeof e.details === "object" && e.details !== null ? e.details : {};
  const unreported = new Set(((details as { mismatches?: ReadbackMismatch[] }).mismatches ?? []).filter((m) => m.read_back === null).map((m) => m.sdk_key));
  const keys = [...unreported].join(", ");
  const what = e.message.replace(OTHERS_WRITTEN, "") + (unreported.size > 0 ? ` ${keys} could not be checked, so it was not written back.` : "");
  try {
    const all = settingsBack(beforeView, await read(ctx, s, t));
    const back: Back = {
      values: Object.fromEntries(Object.entries(all.values).filter(([k]) => !unreported.has(ctx.deps.map.sdkKey(k, t.pipeline, t.hdr) ?? ""))),
      companions: Object.fromEntries(Object.entries(all.companions).filter(([k]) => !unreported.has(k))),
      notRestored: all.notRestored,
    };
    const wrote = !isEmpty(back);
    if (wrote) await write(ctx, s, t, back.values, name, { putBack: true, companions: back.companions });
    const how = wrote ? `the values Lightroom did take were written back ("${name}")` : "no value Lightroom reports had stayed on the photo";
    // A key Lightroom does not report may still hold the step's value, and one it did not report before cannot be
    // put back: say so, not "as it was" (review, PR B; Greptile, PR #200).
    const lost = back.notRestored;
    const except = [
      ...(lost.length > 0 ? [`${lost.join(", ")}, which Lightroom did not report before the step, so it could not be put back`] : []),
      ...(unreported.size > 0 ? [`possibly ${keys}, which Lightroom does not report`] : []),
    ];
    const state = except.length > 0 ? `the photo is as it was before this step except ${except.join(", and ")}` : "the photo is as it was before this step";
    const unverified = unreported.size > 0 ? { unverified_keys: [...unreported] } : {};
    const notRestored = lost.length > 0 ? { not_restored: lost } : {};
    const undone = lost.length === 0 ? "The step was undone" : "The step was undone in part";
    return new ToolError(e.code, `${what} ${undone}: ${how}, so ${state}, and the pass is not used.`, e.recoverable, { ...details, undone: lost.length === 0, ...unverified, ...notRestored, revert_history_name: wrote ? name : null });
  } catch (undoErr) {
    const u = toToolError(undoErr);
    if (u.code === "SESSION_ENDED") return u;
    return new ToolError(e.code, `${what} Undoing the step ("${name}") failed too (${u.message}): some of its values may be on the photo. The pass is not used.`, e.recoverable, { ...details, undone: false, revert_history_name: name, revert_error: u.body() });
  }
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
  const back = settingsBack(beforeView, current);
  if (isEmpty(back)) return null;
  const name = historyName(s, t, n, breach.limit === "region" ? "region revert" : "clip revert");
  const view = await write(ctx, s, t, back.values, name, { putBack: true, companions: back.companions });
  historyNames.push(name);
  const rendered = await render(ctx, s, t, view);
  const changes = Object.fromEntries(Object.entries(back.values).filter((e): e is [string, number] => typeof e[1] === "number"));
  const lost = back.notRestored.length > 0 ? `; ${back.notRestored.join(", ")} could not be put back (Lightroom did not report it before the pass)` : "";
  return { view, rendered, action: { kind: "reverted", limit: breach.limit, reason: breach.reason + lost, history_name: name, changes, metrics_after: summarize(rendered.metrics) } };
}
