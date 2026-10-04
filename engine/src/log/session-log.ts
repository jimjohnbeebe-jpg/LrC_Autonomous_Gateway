// The provenance log of a session and its recipe (ARCHITECTURE section 8, PRD section 6.12,
// MCP_TOOLS "Session log schema (v1)"; v2 adds Variants mode, PHASE4_PLAN row 7).
//
// One JSON file per session, <yyyymmdd>-<short id>.json, rewritten after every pass so that a crash
// leaves the passes so far; and, when a session is accepted, <yyyymmdd>-<short id>.recipe.json with
// the final settings under canonical names (the input lr_sync_series will take, Phase 4). Both go to
// the log folder of tool-log.ts (LRC_AVG_LOG_DIR, else %LOCALAPPDATA%\LrC-AVG\logs).
//
// The zod schemas below are the definition: engine\schemas\session-log.schema.json and
// recipe.schema.json are generated from them (`npm run schemas`), and AC-5 validates a log against
// them. Metrics are the summaries the tools return (no histograms), so a log stays small.
// Schema v2 (engine 0.4.0) adds `mode` "variants", the copies (`variants`, `picked`), each pass's
// photo (`target` A/B/C) and region baselines per photo. v1 logs (engine 0.3.x, the Phase 3 run)
// are read with session-log-v1.ts. Later engines only add: optional fields (`settings`, 0.7.0;
// `ended_by` and `hud_events`, 0.8.0; `approvals` and a pass's `approval`, 0.9.0; `lightroom`,
// 0.13.0, and its `notices`, 0.14.0; a pass's `mask`, kind "mask", 0.16.0, log\mask-log.ts; `ended_by`
// source "engine" with its `reason`, and the HUD event hud_put_back, PR C step 2b) and the outcome "aborted" (0.8.0), so earlier v2 logs still read.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { maskPassSchema } from "./mask-log.js";

export const SESSION_LOG_SCHEMA_ID = "lrc-avg/session-log/2";
export const RECIPE_SCHEMA_ID = "lrc-avg/recipe/1";

const perChannel = z.strictObject({ r: z.number(), g: z.number(), b: z.number() });
const percentiles = z.strictObject({ p1: z.number(), p5: z.number(), p50: z.number(), p95: z.number(), p99: z.number() });
const box = z.strictObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const rect = z.strictObject({ left: z.number(), top: z.number(), width: z.number(), height: z.number() });

const deltaShape = {
  luma_mean: z.number(),
  luma_std: z.number(),
  luma_percentiles: percentiles,
  dynamic_range: z.number(),
  channel_mean: perChannel,
  rb_ratio: z.number().nullable(),
  clip_high_pct: z.number(),
  clip_low_pct: z.number(),
  clip_high_pct_by_channel: perChannel,
  clip_low_pct_by_channel: perChannel,
  saturation_mean: z.number(),
  chromatic_pct: z.number(),
  hue_mean: z.number().nullable(),
};
const statsShape = { ...deltaShape, hue_histogram: z.array(z.number()).length(12) };

export const metricsSummarySchema = z.strictObject({
  ...statsShape,
  regions: z.array(z.strictObject({ label: z.string(), box, rect, pixels: z.number(), ...statsShape })),
});
export const metricsDeltaSchema = z.strictObject({
  ...deltaShape,
  regions: z.array(z.strictObject({ label: z.string(), ...deltaShape })),
});

export const canonicalValueSchema = z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]);
export const canonicalSettingsSchema = z.record(z.string(), canonicalValueSchema);

const change = z.strictObject({
  name: z.string(),
  before: canonicalValueSchema.nullable(),
  requested: canonicalValueSchema,
  after: canonicalValueSchema,
  delta: z.number().nullable(),
});
const clamp = z.strictObject({ name: z.string(), requested: z.number(), applied: z.number(), reason: z.string() });
const refusal = z.strictObject({ name: z.string(), reason: z.string(), by: z.enum(["guardrail", "slider"]) });

export const guardrailActionSchema = z.strictObject({
  kind: z.enum(["corrected", "unmet", "reverted"]),
  limit: z.enum(["clip_high", "clip_low", "region"]),
  reason: z.string(),
  history_name: z.string().nullable(),
  changes: z.record(z.string(), z.number()),
  metrics_after: metricsSummarySchema.nullable(),
});

/** The photo a pass edited: the master (Converge mode) or a copy (Variants mode). */
export const targetIdSchema = z.enum(["master", "A", "B", "C"]);
export const variantIdSchema = z.enum(["A", "B", "C"]);
/** Who approved a pass: the HUD (or a menu item), Claude on the user's word in chat, or the user's pick (engine 0.9.0). */
const approvalBySchema = z.enum(["hud", "menu", "claude", "pick"]);

