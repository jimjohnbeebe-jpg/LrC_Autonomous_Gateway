// The intent file (v1): MCP_TOOLS "Intent JSON schema (v1)", PRD section 6.9, ARCHITECTURE section 7.
//
// This zod schema is the validator the engine uses. engine\schemas\intent.schema.json is generated
// from it (`npm run schemas`), and a test fails when the two differ, so the published JSON Schema
// cannot drift from what the engine accepts. Objects are strict: an unknown field, such as a
// misspelt "prior", is an error rather than silently ignored.
//
// Beyond the shape, the loader checks every prior against the params map (names, types, ranges)
// and the camera profile against the pinned profile names (loader.ts).

import { z } from "zod";

/** File-name safe: the file is <id>.json. */
export const INTENT_ID_PATTERN = /^[a-z0-9][a-z0-9_]{0,63}$/;
/** The region kinds of lr_set_regions (MCP_TOOLS). */
export const REGION_KINDS = ["skin", "fur", "sky", "custom"] as const;

// Strings pass the shape check so that the loader can say what is wrong (e.g. camera_profile belongs
// in default_camera_profile); no prior takes a string value.
const priors = z
  .record(z.string().min(1), z.union([z.number(), z.boolean(), z.array(z.number()), z.string()]))
  .describe(
    "canonical parameter name -> value, applied at pass 0: a number is added to the photo's current value; " +
      "a switch, boolean or curve is set as given (camera_profile goes in default_camera_profile)",
  );

const variant = z.strictObject({
  label: z.string().min(1).max(40),
  priors,
});

const percent = z.number().min(0).max(100);

export const intentSchema = z
  .strictObject({
    id: z.string().regex(INTENT_ID_PATTERN).describe("lower case letters, digits and _; the file is <id>.json"),
    label: z.string().min(1).max(80),
    category: z.string().min(1).max(40),
    brief: z.string().min(1).max(2000).describe("prose instructions to Claude"),
    default_camera_profile: z.string().min(1).optional().describe('a profile name such as "Adobe Landscape" or "Camera Standard"'),
    priors,
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
  .describe("LrC-AVG intent, schema v1");

export type Intent = z.infer<typeof intentSchema>;

/** The JSON Schema of an intent file, as written to engine\schemas\intent.schema.json. */
export function intentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(intentSchema, { io: "input" }) as Record<string, unknown>;
}
