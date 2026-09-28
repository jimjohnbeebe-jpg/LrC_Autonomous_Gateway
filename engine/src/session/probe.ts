// lr_probe: per-slider metric slopes, with the photo put back afterwards. In Variants mode it names
// its copy, like lr_step (targets.ts), and the slopes are that copy's.

import { ToolError, toToolError } from "../mcp/errors.js";
import { deltaMetrics, type MetricsDelta } from "../metrics/index.js";
import type { CanonicalValue, FromSdkResult, ParamMap } from "../params/index.js";
import { failed, fresh, ms, read, render, saveLog, write } from "./io.js";
import type { Slope } from "./plan.js";
import { baseMaxStep, roundForSlider } from "./rules.js";
import { focus, resolveTarget } from "./targets.js";
import type { ProbeArgs, Rendered, Session, SessionContext, SessionOutput, Target } from "./types.js";

type ProbePlan = Array<{ name: string; before: number; delta: number }>;
type ProbeResult = { name: string; delta_applied: number; delta_metrics: MetricsDelta; per_unit: Slope };

export async function probe(ctx: SessionContext, s: Session, args: ProbeArgs): Promise<SessionOutput> {
  const started = performance.now();
  if (s.intent.intent.allow_probe !== true) {
    throw new ToolError("PROBE_NOT_ALLOWED", `The intent "${s.intent.intent.id}" does not allow lr_probe (allow_probe is not true); probing is off in autonomous mode otherwise.`, false);
  }
  const magnitude = args.magnitude ?? 0.5;
  const t = resolveTarget(s, args.target, "write");
  await focus(ctx, s, t);
  const view = await read(ctx, s, t);
  let base: Rendered;
  try {
    base = (await fresh(ctx, s, t, view)).last; // the photo as it is now, not a stale render
  } catch (err) {
    throw failed(ctx, s, "probe (render before the probe)", err);
  }
  const plan = planProbe(args.sliders, view, magnitude, ctx.deps.map);

  const probeStarted = ctx.now().toISOString();
  const historyNames: string[] = [];
  const results: ProbeResult[] = [];
  /** Sliders that may hold a probe value now, with the value to put back. */
  const outstanding = new Map<string, number>();
  try {
    await runProbe(ctx, s, t, plan, base, { historyNames, results, outstanding });
  } catch (err) {
    await putBack(ctx, s, t, outstanding, historyNames);
    throw failed(ctx, s, "probe", err);
  }
  s.log.probes.push({ target: t.id, started: probeStarted, duration_ms: ms(started), magnitude, history_names: historyNames, results });
  saveLog(s);
  return {
    json: {
      ok: true,
      session_id: s.id,
      target: t.id,
      magnitude,
      results,
      history_names: historyNames,
      note: "The probed sliders are back to their values before the probe. per_unit is the metric change per unit of the slider; lr_step uses it to cap changes that would cross a clipping limit.",
      timings: { total_ms: ms(started) },
    },
    log: { session_id: s.id, ...(t.id !== "master" ? { target: t.id } : {}), sliders: args.sliders, history_names: historyNames },
  };
}

/** Each slider's probe: magnitude x its base maximum step, the other way when that leaves its range. */
function planProbe(sliders: readonly string[], view: FromSdkResult, magnitude: number, map: ParamMap): ProbePlan {
  const plan: ProbePlan = [];
  for (const name of sliders) {
    const spec = map.spec(name);
    const step = baseMaxStep(name);
    const before = view.settings[name];
    if (!spec || spec.kind !== "number" || step === null || typeof before !== "number") {
      throw new ToolError("INVALID_ARGUMENTS", `lr_probe takes numeric sliders available on this photo; "${name}" is not one.`, false);
    }
    let delta = roundForSlider(name, magnitude * step);
    if (before + delta > spec.max) delta = -delta;
    if (before + delta < spec.min) throw new ToolError("INVALID_ARGUMENTS", `${name} has no room to probe by ${magnitude * step} either way.`, false);
    plan.push({ name, before, delta });
  }
  return plan;
}