export const passSchema = z.strictObject({
  /** The pass number of its photo: each copy counts its own passes (MCP_TOOLS lr_select_variant). */
  n: z.number().int().min(0),
  kind: z.enum(["pass0", "step", "mask"]),
  target: targetIdSchema,
  started: z.string(),
  duration_ms: z.number(),
  history_names: z.array(z.string()),
  rationale: z.string(),
  requested: z.record(z.string(), z.unknown()),
  changes: z.array(change),
  clamped: z.array(clamp),
  refused: z.array(refusal),
  unchanged: z.array(z.string()),
  settings_before: canonicalSettingsSchema,
  settings_after: canonicalSettingsSchema,
  metrics_before: metricsSummarySchema.nullable(),
  metrics_after: metricsSummarySchema,
  delta_metrics: metricsDeltaSchema.nullable(),
  preview_hash: z.string(),
  preview_source: z.literal("export"),
  guardrail_actions: z.array(guardrailActionSchema),
  converged_by_metrics: z.boolean(),
  /** Engine 0.9.0, approve_each_pass (PHASE5_PLAN row 6): the approval this step went ahead on, and how long it waited. */
  approval: z.strictObject({ pass: z.number().int(), by: approvalBySchema, waited_ms: z.number() }).optional(),
  /** Engine 0.16.0: a mask pass's change (kind "mask"; its `changes` are empty, its settings unchanged). */
  mask: maskPassSchema.optional(),
});

export const probeSchema = z.strictObject({
  /** The photo probed (Greptile, PR #34: several copies can be probed). */
  target: targetIdSchema,
  started: z.string(),
  duration_ms: z.number(),
  magnitude: z.number(),
  history_names: z.array(z.string()),
  results: z.array(
    z.strictObject({
      name: z.string(),
      delta_applied: z.number(),
      delta_metrics: metricsDeltaSchema,
      per_unit: z.strictObject({ luma_mean: z.number(), clip_high_pct: z.number(), clip_low_pct: z.number() }),
    }),
  ),
});

export const regionBaselineSchema = z.strictObject({ hue_mean: z.number().nullable(), saturation_mean: z.number() });
export const regionEntrySchema = z.strictObject({
  kind: z.enum(["skin", "fur", "sky", "custom"]),
  label: z.string(),
  box,
  preserve: z.boolean(),
  /** A preserved region's values when it was set, per photo it was measured on. */
  baselines: z.partialRecord(targetIdSchema, regionBaselineSchema),
});

export const variantEntrySchema = z.strictObject({
  id: variantIdSchema,
  label: z.string(),
  uuid: z.string(),
  local_id: z.number(),
  copy_name: z.string(),
  picked: z.boolean(),
});

const settingFrom = z.enum(["argument", "intent", "page", "default"]);
/**
 * Engine 0.7.0 (PHASE5_PLAN row 3): what lr_begin_session took from the settings page. `from` names
 * each value's source; `page` says whether get_prefs answered, why not, and which page values were
 * left out. Optional, so the logs of engines 0.4.0-0.6.1 still read as v2.
 */
const sessionSettingsSchema = z.strictObject({
  approval: z.enum(["autonomous", "approve_each_pass"]),
  long_edge: z.number().int(),
  quality: z.number().int(),
  from: z.strictObject({
    approval: settingFrom,
    max_passes: settingFrom,
    variant_count: settingFrom,
    long_edge: settingFrom,
    quality: settingFrom,
    clip_high_pct: settingFrom,
    clip_low_pct: settingFrom,
    decay: settingFrom,
  }),
  page: z.strictObject({ read: z.boolean(), note: z.string().nullable(), problems: z.array(z.string()) }),
});

const userSource = z.enum(["hud", "menu"]);
/**
 * Engine 0.8.0 (PHASE5_PLAN row 5): who ended the session. Claude (lr_end_session), or the user from
 * the HUD or a menu item, with the event's click id, when the engine received it, the operation an
 * Abort stopped, and `done_ms` from the event to the end (for an Abort: the photo back; AC-2).
 * Engine 0.16.0, PR C step 2b: the engine itself, which put the photo back after a Lightroom dialog
 * (session\ai-masks.ts autoRevert), with its `reason`.
 */
const endedBySchema = z.strictObject({
  source: z.enum(["claude", "hud", "menu", "engine"]),
  reason: z.string().optional(),
  click_id: z.string().optional(),
  received: z.string().optional(),
  interrupted: z.string().nullable().optional(),
  done_ms: z.number().optional(),
});
/** Engine 0.8.0: every HUD or menu event for this session, and what the HUD was told. */
const hudEventSchema = z.strictObject({
  at: z.string(),
  name: z.enum(["hud_abort", "hud_accept", "hud_pick", "hud_approve_pass", "hud_put_back"]),
  source: userSource,
  click_id: z.string(),
  seq_seen: z.number().int(),
  variant: variantIdSchema.optional(),
  pass: z.number().int().optional(),
  note: z.string(),
});

