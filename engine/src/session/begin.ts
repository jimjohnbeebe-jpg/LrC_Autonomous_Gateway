// lr_begin_session: open the session (checks, snapshot, log), then pass 0 (camera profile, lens,
// intent priors, then the clipping baseline when clip_baseline is on) with its preview, metrics and the intent's brief.
// Converge mode runs pass 0 on the master here (runPass0); Variants mode makes the copies and runs
// pass 0 on each (variants.ts runVariants) [handle: tests\session-variants.test.ts "makes the
// copies, runs pass 0 on each with the intent's priors plus its variant's, and leaves the master
// alone", against the Lightroom sim; in Lightroom [unverified] until PHASE4_PLAN row 10].
// The session's numbers come from the settings page first read here (get_prefs, PHASE5_PLAN row 3),
// in the order settings\session.ts gives [handle: tests\settings-session.test.ts, against the
// Lightroom sim; in Lightroom [unverified] until the row 3 probe and PHASE5_PLAN row 7].

import { existsSync } from "node:fs";
import path from "node:path";
import { UPDATE_HUD_NOTE, lightroomNotices, updateNotices, type CommandResult } from "../bridge/index.js";
import type { LoadedIntent } from "../intents/index.js";
import { SESSION_LOG_SCHEMA_ID, SessionLogFiles, type SessionLogData } from "../log/index.js";
import { ToolError, originalMissing } from "../mcp/errors.js";
import { summarize } from "../metrics/index.js";
import { WHITE_BALANCE_UNITS, type CanonicalSettings, type FromSdkResult } from "../params/index.js";
import { readPage, resolveSessionSettings, type PageRead, type SessionSettings } from "../settings/index.js";
import { APPROVAL_WAIT_MS } from "./approval.js";
import { checkVariants } from "./copies.js";
import { brief, describe, failed, image, ms, recordPass, saveLog, text } from "./io.js";
import { refuseLeftOpen } from "./left-open.js";
import { pass0, pass0Entry, type Pass0 } from "./pass0.js";
import { WRITE_TIMEOUT_MS, folderOf, newTarget, type BeginArgs, type Session, type SessionContext, type SessionOutput } from "./types.js";

/**
 * A session begun without an intent: pass 0 writes no profile and no priors, and Claude edits from the
 * user's request (issue #108 [stated: Jim, 2026-10-10, "The user prompt MUST take precedence every
 * time"; plan A+B, "Go with your recommendations"]).
 */
const NO_INTENT: LoadedIntent = {
  intent: { schema_version: 2, id: "none", label: "No intent", category: "none", brief: "No intent: edit as the user's request asks.", priors: {} },
  source: "none",
  path: "",
  overrides_bundled: false,
};

/** A session just opened: its pre-session settings and the photo's context, for pass 0. */
export type Opened = { s: Session; view: FromSdkResult; photo: CommandResult<"get_context">; started: number };

