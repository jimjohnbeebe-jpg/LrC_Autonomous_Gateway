// lr_begin_session: open the session (checks, snapshot, log), then pass 0 (camera profile, lens,
// intent priors, then the clipping baseline) with its preview, metrics and the intent's brief.
// Converge mode runs pass 0 on the master here (runPass0); Variants mode makes the copies and runs
// pass 0 on each (variants.ts runVariants) [handle: tests\session-variants.test.ts "makes the
// copies, runs pass 0 on each with the intent's priors plus its variant's, and leaves the master
// alone", against the Lightroom sim; in Lightroom [unverified] until PHASE4_PLAN row 10].

import { existsSync } from "node:fs";
import type { CommandResult } from "../bridge/index.js";
import { SESSION_LOG_SCHEMA_ID, SessionLogFiles, type SessionLogData } from "../log/index.js";
import { ToolError } from "../mcp/errors.js";
import { summarize } from "../metrics/index.js";
import type { FromSdkResult } from "../params/index.js";
import { checkVariants } from "./copies.js";
import { brief, describe, failed, image, ms, recordPass, saveLog, text } from "./io.js";
import { pass0, pass0Entry, type Pass0 } from "./pass0.js";
import { SESSION_DEFAULTS } from "./rules.js";
import { newTarget, type BeginArgs, type Session, type SessionContext, type SessionOutput } from "./types.js";

/** A session just opened: its pre-session settings and the photo's context, for pass 0. */
export type Opened = { s: Session; view: FromSdkResult; photo: CommandResult<"get_context">; started: number };

/** Check the call, read the photo, take the pre-session snapshot and build the session (not yet logged). */
export async function openSession(ctx: SessionContext, args: BeginArgs): Promise<Opened> {
  const started = performance.now();
  const mode = args.mode ?? "converge";
  if (mode === "converge" && args.variant_count !== undefined) {
    throw new ToolError("INVALID_ARGUMENTS", 'variant_count is for mode "variants"; Converge mode edits the selected photo itself.', false);
  }
  const loaded = ctx.deps.intents.get(args.intent_id); // IntentError -> INTENT_NOT_FOUND
  const { client, map } = ctx.deps;

  const photo = await client.request("get_context", {});
  if (photo["file_format"] === "VIDEO") throw new ToolError("VIDEO_NOT_SUPPORTED", "The selected item is a video; select a photo.", false);
  const variantCount = mode === "variants" ? checkVariants(ctx, loaded, photo, args.variant_count) : null;
  const view = map.fromSdk((await client.request("get_settings", { target_uuid: photo.uuid })).settings); // LEGACY_PROCESS_VERSION

  const now = ctx.now();
  const { id, short, files } = pickLogFiles(ctx, now);
  const snapshotName = `AVG pre-session ${now.toISOString()}`;
  const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: snapshotName });
  const overrides = loaded.intent.guardrail_overrides ?? {};
  const master = newTarget({
    id: "master",
    label: null,
    uuid: photo.uuid,
    local_id: photo.local_id,
    filename: text(photo["filename"]),
    copy_name: text(photo["copy_name"]),
    process_version: view.process_version,
    camera_profile: view.camera_profile.name,
  });
  const s: Session = {
    id,
    short,
    startedAt: now,
    intent: loaded,
    mode,
    maxPasses: args.max_passes ?? SESSION_DEFAULTS.maxPasses,
    limits: {
      clipHighPct: args.guardrails?.clip_high_pct ?? overrides.clip_high_pct ?? SESSION_DEFAULTS.clipHighPct,
      clipLowPct: args.guardrails?.clip_low_pct ?? overrides.clip_low_pct ?? SESSION_DEFAULTS.clipLowPct,
    },
    decay: SESSION_DEFAULTS.decay,
    longEdge: args.long_edge ?? SESSION_DEFAULTS.longEdge,
    quality: SESSION_DEFAULTS.quality,
    master,
    variants: [],
    picked: null,
    ready: mode === "converge",
    active: master,
    snapshot: { name: snapshotName, id: snap.snapshot_id },
    startSettings: view.settings,
    regions: [],
    files,
    log: {} as SessionLogData,
  };
  s.log = newLog(ctx, s, variantCount, args.notes ?? null);
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

function newLog(ctx: SessionContext, s: Session, variantCount: number | null, notes: string | null): SessionLogData {
  const { intent, master } = s;
  return {
    schema: SESSION_LOG_SCHEMA_ID,
    session_id: s.id,
    short_id: s.short,
    engine_version: ctx.deps.engineVersion,
    started: s.startedAt.toISOString(),
    ended: null,
    outcome: null,
    intent: { id: intent.intent.id, label: intent.intent.label, source: intent.source },
    mode: s.mode,
    variant_count: variantCount,
    max_passes: s.maxPasses,
    guardrails: { clip_high_pct: s.limits.clipHighPct, clip_low_pct: s.limits.clipLowPct },
    decay: [...s.decay],
    notes,
    target: {
      uuid: master.uuid,
      local_id: master.local_id,
      filename: master.filename,
      copy_name: master.copy_name,
      process_version: master.process_version,
      camera_profile: master.camera_profile,
    },
    snapshot: s.snapshot,
    variants: [],
    picked: null,
    regions: [],
    passes: [],
    probes: [],
    failures: [],
    final_settings: null,
    recipe_path: null,
    revert: null,
  };
}

/** Converge mode: log the open session, then run pass 0. A failure leaves the session open, so Claude can end it with revert. */
export async function runPass0(ctx: SessionContext, opened: Opened, args: BeginArgs): Promise<SessionOutput> {
  const { s } = opened;
  saveLog(s);
  try {
    const p = await pass0(ctx, s, s.master, opened.view, null, null);
    recordPass(s, pass0Entry(s, s.master, opened.view, p, ms(opened.started)));
    const json = beginJson(opened, p);
    const img = await image(s, args.return_image ?? "after", p.original, p.rendered, "before", "pass 0");
    return {
      json,
      ...(img ? { image: img } : {}),
      log: { session_id: s.id, intent_id: s.intent.intent.id, target: { uuid: s.master.uuid, filename: s.master.filename }, snapshot: s.snapshot, log_path: s.files.logPath, history_names: p.historyNames, metrics: brief(p.rendered.metrics), guardrail_actions: p.actions.length },
    };
  } catch (err) {
    throw failed(ctx, s, "begin", err);
  }
}

/** What both modes' results start with: the session, the master, the intent and its brief. */
export function sessionHeader(opened: Opened): Record<string, unknown> {
  const { s, photo } = opened;
  const { intent, source } = s.intent;
  const { passes: _passes, endReason: _end, last: _last, slopes: _slopes, id: _id, label: _label, ...target } = s.master;
  return {
    ok: true,
    session_id: s.id,
    mode: s.mode,
    target: { ...target, exif: { iso: photo["iso"] ?? null, shutter: photo["shutter"] ?? null, aperture: photo["aperture"] ?? null, focal_length: photo["focal_length"] ?? null, lens: photo["lens"] ?? null, camera: photo["camera"] ?? null } },
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
  };
}

function beginJson(opened: Opened, p: Pass0): Record<string, unknown> {
  const { s } = opened;
  return {
    ...sessionHeader(opened),
    pass: `0/${s.maxPasses}`,
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