/**
 * Probe the sliders one after the other (each write also puts the previous slider back), record
 * each slope, then put the last slider back and check that every probed slider is back.
 */
async function runProbe(
  ctx: SessionContext,
  s: Session,
  t: Target,
  plan: ProbePlan,
  base: Rendered,
  out: { historyNames: string[]; results: ProbeResult[]; outstanding: Map<string, number> },
): Promise<void> {
  const { historyNames, results, outstanding } = out;
  let previous: { name: string; before: number } | null = null;
  for (const p of plan) {
    const values: Record<string, CanonicalValue> = { [p.name]: roundForSlider(p.name, p.before + p.delta) };
    if (previous) values[previous.name] = previous.before;
    const name = `${probePrefix(s, t)} ${p.name}`;
    outstanding.set(p.name, p.before); // before the write: a failed write may still have changed it
    const probedView = await write(ctx, s, t, values, name);
    if (previous) outstanding.delete(previous.name); // this write put the previous slider back
    historyNames.push(name);
    const probed = await render(ctx, s, t, probedView.settings, { keep: false });
    const d = deltaMetrics(base.metrics, probed.metrics);
    const perUnit: Slope = {
      luma_mean: Math.round((d.luma_mean / p.delta) * 10000) / 10000,
      clip_high_pct: Math.round((d.clip_high_pct / p.delta) * 10000) / 10000,
      clip_low_pct: Math.round((d.clip_low_pct / p.delta) * 10000) / 10000,
    };
    t.slopes.set(p.name, perUnit);
    results.push({ name: p.name, delta_applied: p.delta, delta_metrics: d, per_unit: perUnit });
    previous = p;
  }
  if (!previous) return;
  const revertName = `${probePrefix(s, t)} revert`;
  const back = await write(ctx, s, t, { [previous.name]: previous.before }, revertName);
  historyNames.push(revertName);
  for (const p of plan) if (back.settings[p.name] === p.before) outstanding.delete(p.name);
  // Every probed slider is checked, not only those still marked for recovery: one put back
  // earlier may have been changed in Lightroom since (Greptile, PR #23) [handle:
  // tests\session-probe.test.ts "reports a probed slider changed in Lightroom after it was put back"].
  const differing = plan.filter((p) => back.settings[p.name] !== p.before).map((p) => ({ name: p.name, before: p.before, now: back.settings[p.name] ?? null }));
  if (differing.length > 0) {
    throw new ToolError(
      "PROBE_NOT_PUT_BACK",
      `After the probe, ${differing.map((d) => `${d.name} is ${String(d.now)}, not ${d.before}`).join("; ")}: changed in Lightroom during the probe, or not taken.`,
      false,
      { differing },
    );
  }
}

/**
 * After a failed probe, put back the sliders that may still hold a probe value, so a failed probe
 * leaves no temporary edit behind, and only those, so an edit made meanwhile to a slider the probe
 * never reached is kept (Greptile, PR #23) [handle: tests\session-probe.test.ts "puts the probed
 * sliders back when a probe fails half-way", "after a failed probe puts back only the sliders it
 * changed"]. If the write fails too, the next step renders the photo again before it plans
 * (fresh()), because the settings then differ from the last render's.
 */
async function putBack(ctx: SessionContext, s: Session, t: Target, outstanding: Map<string, number>, historyNames: string[]): Promise<void> {
  if (outstanding.size === 0) return;
  const back: Record<string, CanonicalValue> = Object.fromEntries(outstanding);
  const revertName = `${probePrefix(s, t)} revert`;
  try {
    await write(ctx, s, t, back, revertName);
    historyNames.push(revertName);
  } catch (restoreErr) {
    s.log.failures.push({ at: ctx.now().toISOString(), stage: "probe (put back)", error: toToolError(restoreErr).body() });
  }
}

/** "AVG <id> probe" (a copy's: "AVG <id> A probe"), as History names start. */
function probePrefix(s: Session, t: Target): string {
  return `AVG ${s.short}${t.id === "master" ? "" : ` ${t.id}`} probe`;
}