export const sessionLogSchema = z
  .strictObject({
    schema: z.literal(SESSION_LOG_SCHEMA_ID),
    session_id: z.string(),
    short_id: z.string(),
    engine_version: z.string(),
    /**
     * Engine 0.13.0: the Lightroom the session ran in, from the plugin's hello (issue #67). Engine
     * 0.14.0 adds `notices`, what the user was told about that version (bridge\lightroom.ts), empty
     * within the supported and tested versions.
     */
    lightroom: z.strictObject({ lrc_version: z.string(), sdk_declared: z.number(), notices: z.array(z.string()).optional() }).optional(),
    started: z.string(),
    ended: z.string().nullable(),
    /** "aborted" (engine 0.8.0, MCP_TOOLS' log schema): the user's Abort put the photo back. */
    outcome: z.enum(["accept", "revert", "aborted"]).nullable(),
    intent: z.strictObject({ id: z.string(), label: z.string(), source: z.enum(["bundled", "user"]) }),
    mode: z.enum(["converge", "variants"]),
    /** Variants mode: the copies asked for; null in Converge mode. */
    variant_count: z.number().int().nullable(),
    max_passes: z.number().int(),
    guardrails: z.strictObject({ clip_high_pct: z.number(), clip_low_pct: z.number() }),
    decay: z.array(z.number()),
    notes: z.string().nullable(),
    target: z.strictObject({
      uuid: z.string(),
      local_id: z.number(),
      filename: z.string().nullable(),
      copy_name: z.string().nullable(),
      process_version: z.string(),
      camera_profile: z.string().nullable(),
    }),
    snapshot: z.strictObject({ name: z.string(), id: z.string() }),
    /** Variants mode: the copies made, A first. */
    variants: z.array(variantEntrySchema),
    picked: variantIdSchema.nullable(),
    regions: z.array(regionEntrySchema),
    passes: z.array(passSchema),
    probes: z.array(probeSchema),
    failures: z.array(z.strictObject({ at: z.string(), stage: z.string(), error: z.looseObject({ code: z.string(), message: z.string(), recoverable: z.boolean() }) })),
    final_settings: canonicalSettingsSchema.nullable(),
    recipe_path: z.string().nullable(),
    revert: z.strictObject({ ms: z.number(), differing: z.array(z.string()) }).nullable(),
    /** Engine 0.7.0: the values the session read from the settings page, and where each came from. */
    settings: sessionSettingsSchema.optional(),
    ended_by: endedBySchema.optional(),
    hud_events: z.array(hudEventSchema).optional(),
    /** Engine 0.9.0: every approval of a pass (approve_each_pass mode), in order. */
    approvals: z.array(z.strictObject({ at: z.string(), target: targetIdSchema, pass: z.number().int(), by: approvalBySchema })).optional(),
  })
  .describe("LrC-AVG session log, schema v2");

export const recipeSchema = z
  .strictObject({
    schema: z.literal(RECIPE_SCHEMA_ID),
    session_id: z.string(),
    created: z.string(),
    intent_id: z.string(),
    source: z.strictObject({ uuid: z.string(), filename: z.string().nullable() }),
    process_version: z.string(),
    settings: canonicalSettingsSchema,
    /** Engine 0.16.0: how many masks the photo kept; the recipe carries none of them (lr_sync_series says so). */
    masks: z.number().int().optional(),
  })
  .describe("LrC-AVG recipe: a session's final settings under canonical names, schema v1");

export type SessionLogData = z.infer<typeof sessionLogSchema>;
export type PassEntry = z.infer<typeof passSchema>;
export type ProbeEntry = z.infer<typeof probeSchema>;
export type GuardrailAction = z.infer<typeof guardrailActionSchema>;
export type VariantEntry = z.infer<typeof variantEntrySchema>;
export type EndedByEntry = z.infer<typeof endedBySchema>;
export type HudEventEntry = z.infer<typeof hudEventSchema>;
export type Recipe = z.infer<typeof recipeSchema>;

/** Local date as yyyymmdd, the prefix of a session's files. */
export function dayStamp(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Write JSON through a temporary file and a rename, so a reader never sees half a file [inference, as in intents\loader.ts]. */
function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  renameSync(temporary, file);
}

export class SessionLogFiles {
  readonly logPath: string;
  readonly recipePath: string;

  constructor(dir: string, started: Date, shortId: string) {
    const base = `${dayStamp(started)}-${shortId}`;
    this.logPath = path.join(dir, `${base}.json`);
    this.recipePath = path.join(dir, `${base}.recipe.json`);
  }

  writeLog(log: SessionLogData): void {
    writeJson(this.logPath, log);
  }

  writeRecipe(recipe: Recipe): void {
    writeJson(this.recipePath, recipe);
  }
}
