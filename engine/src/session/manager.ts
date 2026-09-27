// The session loop (AVG-003: Claude orchestrates, the engine is a stateful step function;
// ARCHITECTURE section 4, PRD sections 6.5, 6.7, 6.12, 6.13, MCP_TOOLS "Session tools").
//
//   lr_begin_session -> snapshot, pass 0 (camera profile, lens, intent priors, then the clipping
//                       baseline), preview + metrics + the intent's brief
//   lr_step          -> a change per slider, capped by decay and range, checked against the
//                       projected guardrail, written as one History step, rendered and measured;
//                       then the actual guardrail (corrections), region preservation, convergence
//   lr_probe         -> per-slider metric slopes, the photo put back afterwards
//   lr_set_regions   -> region boxes measured on every render; `preserve` guards hue and saturation
//   lr_end_session   -> accept (log + recipe) or revert (the pre-session snapshot)
//
// Converge mode on the master only; Variants mode is Phase 4. One session at a time per engine.
// Every command names the session's photo (C-2), so a change of selection in Lightroom can never
// redirect a write: the plugin refuses it and the session stays open (TARGET_CHANGED).
// The log is rewritten after every pass (log\session-log.ts).

import { randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BridgeClient } from "../bridge/index.js";
import type { IntentLibrary, LoadedIntent } from "../intents/index.js";
import {
  RECIPE_SCHEMA_ID,
  SESSION_LOG_SCHEMA_ID,
  SessionLogFiles,
  type GuardrailAction,
  type PassEntry,
  type SessionLogData,
} from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { boxProblem, deltaMetrics, measureImage, summarize, type Metrics, type Region, type RegionBox } from "../metrics/index.js";
import type { CanonicalSettings, CanonicalValue, FromSdkResult, ParamMap } from "../params/index.js";
import { composite, type RenderedPreview } from "../preview/index.js";
import {
  applyProjectedGuardrail,
  convergedByMetrics,
  fixedCorrection,
  hueDistance,
  planStep,
  pullBack,
  type Change,
  type Limits,
  type Slope,
} from "./plan.js";
import {
  HIGH_CORRECTIONS,
  LOW_CORRECTIONS,
  MAX_CORRECTIONS,
  REGION_PRESERVE,
  SESSION_DEFAULTS,
  baseMaxStep,
  roundForSlider,
} from "./rules.js";

export type SessionOutput = { json: Record<string, unknown>; image?: Buffer; log?: Record<string, unknown> };
export type RenderRequest = { longEdge: number; quality: number; targetUuid: string; regions: readonly Region[] };
export type ReturnImage = "after" | "before_after" | "none";
export type RegionKind = "skin" | "fur" | "sky" | "custom";

export type BeginArgs = {
  intent_id: string;
  mode?: "converge" | undefined;
  max_passes?: number | undefined;
  guardrails?: { clip_high_pct?: number | undefined; clip_low_pct?: number | undefined } | undefined;
  notes?: string | undefined;
  long_edge?: number | undefined;
  return_image?: ReturnImage | undefined;
};
export type StepArgs = {
  session_id: string;
  target?: "master" | undefined;
  settings: Record<string, unknown>;
  rationale: string;
  return_image?: ReturnImage | undefined;
};
export type ProbeArgs = { session_id: string; sliders: string[]; magnitude?: number | undefined };
export type RegionArgs = {
  session_id: string;
  regions: Array<{ kind: RegionKind; label: string; box: RegionBox; preserve?: boolean | undefined }>;
};
export type EndArgs = { session_id: string; outcome: "accept" | "revert" };

export type SessionDeps = {
  client: BridgeClient;
  map: ParamMap;
  intents: IntentLibrary;
  render: (request: RenderRequest) => Promise<RenderedPreview>;
  logDir: string;
  engineVersion: string;
  now?: () => Date;
  newId?: () => string;
};

/** A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md "Numbers"]; 30 s leaves room. */
const WRITE_TIMEOUT_MS = 30000;
/** At most this many regions per session [inference: each one is measured on every render]. */
export const MAX_REGIONS = 8;

type RegionState = { kind: RegionKind; label: string; box: RegionBox; preserve: boolean; baseline: { hue_mean: number | null; saturation_mean: number } | null };
/** A render of the session's photo, with the settings it shows (to tell when the photo changed outside the session). */
type Rendered = {
  metrics: Metrics;
  jpeg: Buffer;
  hash: string;
  width: number;
  height: number;
  timings: RenderedPreview["timings"];
  settings: CanonicalSettings;
  /** The long edge the render was asked for (a session preview may use another than the session's). */
  longEdge: number;
  preview: RenderedPreview;
};

type Session = {
  id: string;
  short: string;
  startedAt: Date;
  intent: LoadedIntent;
  maxPasses: number;
  limits: Limits;
  decay: readonly number[];
  longEdge: number;
  quality: number;
  target: { uuid: string; local_id: number; filename: string | null; copy_name: string | null; process_version: string; camera_profile: string | null };
  snapshot: { name: string; id: string };
  startSettings: CanonicalSettings;
  passes: number;
  endReason: "converged" | "cap_reached" | null;
  last: Rendered | null;
  regions: RegionState[];
  slopes: Map<string, Slope>;
  files: SessionLogFiles;
  log: SessionLogData;
};

