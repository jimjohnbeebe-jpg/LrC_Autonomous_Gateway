// lr_begin_session: open the session (snapshot, log), then pass 0 (camera profile, lens, intent
// priors, then the clipping baseline) with its preview, metrics and the intent's brief.

import { existsSync } from "node:fs";
import type { CommandResult } from "../bridge/index.js";
import type { LoadedIntent } from "../intents/index.js";
import { SESSION_LOG_SCHEMA_ID, SessionLogFiles, type GuardrailAction, type SessionLogData } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { deltaMetrics, summarize, type MetricsDelta } from "../metrics/index.js";
import { canonicalValuesEqual, type CanonicalSettings, type CanonicalValue, type FromSdkResult, type ParamMap } from "../params/index.js";
import { correct } from "./guardrail.js";
import { brief, describe, failed, historyName, image, ms, recordPass, render, saveLog, text, write } from "./io.js";
import type { Change } from "./plan.js";
import { SESSION_DEFAULTS, roundForSlider } from "./rules.js";
import type { BeginArgs, Rendered, Session, SessionContext, SessionOutput } from "./types.js";

/** A session just opened: its pre-session settings and the photo's context, for pass 0. */
export type Opened = { s: Session; view: FromSdkResult; photo: CommandResult<"get_context">; started: number };

/** What pass 0 did, for its log entry and its result. */
type Pass0 = {
  passStarted: string;
  original: Rendered;
  applied: Change[];
  historyNames: string[];
  view: FromSdkResult;
  rendered: Rendered;
  actions: GuardrailAction[];
  delta: MetricsDelta;
};

/** Check the call, read the photo, take the pre-session snapshot and build the session (not yet logged). */
export async function openSession(ctx: SessionContext, args: BeginArgs): Promise<Opened> {
  const started = performance.now();
  if (args.mode !== undefined && args.mode !== "converge") {
    throw new ToolError("INVALID_ARGUMENTS", "Only mode \"converge\" is available; Variants mode comes in Phase 4.", false);
  }
  const loaded = ctx.deps.intents.get(args.intent_id); // IntentError -> INTENT_NOT_FOUND
  const { client, map } = ctx.deps;

  const photo = await client.request("get_context", {});
  if (photo["file_format"] === "VIDEO") throw new ToolError("VIDEO_NOT_SUPPORTED", "The selected item is a video; select a photo.", false);
  const view = map.fromSdk((await client.request("get_settings", { target_uuid: photo.uuid })).settings); // LEGACY_PROCESS_VERSION

  const now = ctx.now();
  const { id, short, files } = pickLogFiles(ctx, now);
  const snapshotName = `AVG pre-session ${now.toISOString()}`;
  const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: snapshotName });
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
      uuid: photo.uuid,
      local_id: photo.local_id,
      filename: text(photo["filename"]),
      copy_name: text(photo["copy_name"]),
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
  s.log = newLog(ctx, s, args.notes ?? null);
  return { s, view, photo, started };
}

/**
 * The log's name is <yyyymmdd>-<6 hex> (PRD 6.12): a new id when that name is taken, so a session
 * never writes over another's log or recipe (Greptile, PR #23) [handle: tests\session-step.test.ts
 * "picks a new session id when the log name for the day is taken"].
 */
function pickLogFiles(ctx: SessionContext, now: Date): { id: string; short: string; files: SessionLogFiles } {
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = ctx.newId();
    const short = id.replace(/-/g, "").slice(0, 6);
    const candidate = new SessionLogFiles(ctx.deps.logDir, now, short);
    if (!existsSync(candidate.logPath) && !existsSync(candidate.recipePath)) return { id, short, files: candidate };
  }
  throw new ToolError("INTERNAL_ERROR", `No free session log name in ${ctx.deps.logDir} after 5 tries.`, false);
}

