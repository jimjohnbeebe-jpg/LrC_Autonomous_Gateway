// The intent file (v3 = v2 + set and references; v2): MCP_TOOLS "Intent JSON schema", PRD section 6.9, ARCHITECTURE section 7;
// v2 names each pipeline's profile and white balance (PHASE8_PLAN row 4, decision D5 A [stated: Jim,
// 2026-10-08, "Go with recommendations"]; I1 A v2 only, I2 A profile optional but naming both, I3 B no
// rendered white-balance priors in the bundled intents [stated: Jim, 2026-10-09, "Go"]).
//
// This zod schema is the validator the engine uses. engine\schemas\intent.schema.json is generated
// from it (`npm run schemas`), and a test fails when the two differ, so the published JSON Schema
// cannot drift from what the engine accepts [handle: tests\intents.test.ts "checks in
// engine\schemas\*.schema.json exactly as generated"]. Objects are strict: an unknown field, such as
// a misspelt "prior", is an error rather than silently ignored [handle: tests\intents.test.ts "skips
// invalid files", shape.json].
//
// Beyond the shape, the loader checks every prior against the params map (names, types, ranges, per
// pipeline) and each profile against the pinned profiles of its pipeline (loader.ts).

import { z } from "zod";
import { AI_KINDS, type AiKind, type Pipeline } from "../params/index.js";

/** File-name safe: the file is <id>.json. */
export const INTENT_ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
/** The region kinds of lr_set_regions (MCP_TOOLS). */
export const REGION_KINDS = ["skin", "fur", "sky", "custom"] as const;
/** The version lr_save_intent writes; v3 is v2 plus `set` and `set_by_pipeline` (PHASE10_PLAN "Second re-plan", row 5), `references` (row 8), `tone_mode` and `masks` (rows 9+10), `checks` (row 12). */
export const INTENT_SCHEMA_VERSION = 3;
/** The versions the loader reads: v2 files keep loading. */
export const SUPPORTED_INTENT_SCHEMA_VERSIONS: readonly number[] = [2, 3];

// Strings pass the shape check so that the loader can say what is wrong (e.g. camera_profile belongs
// in profile); no prior takes a string value.
const priors = z
  .record(z.string().min(1), z.union([z.number(), z.boolean(), z.array(z.number()), z.string()]))
  .describe(
    "canonical parameter name -> value, applied at pass 0: a number is added to the photo's current value; " +
      "a switch, boolean or curve is set as given",
  );

const priorsByPipeline = z
  .strictObject({ raw: priors.optional(), rendered: priors.optional() })
  .describe(
    "priors for one pipeline only, added to `priors` on a photo of that pipeline; temperature and tint go here, " +
      "in Kelvin on raw and in relative units (-100..100) on rendered",
  );

// A look's absolute values (schema v3): written at pass 0 as given, numbers clamped to the range, so the
// look reproduces on a photo whatever that photo's settings were [stated: Jim, 2026-10-26: 0b's look,
// which left the tonal settings out, came out too dark and too flat].
const set = z
  .record(z.string().min(1), z.union([z.number(), z.boolean(), z.array(z.number()), z.string()]))
  .describe("canonical parameter name -> value, written at pass 0 as given (absolute; schema v3)");

const setByPipeline = z
  .strictObject({ raw: set.optional(), rendered: set.optional() })
  .describe("absolute values for one pipeline only (schema v3); temperature and tint go here, Kelvin on raw, relative -100..100 on rendered");

const variant = z.strictObject({
  label: z.string().min(1).max(40),
  priors,
  priors_by_pipeline: priorsByPipeline.optional(),
});

const percent = z.number().min(0).max(100);

/**
 * How pass 0 treats a look's tones (PHASE10_PLAN "Third re-plan", R3 [stated: Jim, 2026-10-29, "Go with recommendations"]):
 * "set" writes them as given (the default, as before); "adapt" writes them too, and the brief calls them a start to adapt toward
 * the references for this photo (T3); "auto" runs Lightroom's Auto Tone first and skips the look's tonal values (T2).
 */
export const TONE_MODES = ["set", "auto", "adapt"] as const;
export type ToneMode = (typeof TONE_MODES)[number];
/** The sliders Lightroom's Auto Tone owns in tone_mode "auto": pass 0 skips a look's values (set and priors) for them. */
export const AUTO_TONE_PARAMS: readonly string[] = ["exposure", "contrast", "highlights", "shadows", "whites", "blacks"];
/** A look's tonal and presence values, which tone_mode "adapt" calls starting points. */
export const TONAL_PARAMS: readonly string[] = [...AUTO_TONE_PARAMS, "texture", "clarity", "dehaze"];

/** The AI mask kinds a look may carry: those that need no point on the photo (params\mask-ai-kinds.ts `point`). */
export const LOOK_MASK_KINDS = (Object.keys(AI_KINDS) as AiKind[]).filter((k) => !AI_KINDS[k].point) as [AiKind, ...AiKind[]];
export const MAX_LOOK_MASKS = 6;
const lookMask = z.strictObject({
  kind: z.enum(LOOK_MASK_KINDS).describe("an AI kind Lightroom finds with no point: subject, sky, background, landscape_*, people_* (every person)"),
  name: z.string().min(1).max(60).describe('the name the Masks panel shows, e.g. "1. Sky - Deepen"'),
  purpose: z.string().min(1).max(300).describe("what the mask is for, in a sentence or two"),
  sliders: z.record(z.string().min(1), z.number()).describe("local slider -> starting value in the Masking panel's units (lr_create_mask's sliders: local.exposure, local.clarity, ...)"),
});

