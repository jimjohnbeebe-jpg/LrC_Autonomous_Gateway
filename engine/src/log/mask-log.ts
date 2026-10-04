// A mask pass in the session log (engine 0.16.0, GitHub issue #59): what changed, as summaries of
// the mask before and after (session\masks.ts; params\mask-ops.ts MaskSummary), never the raw table,
// so a log stays small. For an AI mask, `ai` says how it was made: the table route (the entry, then
// update_ai_settings) or LrDevelopController after the table route failed, and how long it took.

import { z } from "zod";

const box = z.strictObject({ top: z.number(), left: z.number(), bottom: z.number(), right: z.number() });
const summary = z.strictObject({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  active: z.boolean(),
  inverted: z.boolean(),
  components: z.number().int(),
  sliders: z.record(z.string(), z.number()),
  geometry: z.record(z.string(), z.unknown()).optional(),
  computed: z.boolean().optional(),
  /** PR C step 2c: one person's mask, its person and every person's box Lightroom found (params\mask-summary.ts). */
  instance: z.number().int().optional(),
  people: z.array(box).optional(),
});

export const maskPassSchema = z.strictObject({
  op: z.enum(["create", "edit", "delete"]),
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  before: summary.nullable(),
  after: summary.nullable(),
  ai: z
    .strictObject({
      route: z.enum(["table", "dc"]),
      /** Why the table route was left, when it was (the fallback's History steps keep Lightroom's names). */
      fallback: z.string().optional(),
      update_ms: z.number().optional(),
      computed_ms: z.number().optional(),
      dc_ms: z.number().optional(),
      /** PR C step 2b: how long Lightroom's write gate stayed held before the mask computed (session\ai-update.ts). */
      dialog_ms: z.number().optional(),
      /** PR C step 2c: one person's mask (session\person-masks.ts). */
      people: z.array(box).optional(),
      instance: z.number().int().optional(),
      /** The probe's own update and compute times, when the wanted entry was written after it. */
      probe: z.strictObject({ update_ms: z.number(), computed_ms: z.number() }).optional(),
    })
    .optional(),
});
export type MaskPassEntry = z.infer<typeof maskPassSchema>;
