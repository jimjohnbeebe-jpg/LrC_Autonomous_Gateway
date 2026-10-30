// The per-pixel pass and the statistics of compute.ts's Stats (split out of compute.ts, Phase 10 row 7);
// the definitions are in compute.ts's header.

import type { PixelRect } from "./regions.js";
import { LUMA_WEIGHTS } from "./sharpness.js";
import { CHROMATIC_MIN, CLIP_HIGH, CLIP_LOW, HUE_BIN_DEGREES, HUE_BINS, round, type PerChannel, type Percentiles, type Stats } from "./types.js";

type Accumulator = {
  pixels: number;
  luma: Float64Array;
  r: Float64Array;
  g: Float64Array;
  b: Float64Array;
  hue: Float64Array;
  lumaSum: number;
  lumaSquares: number;
  sum: PerChannel;
  high: number;
  highTone: number;
  low: number;
  highBy: PerChannel;
  lowBy: PerChannel;
  saturationSum: number;
  chromatic: number;
};

export function accumulate(data: Uint8Array, width: number, channels: number, rect: PixelRect): Accumulator {
  const acc: Accumulator = {
    pixels: rect.width * rect.height,
    luma: new Float64Array(256),
    r: new Float64Array(256),
    g: new Float64Array(256),
    b: new Float64Array(256),
    hue: new Float64Array(360),
    lumaSum: 0,
    lumaSquares: 0,
    sum: { r: 0, g: 0, b: 0 },
    high: 0,
    highTone: 0,
    low: 0,
    highBy: { r: 0, g: 0, b: 0 },
    lowBy: { r: 0, g: 0, b: 0 },
    saturationSum: 0,
    chromatic: 0,
  };
  const minSat = CHROMATIC_MIN.saturation;
  const minMax = CHROMATIC_MIN.value * 255;
  for (let row = rect.top; row < rect.top + rect.height; row++) {
    const start = (row * width + rect.left) * channels;
    const end = start + rect.width * channels;
    for (let i = start; i < end; i += channels) {
      const r = data[i] as number;
      const g = data[i + 1] as number;
      const b = data[i + 2] as number;
      const y = LUMA_WEIGHTS.r * r + LUMA_WEIGHTS.g * g + LUMA_WEIGHTS.b * b;
      acc.lumaSum += y;
      acc.lumaSquares += y * y;
      acc.luma[Math.min(255, Math.round(y))]! += 1;
      acc.r[r]! += 1;
      acc.g[g]! += 1;
      acc.b[b]! += 1;
      acc.sum.r += r;
      acc.sum.g += g;
      acc.sum.b += b;
      if (r >= CLIP_HIGH) acc.highBy.r++;
      if (g >= CLIP_HIGH) acc.highBy.g++;
      if (b >= CLIP_HIGH) acc.highBy.b++;
      if (r <= CLIP_LOW) acc.lowBy.r++;
      if (g <= CLIP_LOW) acc.lowBy.g++;
      if (b <= CLIP_LOW) acc.lowBy.b++;
      const clipped = (r >= CLIP_HIGH ? 1 : 0) + (g >= CLIP_HIGH ? 1 : 0) + (b >= CLIP_HIGH ? 1 : 0);
      if (clipped > 0) acc.high++;
      if (clipped >= 2) acc.highTone++;
      if (r <= CLIP_LOW && g <= CLIP_LOW && b <= CLIP_LOW) acc.low++;

      const max = r > g ? (r > b ? r : b) : g > b ? g : b;
      const min = r < g ? (r < b ? r : b) : g < b ? g : b;
      if (max === 0) continue; // black: saturation 0, no hue
      const d = max - min;
      const saturation = d / max;
      acc.saturationSum += saturation;
      if (saturation < minSat || max < minMax) continue;
      let h: number;
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      acc.hue[Math.min(359, Math.floor(h * 60))]! += 1;
      acc.chromatic++;
    }
  }
  return acc;
}

/** Nearest rank: the lowest bin with at least p % of `total` at or below it. */
export function percentile(histogram: Float64Array, total: number, p: number): number {
  const target = Math.max(1, Math.ceil((p / 100) * total));
  let cumulative = 0;
  for (let i = 0; i < histogram.length; i++) {
    cumulative += histogram[i] as number;
    if (cumulative >= target) return i;
  }
  return histogram.length - 1;
}

function hueStats(hue: Float64Array, chromatic: number): { mean: number | null; histogram: number[] } {
  const histogram = new Array<number>(HUE_BINS).fill(0);
  if (chromatic === 0) return { mean: null, histogram };
  let x = 0;
  let y = 0;
  for (let degree = 0; degree < 360; degree++) {
    const count = hue[degree] as number;
    if (count === 0) continue;
    // Bin i is centred on i * 30 degrees, so it covers [i * 30 - 15, i * 30 + 15).
    histogram[Math.floor(((degree + HUE_BIN_DEGREES / 2) % 360) / HUE_BIN_DEGREES)]! += count;
    const angle = ((degree + 0.5) * Math.PI) / 180;
    x += count * Math.cos(angle);
    y += count * Math.sin(angle);
  }
  // Hues spread evenly round the circle have no mean direction.
  const resultant = Math.hypot(x, y) / chromatic;
  // The second % 360: rounding can turn 359.997 into 360, which must read as 0 (Greptile, PR #21).
  const mean = resultant < 1e-9 ? null : round((((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360, 2) % 360;
  return { mean, histogram: histogram.map((count) => round((count / chromatic) * 100)) };
}

export function finish(acc: Accumulator): Omit<Stats, "sharpness"> {
  const n = acc.pixels;
  const pct = (count: number): number => round((count / n) * 100);
  const mean = acc.lumaSum / n;
  const variance = Math.max(0, acc.lumaSquares / n - mean * mean);
  const percentiles: Percentiles = {
    p1: percentile(acc.luma, n, 1),
    p5: percentile(acc.luma, n, 5),
    p50: percentile(acc.luma, n, 50),
    p95: percentile(acc.luma, n, 95),
    p99: percentile(acc.luma, n, 99),
  };
  const channelMean = { r: acc.sum.r / n, g: acc.sum.g / n, b: acc.sum.b / n };
  const hue = hueStats(acc.hue, acc.chromatic);
  return {
    luma_mean: round(mean, 3),
    luma_std: round(Math.sqrt(variance), 3),
    luma_percentiles: percentiles,
    dynamic_range: round((percentiles.p99 - percentiles.p1) / 255),
    channel_mean: { r: round(channelMean.r, 3), g: round(channelMean.g, 3), b: round(channelMean.b, 3) },
    rb_ratio: channelMean.b === 0 ? null : round(channelMean.r / channelMean.b),
    clip_high_pct: pct(acc.high),
    clip_high_tone_pct: pct(acc.highTone),
    clip_low_pct: pct(acc.low),
    clip_high_pct_by_channel: { r: pct(acc.highBy.r), g: pct(acc.highBy.g), b: pct(acc.highBy.b) },
    clip_low_pct_by_channel: { r: pct(acc.lowBy.r), g: pct(acc.lowBy.g), b: pct(acc.lowBy.b) },
    saturation_mean: round((acc.saturationSum / n) * 100, 3),
    chromatic_pct: pct(acc.chromatic),
    hue_mean: hue.mean,
    hue_histogram: hue.histogram,
  };
}