/** Check the call, read the photo, take the pre-session snapshot and build the session (not yet logged). */
export async function openSession(ctx: SessionContext, given: BeginArgs): Promise<Opened> {
  const started = performance.now();
  const mode = given.mode ?? "converge";
  // An argument that does not apply is ignored, not refused: a model that fills every optional field sent
  // variant_count in Converge mode and intent_id "none", and never got a session [handle:
  // docs\reports\phase8.5\clients-probe.json clients[1], OpenCode with openrouter/openai/gpt-6-luna].
  const { variant_count, intent_id, ...rest } = given;
  const args: BeginArgs = {
    ...rest,
    ...(mode === "variants" && variant_count !== undefined ? { variant_count } : {}),
    ...(intent_id !== undefined && intent_id !== NO_INTENT.intent.id ? { intent_id } : {}),
  };
  // The page first: its intents folder is where the intent is looked up (settings\folders.ts).
  const page = await (ctx.deps.readPage ?? (() => readPage(ctx.deps.client)))();
  if (mode === "variants" && args.intent_id === undefined) {
    throw new ToolError("INVALID_ARGUMENTS", 'mode "variants" takes its looks from an intent with variants: name one with intent_id (lr_list_intents).', false);
  }
  const loaded = args.intent_id === undefined ? NO_INTENT : ctx.deps.intents.get(args.intent_id); // IntentError -> INTENT_NOT_FOUND
  const settings = resolveSessionSettings(args, loaded.intent.guardrail_overrides ?? {}, page.values);
  const { client, map } = ctx.deps;

  const photo = await client.request("get_context", {});
  if (photo["file_format"] === "VIDEO") throw new ToolError("VIDEO_NOT_SUPPORTED", "The selected item is a video; select a photo.", false);
  const missing = originalMissing(photo); // before the snapshot: nothing is written
  if (missing) throw missing;
  refuseLeftOpen(folderOf(ctx.deps.logDir), null, photo.uuid); // SESSION_LEFT_OPEN, before the snapshot (left-open.ts)
  const variantCount = mode === "variants" ? checkVariants(ctx, loaded, photo, settings.variantCount) : null;
  const view = map.fromSdk((await client.request("get_settings", { target_uuid: photo.uuid })).settings); // LEGACY_PROCESS_VERSION
  // Before the snapshot: an unknown profile or one of the other pipeline is refused with nothing written.
  if (args.profile !== undefined) map.toSdk({ camera_profile: args.profile }, { processVersion: view.process_version, pipeline: view.pipeline });

  const now = ctx.now();
  const { id, short, files } = pickLogFiles(ctx, now);
  ctx.deps.logFolders?.remember(path.dirname(files.logPath)); // found again after the page's folder changes
  const snapshotName = `AVG pre-session ${now.toISOString()}`;
  const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: snapshotName }, { timeoutMs: WRITE_TIMEOUT_MS }); // its write gate waits up to 60 s (Gate.lua)
  const master = newTarget({
    id: "master",
    label: null,
    uuid: photo.uuid,
    local_id: photo.local_id,
    filename: text(photo["filename"]),
    copy_name: text(photo["copy_name"]),
    process_version: view.process_version,
    pipeline: view.pipeline,
    camera_profile: view.camera_profile.name,
  });
  const s: Session = {
    id,
    short,
    startedAt: now,
    intent: loaded,
    profile: args.profile ?? null,
    // The request first, then the intent [stated: Jim, 2026-10-11, issue #130, "Intent or request"].
    clipBaseline: args.clip_baseline ?? loaded.intent.clip_baseline ?? false,
    mode,
    maxPasses: settings.maxPasses,
    limits: { clipHighPct: settings.clipHighPct, clipLowPct: settings.clipLowPct },
    decay: settings.decay,
    longEdge: settings.longEdge,
    quality: settings.quality,
    master,
    variants: [],
    picked: null,
    ready: mode === "converge",
    active: master,
    snapshot: { name: snapshotName, id: snap.snapshot_id },
    startSettings: view.settings,
    startMasks: view.masks.fingerprint,
    aiRoute: null,
    aiPending: null,
    aiTrace: null,
    endedByEngine: null,
    regions: [],
    files,
    log: {} as SessionLogData,
    exif: { iso: photo["iso"], shutter: photo["shutter"], aperture: photo["aperture"], lens: photo["lens"] },
    work: null,
    idleNote: null,
    abort: null,
    pickedBy: null,
    pendingPick: null,
    notices: [],
    approval: null,
    approvalWait: null,
    // Who asked (issue #155 R1): logged and shown, never used for decisions.
    ...(args.client ? { client: args.client } : {}),
    ...(args.model ? { model: args.model } : {}),
  };
  s.log = newLog(ctx, s, variantCount, args.notes ?? null);
  s.log.settings = settingsEntry(settings, page);
  // A plugin that is not the engine's version (restart Lightroom), else a Lightroom outside the supported
  // and tested versions: the HUD says so once, after lr_begin_session. The update first: it can be acted on.
  s.idleNote = updateNotices(client.hello()?.plugin_version, ctx.deps.engineVersion).length > 0 ? UPDATE_HUD_NOTE : (s.log.lightroom?.notices?.[0] ?? null);
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
    const candidate = new SessionLogFiles(folderOf(ctx.deps.logDir), now, short);
    if (!existsSync(candidate.logPath) && !existsSync(candidate.recipePath)) return { id, short, files: candidate };
  }
  throw new ToolError("INTERNAL_ERROR", `No free session log name in ${folderOf(ctx.deps.logDir)} after 5 tries.`, false);
}

/** The log's record of the session's settings: the page's values used and where each came from. */
function settingsEntry(settings: SessionSettings, page: PageRead): NonNullable<SessionLogData["settings"]> {
  return {
    approval: settings.approval,
    long_edge: settings.longEdge,
    quality: settings.quality,
    from: settings.from,
    page: { read: page.read, note: page.note, problems: page.problems },
  };
}

/** The begin result's `session_settings` (its `settings` are the photo's); approve_each_pass says how it works (approval.ts). */
function settingsJson(s: Session): Record<string, unknown> {
  const recorded = s.log.settings;
  if (!recorded) return {};
  const note = recorded.approval === "approve_each_pass" ? { approval_note: APPROVAL_NOTE } : {};
  return { session_settings: { ...recorded, decay: [...s.decay], ...note } };
}