function newLog(ctx: SessionContext, s: Session, notes: string | null): SessionLogData {
  const { intent } = s;
  return {
    schema: SESSION_LOG_SCHEMA_ID,
    session_id: s.id,
    short_id: s.short,
    engine_version: ctx.deps.engineVersion,
    started: s.startedAt.toISOString(),
    ended: null,
    outcome: null,
    intent: { id: intent.intent.id, label: intent.intent.label, source: intent.source },
    mode: "converge",
    max_passes: s.maxPasses,
    guardrails: { clip_high_pct: s.limits.clipHighPct, clip_low_pct: s.limits.clipLowPct },
    decay: [...s.decay],
    notes,
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
}

/** Log the open session, then run pass 0. A failure leaves the session open, so Claude can end it with revert. */
export async function runPass0(ctx: SessionContext, opened: Opened, args: BeginArgs): Promise<SessionOutput> {
  const { s } = opened;
  saveLog(s);
  try {
    const p = await pass0(ctx, s, opened.view);
    recordPass(s, {
      n: 0,
      kind: "pass0",
      target: "master",
      started: p.passStarted,
      duration_ms: ms(opened.started),
      history_names: p.historyNames,
      rationale: "engine: camera profile, lens corrections and intent priors, then the clipping baseline (PRD 6.5)",
      requested: { ...(s.intent.intent.default_camera_profile ? { camera_profile: s.intent.intent.default_camera_profile } : {}), ...s.intent.intent.priors },
      changes: p.applied,
      clamped: [],
      refused: [],
      unchanged: [],
      settings_before: opened.view.settings,
      settings_after: p.view.settings,
      metrics_before: summarize(p.original.metrics),
      metrics_after: summarize(p.rendered.metrics),
      delta_metrics: p.delta,
      preview_hash: p.rendered.hash,
      preview_source: "export",
      guardrail_actions: p.actions,
      converged_by_metrics: false,
    });
    const json = beginJson(opened, p);
    const img = await image(s, args.return_image ?? "after", p.original, p.rendered, "before", "pass 0");
    return {
      json,
      ...(img ? { image: img } : {}),
      log: { session_id: s.id, intent_id: s.intent.intent.id, target: { uuid: s.target.uuid, filename: s.target.filename }, snapshot: s.snapshot, log_path: s.files.logPath, history_names: p.historyNames, metrics: brief(p.rendered.metrics), guardrail_actions: p.actions.length },
    };
  } catch (err) {
    throw failed(ctx, s, "begin", err);
  }
}

/** Render the photo as it is, write pass 0's settings as one History step, then the clipping baseline. */
async function pass0(ctx: SessionContext, s: Session, view: FromSdkResult): Promise<Pass0> {
  const passStarted = ctx.now().toISOString();
  const original = await render(ctx, s, view.settings);
  const changes = pass0Changes(s.intent, view.settings, ctx.deps.map);
  const historyNames: string[] = [];
  let current = view;
  let rendered = original;
  if (Object.keys(changes).length > 0) {
    const name = historyName(s, 0);
    current = await write(ctx, s, changes, name);
    historyNames.push(name);
    rendered = await render(ctx, s, current.settings);
  }
  const corrected = await correct(ctx, s, 0, null, current, rendered, historyNames);
  const applied = Object.entries(changes).map(([name, after]): Change => {
    const before = view.settings[name] ?? null;
    return { name, before, requested: after, after, delta: typeof before === "number" && typeof after === "number" ? roundForSlider(name, after - before) : null };
  });
  const delta = deltaMetrics(original.metrics, corrected.rendered.metrics);
  return { passStarted, original, applied, historyNames, view: corrected.view, rendered: corrected.rendered, actions: corrected.actions, delta };
}

function beginJson(opened: Opened, p: Pass0): Record<string, unknown> {
  const { s, photo } = opened;
  const { intent, source } = s.intent;
  return {
    ok: true,
    session_id: s.id,
    pass: `0/${s.maxPasses}`,
    target: { ...s.target, exif: { iso: photo["iso"] ?? null, shutter: photo["shutter"] ?? null, aperture: photo["aperture"] ?? null, focal_length: photo["focal_length"] ?? null, lens: photo["lens"] ?? null, camera: photo["camera"] ?? null } },
    intent: { id: intent.id, label: intent.label, source },
    intent_brief: {
      brief: intent.brief,
      convergence_hints: intent.convergence_hints ?? [],
      regions_expected: intent.regions_expected ?? [],
      allow_probe: intent.allow_probe ?? false,
    },
    guardrails: s.log.guardrails,
    max_passes: s.maxPasses,
    snapshot: s.snapshot,
    history_names: p.historyNames,
    pass0_applied: p.applied,
    guardrail_actions: p.actions,
    settings: p.view.settings,
    metrics: summarize(p.rendered.metrics),
    delta_metrics: p.delta,
    ...describe(p.rendered),
    timings: { total_ms: ms(opened.started) },
  };
}

/** Pass 0's settings: the intent's camera profile and priors (numbers added to the photo's values). */
function pass0Changes(loaded: LoadedIntent, current: CanonicalSettings, map: ParamMap): Record<string, CanonicalValue> {
  const out: Record<string, CanonicalValue> = {};
  const profile = loaded.intent.default_camera_profile;
  if (profile !== undefined && current["camera_profile"] !== profile) out["camera_profile"] = profile;
  for (const [name, value] of Object.entries(loaded.intent.priors)) {
    const spec = map.spec(name);
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
