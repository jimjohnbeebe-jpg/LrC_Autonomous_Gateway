// after - before of two measurements (split out of compute.ts, Phase 10 row 7).

import { round, type Metrics, type MetricsDelta, type MetricsSummary, type PerChannel, type Stats, type StatsDelta } from "./types.js";

/** The signed shortest turn from `before` to `after`, in degrees, -180 < d <= 180. */
function hueTurn(before: number, after: number): number {
  let d = (after - before) % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d;
}

function deltaStats(before: Stats, after: Stats): StatsDelta {
  const d = (a: number, b: number, digits = 4): number => round(a - b, digits);
  const dc = (a: PerChannel, b: PerChannel, digits = 4): PerChannel => ({ r: d(a.r, b.r, digits), g: d(a.g, b.g, digits), b: d(a.b, b.b, digits) });
  const bp = before.luma_percentiles;
  const ap = after.luma_percentiles;
  return {
    luma_mean: d(after.luma_mean, before.luma_mean, 3),
    luma_std: d(after.luma_std, before.luma_std, 3),
    luma_percentiles: { p1: ap.p1 - bp.p1, p5: ap.p5 - bp.p5, p50: ap.p50 - bp.p50, p95: ap.p95 - bp.p95, p99: ap.p99 - bp.p99 },
    dynamic_range: d(after.dynamic_range, before.dynamic_range),
    channel_mean: dc(after.channel_mean, before.channel_mean, 3),
    rb_ratio: after.rb_ratio === null || before.rb_ratio === null ? null : d(after.rb_ratio, before.rb_ratio),
    clip_high_pct: d(after.clip_high_pct, before.clip_high_pct),
    clip_high_tone_pct: d(after.clip_high_tone_pct, before.clip_high_tone_pct),
    clip_low_pct: d(after.clip_low_pct, before.clip_low_pct),
    clip_high_pct_by_channel: dc(after.clip_high_pct_by_channel, before.clip_high_pct_by_channel),
    clip_low_pct_by_channel: dc(after.clip_low_pct_by_channel, before.clip_low_pct_by_channel),
    saturation_mean: d(after.saturation_mean, before.saturation_mean, 3),
    chromatic_pct: d(after.chromatic_pct, before.chromatic_pct),
    hue_mean: after.hue_mean === null || before.hue_mean === null ? null : round(hueTurn(before.hue_mean, after.hue_mean), 2),
    sharpness: after.sharpness === null || before.sharpness === null ? null : d(after.sharpness, before.sharpness, 3),
  };
}

/**
 * after - before for every scalar (hue_mean as the shortest turn, -180 to 180 degrees). Regions are
 * matched by label; a region measured on one side only is left out.
 */
export function deltaMetrics(before: Metrics | MetricsSummary, after: Metrics | MetricsSummary): MetricsDelta {
  const earlier = new Map(before.regions.map((region) => [region.label, region]));
  const regions: MetricsDelta["regions"] = [];
  for (const region of after.regions) {
    const match = earlier.get(region.label);
    if (match) regions.push({ label: region.label, ...deltaStats(match, region) });
  }
  return { ...deltaStats(before, after), regions };
}
