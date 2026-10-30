// The metrics in a session log (split out of session-log.ts, Phase 10 row 7): the summaries and deltas the
// tools return (metrics\types.ts), and the reference set a session compares with (Phase 10 row 8,
// session\references.ts). `perceptual` (metrics\perceptual.ts) and `references` came with the engine after
// 1.9.0; logs written before have neither.

import { z } from "zod";

const perChannel = z.strictObject({ r: z.number(), g: z.number(), b: z.number() });
const percentiles = z.strictObject({ p1: z.number(), p5: z.number(), p50: z.number(), p95: z.number(), p99: z.number() });
export const box = z.strictObject({ x: z.number(), y: z.number(), w: z.number(), h: z.number() });
const rect = z.strictObject({ left: z.number(), top: z.number(), width: z.number(), height: z.number() });

const deltaShape = {
  luma_mean: z.number(),
  luma_std: z.number(),
  luma_percentiles: percentiles,
  dynamic_range: z.number(),
  channel_mean: perChannel,
  rb_ratio: z.number().nullable(),
  clip_high_pct: z.number(),
  // Engine 1.1.0 (issue #186); logs written before it have none.
  clip_high_tone_pct: z.number().optional(),
  clip_low_pct: z.number(),
  clip_high_pct_by_channel: perChannel,
  clip_low_pct_by_channel: perChannel,
  saturation_mean: z.number(),
  chromatic_pct: z.number(),
  hue_mean: z.number().nullable(),
  // Issue #216 (metrics\sharpness.ts, the engine after 1.4.0); logs written before it have none.
  sharpness: z.number().nullable().optional(),
};
const statsShape = { ...deltaShape, hue_histogram: z.array(z.number()).length(12) };

const cast = z.strictObject({ a: z.number(), b: z.number(), C: z.number(), h: z.number().nullable(), wheel: z.number().nullable() }).nullable();
const band = z.number();
/** metrics\types.ts Perceptual; a delta has the same shape. */
export const perceptualSchema = z.strictObject({
  L: z.strictObject({ p2: z.number(), p5: z.number(), p20: z.number(), p50: z.number(), p80: z.number(), p95: z.number(), p98: z.number() }),
  zones: z.array(z.number()).length(11),
  cast: z.strictObject({ sh: cast, mid: cast, hi: cast }),
  bands: z.strictObject({ red: band, orange: band, yellow: band, green: band, aqua: band, blue: band, purple: band, magenta: band }),
  cf: z.number(),
  rms: z.number(),
});

export const metricsSummarySchema = z.strictObject({
  ...statsShape,
  regions: z.array(z.strictObject({ label: z.string(), box, rect, pixels: z.number(), ...statsShape })),
  perceptual: perceptualSchema.optional(),
});
export const metricsDeltaSchema = z.strictObject({
  ...deltaShape,
  regions: z.array(z.strictObject({ label: z.string(), ...deltaShape })),
  perceptual: perceptualSchema.optional(),
});

const refRange = z.strictObject({ min: z.number(), med: z.number(), max: z.number(), n: z.number().int() }).nullable();
/** The session's reference photos (session\references.ts): where they came from, each one measured, and the aggregate the passes compare with. */
export const referencesLogSchema = z.strictObject({
  source: z.enum(["begin", "intent"]),
  collection: z.string().nullable(),
  uuids: z.array(z.string()),
  measured: z.array(z.strictObject({ uuid: z.string(), filename: z.string().nullable(), perceptual: perceptualSchema })),
  warnings: z.array(z.string()),
  aggregate: z.record(z.string(), refRange),
});