const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export class SessionManager {
  private readonly deps: SessionDeps;
  private readonly now: () => Date;
  private readonly newId: () => string;
  private session: Session | null = null;
  /** Log files of sessions that ended in this engine run, by id. */
  private readonly ended = new Map<string, string>();
  /** The end of the queue of session operations (exclusive()). */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => new Date());
    this.newId = deps.newId ?? (() => randomUUID());
  }

  /** The open session, if any: what the other tools need to know about it. */
  current(): { id: string; uuid: string; filename: string | null; pass: string; last: { metrics: Metrics; hash: string; width: number; height: number } | null } | null {
    const s = this.session;
    if (!s) return null;
    return {
      id: s.id,
      uuid: s.target.uuid,
      filename: s.target.filename,
      pass: `${s.passes}/${s.maxPasses}`,
      last: s.last ? { metrics: s.last.metrics, hash: s.last.hash, width: s.last.width, height: s.last.height } : null,
    };
  }

  /** The regions of the open session with this id, for a preview render. */
  regionsOf(sessionId: string): Region[] {
    return this.require(sessionId).regions.map((r) => ({ label: r.label, box: r.box }));
  }

  /**
   * lr_get_preview with a session: render the session's photo at `longEdge` and make it the session's
   * last render, so lr_get_metrics and the next step's deltas describe the image just returned
   * (Greptile, PR #23) [handle: tests\mcp-tools.test.ts "says a session is open on the selected photo,
   * and answers lr_get_metrics from the session's last render": the 800 px preview's hash and width].
   */
  preview(sessionId: string, longEdge: number): Promise<RenderedPreview> {
    return this.exclusive(async () => {
      const s = this.require(sessionId);
      const view = await this.read(s);
      return (await this.render(s, view.settings, { longEdge })).preview;
    });
  }

  // ---------------------------------------------------------------------------------------------
  // lr_begin_session

  begin(args: BeginArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.beginNow(args));
  }

  private async beginNow(args: BeginArgs): Promise<SessionOutput> {
    const started = performance.now();
    if (this.session) {
      throw new ToolError(
        "SESSION_ALREADY_ACTIVE",
        `A session is already open on "${this.session.target.filename ?? this.session.target.uuid}" (${this.session.id}). End it with lr_end_session (accept or revert) first.`,
        false,
        { session_id: this.session.id },
      );
    }
    if (args.mode !== undefined && args.mode !== "converge") {
      throw new ToolError("INVALID_ARGUMENTS", "Only mode \"converge\" is available; Variants mode comes in Phase 4.", false);
    }
    const loaded = this.deps.intents.get(args.intent_id); // IntentError -> INTENT_NOT_FOUND
    const { client, map } = this.deps;

    const ctx = await client.request("get_context", {});
    if (ctx["file_format"] === "VIDEO") throw new ToolError("VIDEO_NOT_SUPPORTED", "The selected item is a video; select a photo.", false);
    const view = map.fromSdk((await client.request("get_settings", { target_uuid: ctx.uuid })).settings); // LEGACY_PROCESS_VERSION

    const now = this.now();
    // The log's name is <yyyymmdd>-<6 hex> (PRD 6.12): a new id when that name is taken, so a session
    // never writes over another's log or recipe (Greptile, PR #23) [handle: tests\session.test.ts
    // "picks a new session id when the log name for the day is taken"].
    let id = "";
    let short = "";
    let files: SessionLogFiles | null = null;
    for (let attempt = 0; attempt < 5 && !files; attempt++) {
      id = this.newId();
      short = id.replace(/-/g, "").slice(0, 6);
      const candidate = new SessionLogFiles(this.deps.logDir, now, short);
      if (!existsSync(candidate.logPath) && !existsSync(candidate.recipePath)) files = candidate;
    }
    if (!files) throw new ToolError("INTERNAL_ERROR", `No free session log name in ${this.deps.logDir} after 5 tries.`, false);
    const snapshotName = `AVG pre-session ${now.toISOString()}`;
    const snap = await client.request("create_snapshot", { target_uuid: ctx.uuid, name: snapshotName });
    const overrides = loaded.intent.guardrail_overrides ?? {};
    const s: Session = {
      id,
      short,
      startedAt: now,
      intent: loaded,
      maxPasses: args.max_passes ?? SESSION_DEFAULTS.maxPasses,
      limits: {
        clipHighPct: args.guardrails?.clip_high_pct ?? overrides.clip_high_pct ?? SESSION_DEFAULTS.clipHighPct,
        clipLowPct: args.guardrails?.clip_low_pct ?? overrides.clip_low_pct ?? SESSION_DEFAULTS.clipLowPct,
      },
      decay: SESSION_DEFAULTS.decay,
      longEdge: args.long_edge ?? SESSION_DEFAULTS.longEdge,
      quality: SESSION_DEFAULTS.quality,
      target: {
        uuid: ctx.uuid,
        local_id: ctx.local_id,
        filename: text(ctx["filename"]),
        copy_name: text(ctx["copy_name"]),
        process_version: view.process_version,
        camera_profile: view.camera_profile.name,
      },
      snapshot: { name: snapshotName, id: snap.snapshot_id },
      startSettings: view.settings,
      passes: 0,
      endReason: null,
      last: null,
      regions: [],
      slopes: new Map(),
      files,
      log: {} as SessionLogData,
    };
    s.log = {
      schema: SESSION_LOG_SCHEMA_ID,
      session_id: id,
      short_id: short,
      engine_version: this.deps.engineVersion,
      started: now.toISOString(),
      ended: null,
      outcome: null,
      intent: { id: loaded.intent.id, label: loaded.intent.label, source: loaded.source },
      mode: "converge",
      max_passes: s.maxPasses,
      guardrails: { clip_high_pct: s.limits.clipHighPct, clip_low_pct: s.limits.clipLowPct },
      decay: [...s.decay],
      notes: args.notes ?? null,
      target: s.target,
      snapshot: s.snapshot,
      regions: [],
      passes: [],
      probes: [],
      failures: [],
      final_settings: null,
      recipe_path: null,
      revert: null,
    };
    this.session = s;
    this.saveLog(s);

    // From here on the session is open: a failure leaves it open, so Claude can end it with revert.
    try {
      const passStarted = this.now().toISOString();
      const original = await this.render(s, view.settings);
      const changes = this.pass0Changes(loaded, view.settings);
      const historyNames: string[] = [];
      let current = view;
      let rendered = original;
      if (Object.keys(changes).length > 0) {
        const name = this.historyName(s, 0);
        current = await this.write(s, changes, name);
        historyNames.push(name);
        rendered = await this.render(s, current.settings);
      }
      const corrected = await this.correct(s, 0, null, current, rendered, historyNames);
      current = corrected.view;
      rendered = corrected.rendered;
      const applied = Object.entries(changes).map(([name, after]): Change => {
        const before = view.settings[name] ?? null;
        return { name, before, requested: after, after, delta: typeof before === "number" && typeof after === "number" ? roundForSlider(name, after - before) : null };
      });
      const delta = deltaMetrics(original.metrics, rendered.metrics);
      this.recordPass(s, {
        n: 0,
        kind: "pass0",
        target: "master",
        started: passStarted,
        duration_ms: ms(started),
        history_names: historyNames,
        rationale: "engine: camera profile, lens corrections and intent priors, then the clipping baseline (PRD 6.5)",
        requested: { ...(loaded.intent.default_camera_profile ? { camera_profile: loaded.intent.default_camera_profile } : {}), ...loaded.intent.priors },
        changes: applied,
        clamped: [],
        refused: [],
        unchanged: [],
        settings_before: view.settings,
        settings_after: current.settings,
        metrics_before: summarize(original.metrics),
        metrics_after: summarize(rendered.metrics),
        delta_metrics: delta,
        preview_hash: rendered.hash,
        preview_source: "export",
        guardrail_actions: corrected.actions,
        converged_by_metrics: false,
      });
      const json: Record<string, unknown> = {
        ok: true,
        session_id: id,
        pass: `0/${s.maxPasses}`,
        target: { ...s.target, exif: { iso: ctx["iso"] ?? null, shutter: ctx["shutter"] ?? null, aperture: ctx["aperture"] ?? null, focal_length: ctx["focal_length"] ?? null, lens: ctx["lens"] ?? null, camera: ctx["camera"] ?? null } },
        intent: { id: loaded.intent.id, label: loaded.intent.label, source: loaded.source },
        intent_brief: {
          brief: loaded.intent.brief,
          convergence_hints: loaded.intent.convergence_hints ?? [],
          regions_expected: loaded.intent.regions_expected ?? [],
          allow_probe: loaded.intent.allow_probe ?? false,
        },
        guardrails: s.log.guardrails,
        max_passes: s.maxPasses,
        snapshot: s.snapshot,
        history_names: historyNames,
        pass0_applied: applied,
        guardrail_actions: corrected.actions,
        settings: current.settings,
        metrics: summarize(rendered.metrics),
        delta_metrics: delta,
        ...this.describe(rendered),
        timings: { total_ms: ms(started) },
      };
      const image = await this.image(s, args.return_image ?? "after", original, rendered, "before", "pass 0");
      return { json, ...(image ? { image } : {}), log: { session_id: id, intent_id: loaded.intent.id, history_names: historyNames, metrics: this.brief(rendered.metrics), guardrail_actions: corrected.actions.length } };
    } catch (err) {
      throw this.failed(s, "begin", err);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // lr_step

  step(args: StepArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.stepNow(args));
  }

  private async stepNow(args: StepArgs): Promise<SessionOutput> {
    const started = performance.now();
    const s = this.require(args.session_id);
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
    const n = s.passes + 1;
    const passStarted = this.now().toISOString();
    const beforeView = await this.read(s);
    const plan = planStep(args.settings, beforeView.settings, n, this.deps.map, s.decay); // ParamError: nothing written
    let baseline: { last: Rendered; refreshed: boolean };
    try {
      baseline = await this.fresh(s, beforeView);
    } catch (err) {
      throw this.failed(s, `step ${n} (render before the step)`, err);
    }
    applyProjectedGuardrail(plan, summarize(baseline.last.metrics), s.limits, s.slopes);
    if (plan.changes.length === 0) {
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

    try {
      const beforeRender = baseline.last;
      const historyNames: string[] = [];
      const name = this.historyName(s, n);
      const values: Record<string, CanonicalValue> = Object.fromEntries(plan.changes.map((c) => [c.name, c.after]));
      let current = await this.write(s, values, name);
      historyNames.push(name);
      let rendered = await this.render(s, current.settings);
      const corrected = await this.correct(s, n, plan.changes, current, rendered, historyNames);
      current = corrected.view;
      rendered = corrected.rendered;
      const actions = [...corrected.actions];

      // Region preservation: a preserved region whose hue or saturation drifted too far undoes the pass.
      const drift = this.regionDrift(s, rendered.metrics);
      if (drift) {
        const back: Record<string, CanonicalValue> = {};
        for (const [key, value] of Object.entries(beforeView.settings)) if (!same(current.settings[key], value)) back[key] = value;
        if (Object.keys(back).length > 0) {
          const revertName = this.historyName(s, n, "region revert");
          current = await this.write(s, back, revertName);
          historyNames.push(revertName);
          rendered = await this.render(s, current.settings);
          actions.push({ kind: "reverted", limit: "region", reason: drift, history_name: revertName, changes: numericOnly(back), metrics_after: summarize(rendered.metrics) });
        }
      }

      const delta = deltaMetrics(beforeRender.metrics, rendered.metrics);
      const converged = convergedByMetrics(delta, plan.changes);
      s.passes = n;
      if (converged) s.endReason = "converged";
      else if (n >= s.maxPasses) s.endReason = "cap_reached";
      this.recordPass(s, {
        n,
        kind: "step",
        target: "master",
        started: passStarted,
        duration_ms: ms(started),
        history_names: historyNames,
        rationale: args.rationale,
        requested: args.settings,
        changes: plan.changes,
        clamped: plan.clamped,
        refused: plan.refused,
        unchanged: plan.unchanged,
        settings_before: beforeView.settings,
        settings_after: current.settings,
        metrics_before: summarize(beforeRender.metrics),
        metrics_after: summarize(rendered.metrics),
        delta_metrics: delta,
        preview_hash: rendered.hash,
        preview_source: "export",
        guardrail_actions: actions,
        converged_by_metrics: converged,
      });
      const json: Record<string, unknown> = {
        ok: true,
        session_id: s.id,
        pass: `${n}/${s.maxPasses}`,
        history_names: historyNames,
        applied: plan.changes,
        clamped: plan.clamped,
        refused: plan.refused,
        unchanged: plan.unchanged,
        guardrail_actions: actions,
        settings: current.settings,
        metrics: summarize(rendered.metrics),
        delta_metrics: delta,
        converged_by_metrics: converged,
        cap_reached: s.endReason === "cap_reached",
        passes_left: s.endReason ? 0 : s.maxPasses - n,
        ...(baseline.refreshed ? { metrics_refreshed: "the photo's settings had changed since the last render, so it was rendered again before this step" } : {}),
        ...this.describe(rendered),
        timings: { total_ms: ms(started) },
      };
      const image = await this.image(s, args.return_image ?? "after", beforeRender, rendered, `pass ${n - 1}`, `pass ${n}`);
      return {
        json,
        ...(image ? { image } : {}),
        log: {
          session_id: s.id,
          pass: json["pass"],
          history_names: historyNames,
          changes: plan.changes.length,
          refused: plan.refused.length,
          guardrail_actions: actions.length,
          metrics: this.brief(rendered.metrics),
          converged,
          ...(baseline.refreshed ? { metrics_refreshed: true } : {}),
        },
      };
    } catch (err) {
      throw this.failed(s, `step ${n}`, err);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // lr_probe

  probe(args: ProbeArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.probeNow(args));
  }

  private async probeNow(args: ProbeArgs): Promise<SessionOutput> {
    const started = performance.now();
    const s = this.require(args.session_id);
    if (s.intent.intent.allow_probe !== true) {
      throw new ToolError("PROBE_NOT_ALLOWED", `The intent "${s.intent.intent.id}" does not allow lr_probe (allow_probe is not true); probing is off in autonomous mode otherwise.`, false);
    }
    const magnitude = args.magnitude ?? 0.5;
    const view = await this.read(s);
    let base: Rendered;
    try {
      base = (await this.fresh(s, view)).last; // the photo as it is now, not a stale render
    } catch (err) {
      throw this.failed(s, "probe (render before the probe)", err);
    }
    const { map } = this.deps;
    const plan: Array<{ name: string; before: number; delta: number }> = [];
    for (const name of args.sliders) {
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

    const probeStarted = this.now().toISOString();
    const historyNames: string[] = [];
    const results: Array<{ name: string; delta_applied: number; delta_metrics: ReturnType<typeof deltaMetrics>; per_unit: Slope }> = [];
    /** Sliders that may hold a probe value now, with the value to put back. */
    const outstanding = new Map<string, number>();
    try {
      let previous: { name: string; before: number } | null = null;
      for (const p of plan) {
        const values: Record<string, CanonicalValue> = { [p.name]: roundForSlider(p.name, p.before + p.delta) };
        if (previous) values[previous.name] = previous.before;
        const name = `AVG ${s.short} probe ${p.name}`;
        outstanding.set(p.name, p.before); // before the write: a failed write may still have changed it
        const probedView = await this.write(s, values, name);
        if (previous) outstanding.delete(previous.name); // this write put the previous slider back
        historyNames.push(name);
        const probed = await this.render(s, probedView.settings, { keep: false });
        const d = deltaMetrics(base.metrics, probed.metrics);
        const perUnit: Slope = {
          luma_mean: Math.round((d.luma_mean / p.delta) * 10000) / 10000,
          clip_high_pct: Math.round((d.clip_high_pct / p.delta) * 10000) / 10000,
          clip_low_pct: Math.round((d.clip_low_pct / p.delta) * 10000) / 10000,
        };
        s.slopes.set(p.name, perUnit);
        results.push({ name: p.name, delta_applied: p.delta, delta_metrics: d, per_unit: perUnit });
        previous = p;
      }
      if (previous) {
        const revertName = `AVG ${s.short} probe revert`;
        const back = await this.write(s, { [previous.name]: previous.before }, revertName);
        historyNames.push(revertName);
        for (const p of plan) if (back.settings[p.name] === p.before) outstanding.delete(p.name);
        // Every probed slider is checked, not only those still marked for recovery: one put back
        // earlier may have been changed in Lightroom since (Greptile, PR #23) [handle:
        // tests\session.test.ts "reports a probed slider changed in Lightroom after it was put back"].
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
    } catch (err) {
      // Put back the sliders that may still hold a probe value, so a failed probe leaves no temporary
      // edit behind, and only those, so an edit made meanwhile to a slider the probe never reached
      // is kept (Greptile, PR #23) [handle: tests\session.test.ts "puts the probed sliders back when a
      // probe fails half-way", "after a failed probe puts back only the sliders it changed"]. If the
      // write fails too, the next step renders the photo again before it plans (fresh()), because
      // the settings then differ from the last render's.
      if (outstanding.size > 0) {
        const back: Record<string, CanonicalValue> = Object.fromEntries(outstanding);
        const revertName = `AVG ${s.short} probe revert`;
        try {
          await this.write(s, back, revertName);
          historyNames.push(revertName);
        } catch (restoreErr) {
          s.log.failures.push({ at: this.now().toISOString(), stage: "probe (put back)", error: toToolError(restoreErr).body() });
        }
      }
      throw this.failed(s, "probe", err);
    }
    s.log.probes.push({ started: probeStarted, duration_ms: ms(started), magnitude, history_names: historyNames, results });
    this.saveLog(s);
    return {
      json: {
        ok: true,
        session_id: s.id,
        magnitude,
        results,
        history_names: historyNames,
        note: "The probed sliders are back to their values before the probe. per_unit is the metric change per unit of the slider; lr_step uses it to cap changes that would cross a clipping limit.",
        timings: { total_ms: ms(started) },
      },
      log: { session_id: s.id, sliders: args.sliders, history_names: historyNames },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // lr_set_regions (no Lightroom call: the regions are measured on the last preview)

  setRegions(args: RegionArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.setRegionsNow(args));
  }

  private async setRegionsNow(args: RegionArgs): Promise<SessionOutput> {
    const s = this.require(args.session_id);
    if (args.regions.length > MAX_REGIONS) throw new ToolError("INVALID_ARGUMENTS", `At most ${MAX_REGIONS} regions.`, false);
    const labels = new Set<string>();
    for (const r of args.regions) {
      const problem = boxProblem(r.box);
      if (problem) throw new ToolError("INVALID_ARGUMENTS", `Region "${r.label}": ${problem}.`, false);
      if (labels.has(r.label)) throw new ToolError("INVALID_ARGUMENTS", `Two regions are labelled "${r.label}"; labels must differ.`, false);
      labels.add(r.label);
    }
    if (!s.last) throw new ToolError("NO_PREVIEW_YET", "The session has no preview to measure the regions on yet.", true);
    const regions = args.regions.map((r) => ({ label: r.label, box: r.box }));
    const metrics = await measureImage(s.last.jpeg, regions);
    s.last = { ...s.last, metrics };
    s.regions = args.regions.map((r): RegionState => {
      const measured = metrics.regions.find((m) => m.label === r.label);
      const preserve = r.preserve === true;
      return {
        kind: r.kind,
        label: r.label,
        box: r.box,
        preserve,
        baseline: preserve && measured ? { hue_mean: measured.hue_mean, saturation_mean: measured.saturation_mean } : null,
      };
    });
    s.log.regions = s.regions.map((r) => ({ ...r, box: { ...r.box } }));
    this.saveLog(s);
    return {
      json: {
        ok: true,
        session_id: s.id,
        regions: metrics.regions,
        preserved: s.regions.filter((r) => r.preserve).map((r) => ({ label: r.label, baseline: r.baseline })),
        note:
          `Region metrics appear in every later metrics.regions[]. A preserved region's mean hue may drift at most ${REGION_PRESERVE.hueDegrees} degrees ` +
          `and its mean saturation ${REGION_PRESERVE.saturationPoints} points from the values measured now; a step that drifts further is undone.`,
      },
      log: { session_id: s.id, regions: s.regions.map((r) => ({ label: r.label, preserve: r.preserve })) },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // lr_end_session

  end(args: EndArgs): Promise<SessionOutput> {
    return this.exclusive(() => this.endNow(args));
  }

  private async endNow(args: EndArgs): Promise<SessionOutput> {
    const started = performance.now();
    const s = this.require(args.session_id);
    const { client, map } = this.deps;
    let finalSettings: CanonicalSettings;
    let recipePath: string | null = null;
    let revert: { ms: number; differing: string[] } | null = null;
    try {
      if (args.outcome === "accept") {
        finalSettings = (await this.read(s)).settings;
        s.files.writeRecipe({
          schema: RECIPE_SCHEMA_ID,
          session_id: s.id,
          created: this.now().toISOString(),
          intent_id: s.intent.intent.id,
          source: { uuid: s.target.uuid, filename: s.target.filename },
          process_version: s.target.process_version,
          settings: finalSettings,
        });
        recipePath = s.files.recipePath;
      } else {
        const t = performance.now();
        const res = await this.bridge(s, () => client.request("apply_snapshot", { target_uuid: s.target.uuid, snapshot_id: s.snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS }));
        const revertMs = ms(t);
        finalSettings = map.fromSdk(res.read_back).settings;
        const keys = new Set([...Object.keys(finalSettings), ...Object.keys(s.startSettings)]);
        const differing = [...keys].filter((k) => !same(finalSettings[k], s.startSettings[k])).sort();
        revert = { ms: revertMs, differing };
      }
    } catch (err) {
      throw this.failed(s, `end (${args.outcome})`, err);
    }
    s.log.outcome = args.outcome;
    s.log.ended = this.now().toISOString();
    s.log.final_settings = finalSettings;
    s.log.recipe_path = recipePath;
    s.log.revert = revert;
    this.saveLog(s);
    this.ended.set(s.id, s.files.logPath);
    this.session = null;
    return {
      json: {
        ok: true,
        session_id: s.id,
        outcome: args.outcome,
        passes: `${s.passes}/${s.maxPasses}`,
        log_path: s.files.logPath,
        recipe_path: recipePath,
        final_settings: finalSettings,
        ...(revert ? { revert } : {}),
        timings: { total_ms: ms(started) },
      },
      log: { session_id: s.id, outcome: args.outcome, log_path: s.files.logPath, recipe_path: recipePath, ...(revert ? { revert } : {}) },
    };
  }

  // ---------------------------------------------------------------------------------------------
  // lr_get_session_log (no Lightroom call)

  getLog(args: { session_id: string }): SessionOutput {
    if (this.session?.id === args.session_id) return { json: { ok: true, open: true, log_path: this.session.files.logPath, log: this.session.log } };
    let file = this.ended.get(args.session_id) ?? null;
    if (!file) {
      const short = args.session_id.replace(/-/g, "").slice(0, 6);
      try {
        const match = readdirSync(this.deps.logDir).find((f) => f.endsWith(`-${short}.json`));
        if (match) file = path.join(this.deps.logDir, match);
      } catch {
        // no log folder yet
      }
    }
    if (file) {
      const log = JSON.parse(readFileSync(file, "utf8")) as { session_id?: unknown };
      if (log.session_id === args.session_id) return { json: { ok: true, open: false, log_path: file, log } };
    }
    throw new ToolError("SESSION_NOT_FOUND", `No session log for ${args.session_id} in ${this.deps.logDir}.`, false);
  }

  // ---------------------------------------------------------------------------------------------
  // Helpers

  private require(sessionId: string): Session {
    const s = this.session;
    if (!s || s.id !== sessionId) {
      throw new ToolError(
        "SESSION_NOT_ACTIVE",
        s ? `Session ${sessionId} is not the open one (${s.id}).` : `No session is open (asked for ${sessionId}); start one with lr_begin_session.`,
        false,
      );
    }
    return s;
  }

  /** Run a bridge call for the session; a changed selection keeps the session open (PRD 6.13). */
  private async bridge<T>(s: Session, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const error = toToolError(err);
      if (error.code !== "TARGET_CHANGED") throw error;
      throw new ToolError(
        "TARGET_CHANGED",
        `The photo selected in Lightroom is not this session's photo ("${s.target.filename ?? s.target.uuid}"). Nothing was written. ` +
          "Select that photo again, then repeat the call; the session is still open.",
        true,
        { session_id: s.id, target_uuid: s.target.uuid },
      );
    }
  }

  private async read(s: Session): Promise<FromSdkResult> {
    const res = await this.bridge(s, () => this.deps.client.request("get_settings", { target_uuid: s.target.uuid }));
    return this.deps.map.fromSdk(res.settings);
  }

  /** Write canonical values as one History step and check the read-back (Phase 0, P-12). */
  private async write(s: Session, values: Record<string, CanonicalValue>, historyName: string): Promise<FromSdkResult> {
    const { client, map } = this.deps;
    const sdk = map.toSdk(values, { processVersion: s.target.process_version });
    const res = await this.bridge(s, () =>
      client.request("apply_settings", { target_uuid: s.target.uuid, settings: sdk, history_name: historyName }, { timeoutMs: WRITE_TIMEOUT_MS }),
    );
    const mismatches = map.verifyReadback(sdk, res.read_back);
    if (mismatches.length > 0) {
      throw new ToolError("WRITE_NOT_TAKEN", `Lightroom did not take ${mismatches.map((m) => m.sdk_key).join(", ")} as written in "${historyName}".`, false, {
        history_name: historyName,
        mismatches,
      });
    }
    return map.fromSdk(res.read_back);
  }

  /**
   * Render the session's photo, measuring its regions. `settings` are the settings the render
   * shows (the last read-back). `keep: false` leaves the session's last render alone (probes).
   */
  private async render(s: Session, settings: CanonicalSettings, options: { keep?: boolean; longEdge?: number } = {}): Promise<Rendered> {
    const longEdge = options.longEdge ?? s.longEdge;
    const preview = await this.bridge(s, () =>
      this.deps.render({
        longEdge,
        quality: s.quality,
        targetUuid: s.target.uuid,
        regions: s.regions.map((r) => ({ label: r.label, box: r.box })),
      }),
    );
    const rendered: Rendered = {
      metrics: preview.metrics,
      jpeg: preview.jpeg,
      hash: preview.sha256,
      width: preview.width,
      height: preview.height,
      timings: preview.timings,
      settings,
      longEdge,
      preview,
    };
    if (options.keep !== false) s.last = rendered;
    return rendered;
  }

  /**
   * The last render, rendered again first when it no longer stands for the photo as the session
   * measures it (Greptile, PR #23):
   *   - its settings are not the photo's now (an edit in Lightroom between calls, or a render after
   *     a write failed);
   *   - it is at another size than the session's (lr_get_preview with another long_edge), since
   *     resizing averages pixels and so moves the clipping counts [inference].
   * The guardrails, deltas and convergence then compare like with like [handle: tests\session.test.ts
   * "renders again before a step when the photo was edited in Lightroom since the last render",
   * "renders at the session's size again before a step that follows a preview at another size"].
   */
  private async fresh(s: Session, view: FromSdkResult): Promise<{ last: Rendered; refreshed: boolean }> {
    if (s.last && s.last.longEdge === s.longEdge && same(s.last.settings, view.settings)) return { last: s.last, refreshed: false };
    return { last: await this.render(s, view.settings), refreshed: true };
  }

  /**
   * Run session operations one at a time, in the order called (Greptile, PR #23: parallel steps
   * could share a pass number) [handle: tests\session.test.ts "runs steps sent at the same time one
   * after the other, each with its own pass number"].
   */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.tail.then(fn, fn);
    this.tail = run.catch(() => undefined);
    return run;
  }

  /**
   * The actual guardrail (ARCHITECTURE section 4): while clipping is over a limit, up to
   * MAX_CORRECTIONS renders. With a step's changes, first pull back half, then all, of the sliders
   * that pushed towards the breach; otherwise, or when none did, the fixed steps (PRD 6.5).
   */
  private async correct(
    s: Session,
    n: number,
    changes: readonly Change[] | null,
    view: FromSdkResult,
    rendered: Rendered,
    historyNames: string[],
  ): Promise<{ view: FromSdkResult; rendered: Rendered; actions: GuardrailAction[] }> {
    const actions: GuardrailAction[] = [];
    const state = { high: { pulls: 0, table: 0 }, low: { pulls: 0, table: 0 } };
    let current = view;
    let now = rendered;
    for (let round = 1; round <= MAX_CORRECTIONS; round++) {
      const m = now.metrics;
      const breached = (["high", "low"] as const).filter((k) => (k === "high" ? m.clip_high_pct > s.limits.clipHighPct : m.clip_low_pct > s.limits.clipLowPct));
      if (breached.length === 0) break;
      const fix: Record<string, number> = {};
      for (const kind of breached) {
        const st = state[kind];
        let part: Record<string, number> = {};
        if (changes && st.pulls < 2) {
          part = pullBack(changes, kind, st.pulls === 0 ? 0.5 : 1);
          if (Object.keys(part).length > 0) st.pulls++;
        }
        const table = kind === "high" ? HIGH_CORRECTIONS : LOW_CORRECTIONS;
        while (Object.keys(part).length === 0 && st.table < table.length) {
          part = fixedCorrection(table[st.table] as Record<string, number>, current.settings, this.deps.map);
          st.table++;
        }
        for (const [k, v] of Object.entries(part)) if (!(k in fix)) fix[k] = v;
      }
      if (Object.keys(fix).length === 0) break;
      const name = this.historyName(s, n, n === 0 ? `baseline ${round}` : `guard ${round}`);
      current = await this.write(s, fix, name);
      historyNames.push(name);
      now = await this.render(s, current.settings);
      for (const kind of breached) {
        const was = kind === "high" ? m.clip_high_pct : m.clip_low_pct;
        const limit = kind === "high" ? s.limits.clipHighPct : s.limits.clipLowPct;
        actions.push({
          kind: "corrected",
          limit: kind === "high" ? "clip_high" : "clip_low",
          reason: `clip_${kind}_pct was ${was} %, over the limit of ${limit} %`,
          history_name: name,
          changes: fix,
          metrics_after: summarize(now.metrics),
        });
      }
    }
    const m = now.metrics;
    for (const kind of ["high", "low"] as const) {
      const value = kind === "high" ? m.clip_high_pct : m.clip_low_pct;
      const limit = kind === "high" ? s.limits.clipHighPct : s.limits.clipLowPct;
      if (value > limit) {
        actions.push({
          kind: "unmet",
          limit: kind === "high" ? "clip_high" : "clip_low",
          reason: `clip_${kind}_pct is still ${value} %, over the limit of ${limit} %, after the corrections this pass allows`,
          history_name: null,
          changes: {},
          metrics_after: summarize(m),
        });
      }
    }
    return { view: current, rendered: now, actions };
  }

  /** The first preserved region that drifted past REGION_PRESERVE, described; null when none did. */
  private regionDrift(s: Session, metrics: Metrics): string | null {
    for (const r of s.regions) {
      if (!r.preserve || !r.baseline) continue;
      const m = metrics.regions.find((x) => x.label === r.label);
      if (!m) continue;
      // A region that had a hue and has none now (its pixels went below the chromatic threshold) has
      // lost its colour: a breach, not zero drift (Greptile, PR #23) [handle: tests\session.test.ts
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

  /** Pass 0's settings: the intent's camera profile and priors (numbers added to the photo's values). */
  private pass0Changes(loaded: LoadedIntent, current: CanonicalSettings): Record<string, CanonicalValue> {
    const out: Record<string, CanonicalValue> = {};
    const profile = loaded.intent.default_camera_profile;
    if (profile !== undefined && current["camera_profile"] !== profile) out["camera_profile"] = profile;
    for (const [name, value] of Object.entries(loaded.intent.priors)) {
      const spec = this.deps.map.spec(name);
      if (spec?.kind === "number") {
        const before = current[name];
        if (typeof before !== "number" || typeof value !== "number") continue; // e.g. dropped by a monochrome profile
        const after = roundForSlider(name, Math.min(spec.max, Math.max(spec.min, before + value)));
        if (after !== before) out[name] = after;
      } else if (!same(current[name], value)) {
        out[name] = value as CanonicalValue;
      }
    }
    return out;
  }

  private historyName(s: Session, n: number, suffix?: string): string {
    return `AVG ${s.short} pass ${n}/${s.maxPasses}${suffix ? ` ${suffix}` : ""}`;
  }

  private async image(s: Session, mode: ReturnImage, before: Rendered, after: Rendered, beforeLabel: string, afterLabel: string): Promise<Buffer | null> {
    if (mode === "none") return null;
    if (mode === "after") return after.jpeg;
    const out = await composite(
      [
        { image: before.jpeg, label: beforeLabel },
        { image: after.jpeg, label: afterLabel },
      ],
      { longEdge: s.longEdge, quality: s.quality },
    );
    return out.jpeg;
  }

  private describe(r: Rendered): Record<string, unknown> {
    return { preview_source: "export", preview_hash: r.hash, width: r.width, height: r.height };
  }

  private brief(m: Metrics): Record<string, number> {
    return { luma_mean: m.luma_mean, clip_high_pct: m.clip_high_pct, clip_low_pct: m.clip_low_pct };
  }

  private recordPass(s: Session, entry: PassEntry): void {
    s.log.passes.push(entry);
    this.saveLog(s);
  }

  private saveLog(s: Session): void {
    s.log.regions = s.regions.map((r) => ({ ...r, box: { ...r.box } }));
    s.files.writeLog(s.log);
  }

  /** Record a failure in the open session's log and return the error to throw, naming the session. */
  private failed(s: Session, stage: string, err: unknown): ToolError {
    const error = toToolError(err);
    s.log.failures.push({ at: this.now().toISOString(), stage, error: error.body() });
    try {
      this.saveLog(s);
    } catch {
      // the error being reported matters more than the log write
    }
    const details = typeof error.details === "object" && error.details !== null ? error.details : {};
    return new ToolError(error.code, `${error.message} (session ${s.id} is still open; lr_end_session with outcome "revert" puts the photo back.)`, error.recoverable, {
      ...details,
      session_id: s.id,
    });
  }
}

function numericOnly(values: Record<string, CanonicalValue>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).filter((e): e is [string, number] => typeof e[1] === "number"));
}
