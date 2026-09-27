// The provenance log of a session and its recipe (ARCHITECTURE section 8, PRD section 6.12,
// MCP_TOOLS "Session log schema (v1)").
//
// One JSON file per session, <yyyymmdd>-<short id>.json, rewritten after every pass so that a crash
// leaves the passes so far; and, when a session is accepted, <yyyymmdd>-<short id>.recipe.json with
// the final settings under canonical names (the input lr_sync_series will take, Phase 4). Both go to
// the log folder of tool-log.ts (LRC_AVG_LOG_DIR, else %LOCALAPPDATA%\LrC-AVG\logs).
//
// The zod schemas below are the definition: engine\schemas\session-log.schema.json and
// recipe.schema.json are generated from them (`npm run schemas`), and AC-5 validates a log against
// them. Metrics are the summaries the tools return (no histograms), so a log stays small.

import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SESSION_LOG_SCHEMA_ID = "lrc-avg/session-log/1";
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

export const passSchema = z.strictObject({
  n: z.number().int().min(0),
  kind: z.enum(["pass0", "step"]),
  target: z.literal("master"),
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
});

export const probeSchema = z.strictObject({
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

export const regionEntrySchema = z.strictObject({
  kind: z.enum(["skin", "fur", "sky", "custom"]),
  label: z.string(),
  box,
  preserve: z.boolean(),
  baseline: z.strictObject({ hue_mean: z.number().nullable(), saturation_mean: z.number() }).nullable(),
});

export const sessionLogSchema = z
  .strictObject({
    schema: z.literal(SESSION_LOG_SCHEMA_ID),
    session_id: z.string(),
    short_id: z.string(),
    engine_version: z.string(),
    started: z.string(),
    ended: z.string().nullable(),
    outcome: z.enum(["accept", "revert"]).nullable(),
    intent: z.strictObject({ id: z.string(), label: z.string(), source: z.enum(["bundled", "user"]) }),
    mode: z.literal("converge"),
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
    regions: z.array(regionEntrySchema),
    passes: z.array(passSchema),
    probes: z.array(probeSchema),
    failures: z.array(z.strictObject({ at: z.string(), stage: z.string(), error: z.looseObject({ code: z.string(), message: z.string(), recoverable: z.boolean() }) })),
    final_settings: canonicalSettingsSchema.nullable(),
    recipe_path: z.string().nullable(),
    revert: z.strictObject({ ms: z.number(), differing: z.array(z.string()) }).nullable(),
  })
  .describe("LrC-AVG session log, schema v1");

export const recipeSchema = z
  .strictObject({
    schema: z.literal(RECIPE_SCHEMA_ID),
    session_id: z.string(),
    created: z.string(),
    intent_id: z.string(),
    source: z.strictObject({ uuid: z.string(), filename: z.string().nullable() }),
    process_version: z.string(),
    settings: canonicalSettingsSchema,
  })
  .describe("LrC-AVG recipe: a session's final settings under canonical names, schema v1");

export type SessionLogData = z.infer<typeof sessionLogSchema>;
export type PassEntry = z.infer<typeof passSchema>;
export type ProbeEntry = z.infer<typeof probeSchema>;
export type GuardrailAction = z.infer<typeof guardrailActionSchema>;
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