/**
 * The measures a look's checks may name: metrics\reference-gap.ts GAP_MEASURES, the reference gap's (intents may not
 * import metrics; tests\look-checks.test.ts keeps the two lists equal). A check is reported each pass, never enforced
 * (PHASE10_PLAN "Third re-plan", R5).
 */
export const CHECK_MEASURES = ["L.p5", "L.p50", "L.p95", "rms", "cf", "sh.C", "sh.wheel", "mid.C", "mid.wheel", "hi.C", "hi.wheel", "dark", "light"] as const;
export const MAX_LOOK_CHECKS = 8;
const lookCheck = z
  .strictObject({
    measure: z.enum(CHECK_MEASURES).describe("L.p5/L.p50/L.p95 L* percentiles, rms contrast, cf colourfulness, sh/mid/hi cast chroma C or wheel hue, dark (zones 0-II %), light (zones VIII-X %)"),
    min: z.number().optional(),
    max: z.number().optional(),
    why: z.string().min(1).max(200).describe("the method's reason for the range, in a sentence"),
  })
  .refine((c) => c.min !== undefined || c.max !== undefined, "give min, max or both")
  .describe("a range the look's method expects; a wheel hue range runs counter-clockwise from min to max");

/** The fields of `references` (schema v3, Phase 10 row 8; session\references.ts); lr_begin_session takes them in a loose object, where an empty one is ignored. */
export const referencesShape = {
  uuids: z.array(z.string().min(1)).min(1).max(8).optional().describe("1-8 catalog photo uuids"),
  collection: z.string().min(1).max(200).optional().describe('a catalog collection by name, or "Set / Name"; its first 8 photos are used'),
};
/** Reference photos in an intent: at least one of the fields. */
export const referencesSchema = z
  .strictObject(referencesShape)
  .refine((r) => r.uuids !== undefined || r.collection !== undefined, "give uuids, a collection, or both")
  .describe("photos the session measures at begin; every pass then reports where the photo lies against their range (reported only, never a target)");

export const intentSchema = z
  .strictObject({
    schema_version: z.union([z.literal(2), z.literal(3)]).describe("3 (2 still loads, without set, references, tone_mode, masks and checks)"),
    id: z.string().regex(INTENT_ID_PATTERN).describe("lower case letters, digits and _; the file is <id>.json"),
    label: z.string().min(1).max(80),
    category: z.string().min(1).max(40),
    brief: z.string().min(1).max(2000).describe("prose instructions to the AI"),
    profile: z
      .strictObject({ raw: z.string().min(1), rendered: z.string().min(1) })
      .optional()
      .describe('the profile pass 0 sets, per pipeline: raw such as "Adobe Landscape" or "Camera Standard", rendered "Color" or "Monochrome"; leave out to keep the photo\'s'),
    priors: priors.describe("priors for both pipelines (not temperature or tint: see priors_by_pipeline)"),
    priors_by_pipeline: priorsByPipeline.optional(),
    set: set.optional(),
    set_by_pipeline: setByPipeline.optional(),
    variants: z
      .strictObject({ A: variant, B: variant, C: variant })
      .optional()
      .describe("three named prior sets for Variants mode (Phase 4)"),
    guardrail_overrides: z
      .strictObject({ clip_high_pct: percent.optional(), clip_low_pct: percent.optional() })
      .optional()
      .describe("replaces the default clipping limits (0.5 % high, 1.0 % low; AVG-009) for this intent"),
    clip_baseline: z
      .boolean()
      .optional()
      .describe("true: pass 0 pulls clipping under the limits, and a pass corrects an end over before it (default false: only what the pass caused; issue #130)"),
    regions_expected: z.array(z.enum(REGION_KINDS)).optional(),
    convergence_hints: z.array(z.string().min(1).max(300)).optional(),
    allow_probe: z.boolean().optional().describe("lr_probe is off in autonomous mode unless this is true"),
    references: referencesSchema.optional(),
    tone_mode: z.enum(TONE_MODES).optional().describe('v3: "set" (default) writes the tonal values as given; "adapt" writes them as a start to adapt toward the references; "auto" runs Lightroom Auto Tone first and skips them'),
    masks: z
      .array(lookMask)
      .max(MAX_LOOK_MASKS)
      .optional()
      .describe(`v3: up to ${MAX_LOOK_MASKS} AI masks with no geometry; the session returns them in its brief, and the AI creates and adjusts them for each photo`),
    checks: z
      .array(lookCheck)
      .max(MAX_LOOK_CHECKS)
      .optional()
      .describe(`v3: up to ${MAX_LOOK_CHECKS} measured ranges of the look's method (a classic method's, for example); every pass reports each as met or not in look_checks, and nothing is refused for them`),
  })
  .describe("LrC-AVG intent, schema v3 (v2 still loads)");

export type Intent = z.infer<typeof intentSchema>;
/** The intent itself or one of its variants: shared priors and per-pipeline ones. */
export type PriorSet = Pick<Intent, "priors" | "priors_by_pipeline">;

/** A prior set's priors on one pipeline: the shared ones and that pipeline's (the loader refuses a name in both). */
export function priorsFor(set: PriorSet, pipeline: Pipeline): Intent["priors"] {
  return { ...set.priors, ...set.priors_by_pipeline?.[pipeline] };
}

/** An intent's absolute values on one pipeline: `set` and that pipeline's `set_by_pipeline`. */
export function setFor(intent: Pick<Intent, "set" | "set_by_pipeline">, pipeline: Pipeline): Record<string, Intent["priors"][string]> {
  return { ...intent.set, ...intent.set_by_pipeline?.[pipeline] };
}

/** The JSON Schema of an intent file, as written to engine\schemas\intent.schema.json. */
export function intentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(intentSchema, { io: "input" }) as Record<string, unknown>;
}
