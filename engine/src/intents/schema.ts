// The intent file (v2): MCP_TOOLS "Intent JSON schema", PRD section 6.9, ARCHITECTURE section 7;
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
import type { Pipeline } from "../params/index.js";

/** File-name safe: the file is <id>.json. */
export const INTENT_ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
/** The region kinds of lr_set_regions (MCP_TOOLS). */
export const REGION_KINDS = ["skin", "fur", "sky", "custom"] as const;
export const INTENT_SCHEMA_VERSION = 2;

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

const variant = z.strictObject({
  label: z.string().min(1).max(40),
  priors,
  priors_by_pipeline: priorsByPipeline.optional(),
});

const percent = z.number().min(0).max(100);

export const intentSchema = z
  .strictObject({
    schema_version: z.literal(INTENT_SCHEMA_VERSION),
    id: z.string().regex(INTENT_ID_PATTERN).describe("lower case letters, digits and _; the file is <id>.json"),
    label: z.string().min(1).max(80),
    category: z.string().min(1).max(40),
    brief: z.string().min(1).max(2000).describe("prose instructions to Claude"),
    profile: z
      .strictObject({ raw: z.string().min(1), rendered: z.string().min(1) })
      .optional()
      .describe('the profile pass 0 sets, per pipeline: raw such as "Adobe Landscape" or "Camera Standard", rendered "Color" or "Monochrome"; leave out to keep the photo\'s'),
    priors: priors.describe("priors for both pipelines (not temperature or tint: see priors_by_pipeline)"),
    priors_by_pipeline: priorsByPipeline.optional(),
    variants: z
      .strictObject({ A: variant, B: variant, C: variant })
      .optional()
      .describe("three named prior sets for Variants mode (Phase 4)"),
    guardrail_overrides: z
      .strictObject({ clip_high_pct: percent.optional(), clip_low_pct: percent.optional() })
      .optional()
      .describe("replaces the default clipping limits (0.5 % high, 1.0 % low; AVG-009) for this intent"),
    regions_expected: z.array(z.enum(REGION_KINDS)).optional(),
    convergence_hints: z.array(z.string().min(1).max(300)).optional(),
    allow_probe: z.boolean().optional().describe("lr_probe is off in autonomous mode unless this is true"),
  })
  .describe("LrC-AVG intent, schema v2");

export type Intent = z.infer<typeof intentSchema>;
/** The intent itself or one of its variants: shared priors and per-pipeline ones. */
export type PriorSet = Pick<Intent, "priors" | "priors_by_pipeline">;

/** A prior set's priors on one pipeline: the shared ones and that pipeline's (the loader refuses a name in both). */
export function priorsFor(set: PriorSet, pipeline: Pipeline): Intent["priors"] {
  return { ...set.priors, ...set.priors_by_pipeline?.[pipeline] };
}

/** The JSON Schema of an intent file, as written to engine\schemas\intent.schema.json. */
export function intentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(intentSchema, { io: "input" }) as Record<string, unknown>;
}