const APPROVAL_NOTE =
  "approve_each_pass: the user approves each pass they have seen. Pass 1 needs no approval; from pass 2 on, lr_step first waits " +
  `up to ${APPROVAL_WAIT_MS / 1000} s for the user's Approve of the pass before (the LrC-AVG HUD's Approve button, or lr_approve_pass ` +
  "after the user approved in chat), else returns AWAITING_APPROVAL. Show the user each pass. Variants mode: the pick approves the pass it was picked at.";

function newLog(ctx: SessionContext, s: Session, variantCount: number | null, notes: string | null): SessionLogData {
  const { intent, master } = s;
  const hello = ctx.deps.client.hello();
  return {
    schema: SESSION_LOG_SCHEMA_ID,
    session_id: s.id,
    short_id: s.short,
    engine_version: ctx.deps.engineVersion,
    ...(s.client ? { client: s.client } : {}),
    ...(s.model ? { model: s.model } : {}),
    ...(hello
      ? {
          lightroom: {
            lrc_version: hello.lrc_version,
            sdk_declared: hello.sdk_declared,
            notices: [...lightroomNotices(hello.lrc_version), ...updateNotices(hello.plugin_version, ctx.deps.engineVersion)],
          },
        }
      : {}),
    started: s.startedAt.toISOString(),
    ended: null,
    outcome: null,
    intent: { id: intent.intent.id, label: intent.intent.label, source: intent.source },
    mode: s.mode,
    variant_count: variantCount,
    max_passes: s.maxPasses,
    guardrails: { clip_high_pct: s.limits.clipHighPct, clip_low_pct: s.limits.clipLowPct },
    clip_baseline: s.clipBaseline,
    decay: [...s.decay],
    notes,
    target: {
      uuid: master.uuid,
      local_id: master.local_id,
      filename: master.filename,
      copy_name: master.copy_name,
      process_version: master.process_version,
      pipeline: master.pipeline,
      camera_profile: master.camera_profile,
    },
    snapshot: s.snapshot,
    start: { settings: s.startSettings, masks: s.startMasks },
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
    target: { ...target, white_balance_unit: WHITE_BALANCE_UNITS[target.pipeline], exif: { iso: photo["iso"] ?? null, shutter: photo["shutter"] ?? null, aperture: photo["aperture"] ?? null, focal_length: photo["focal_length"] ?? null, lens: photo["lens"] ?? null, camera: photo["camera"] ?? null } },
    intent: { id: intent.id, label: intent.label, source },
    intent_brief: {
      brief: intent.brief,
      convergence_hints: intent.convergence_hints ?? [],
      regions_expected: intent.regions_expected ?? [],
      allow_probe: intent.allow_probe ?? false,
    },
    guardrails: s.log.guardrails,
    clip_baseline: s.clipBaseline,
    max_passes: s.maxPasses,
    ...settingsJson(s),
    snapshot: s.snapshot,
    log_path: s.files.logPath,
    start_off_zero: startOffZero(s.startSettings),
  };
}

/**
 * The zero-neutral sliders: basic tone, presence, HSL, color grading saturation, luminance and balance,
 * vignette and grain amounts. Left out: white balance, profile, sharpening, noise reduction, lens,
 * curves, masks, and sliders whose neutral is not 0 (grading hues and blending, vignette midpoint …).
 */
const ZERO_NEUTRAL = /^(exposure|contrast|highlights|shadows|whites|blacks|texture|clarity|dehaze|vibrance|saturation|hsl\.\w+\.\w+|grading\.\w+\.(sat|lum)|grading\.balance|(vignette|grain)\.amount)$/;

/**
 * The begin result's `start_off_zero` (engine 0.35.0): the zero-neutral sliders that are not 0 on the photo at begin,
 * with their values. These are settings found on the photo, which may be import defaults or earlier
 * edits, never an "edited" verdict: 0 is the neutral value [inference], and a photo read before any AVG
 * edit had Exposure2012 to Blacks2012 at 0 but Texture 8 and Clarity2012 4 [handle:
 * docs\reports\phase0\S5\s5_20260110-_Z8A0138-DxO_DeepPRIME XD3.dng.json].
 */
export function startOffZero(settings: CanonicalSettings): Record<string, number> {
  const off: Record<string, number> = {};
  for (const [name, value] of Object.entries(settings)) if (ZERO_NEUTRAL.test(name) && typeof value === "number" && value !== 0) off[name] = value;
  return off;
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
