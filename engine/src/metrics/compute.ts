// Metrics of a rendered preview: the full set of PRD section 6.7 (Phase 3; Phase 2 had the luma
// histogram and clipping only).
//
// Everything is measured on the preview as it is sent to Claude: 8-bit sRGB pixels as Lightroom
// exported them, not the raw file's headroom (ARCHITECTURE section 6; the preview is the export's
// JPEG, preview\service.ts). Definitions:
//   luma              Rec. 709 weights on the 8-bit sRGB values [inference: the choice of weights is
//                     ours; PRD 6.7 names luma without a formula]; its histogram bins the rounded value
//   luma_percentiles  p1, p5, p50, p95, p99 by nearest rank on the 256-bin luma histogram: the lowest
//                     level with at least p % of the pixels at or below it
//   luma_std          population standard deviation of the unrounded luma
//   dynamic_range     (p99 - p1) / 255, 0-1 (PRD 6.7 "dynamic-range utilisation")
//   channel_mean      mean of each channel, 0-255
//   rb_ratio          channel_mean.r / channel_mean.b, the white-balance proxy of PRD 6.7; null when
//                     the blue mean is 0
//   clip_high_pct     pixels with any channel >= 253 (PRD 6.7)
//   clip_low_pct      pixels with all channels <= 2 (PRD 6.7)
//   *_by_channel      the same thresholds per channel, each channel on its own
//   saturation_mean   mean HSV saturation, (max - min) / max, over every pixel, 0-100
//   chromatic_pct     pixels with HSV saturation >= 0.1 and value >= 0.1, the pixels whose hue means
//                     something [inference: the thresholds are ours]
//   hue_histogram     12 bins of 30 degrees over the chromatic pixels, percent of them; bin i is centred
//                     on i * 30 degrees (0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta)
//   hue_mean          circular mean hue of the chromatic pixels, degrees 0-360; null when there are none
// Percentages are 0-100. Hue is counted in 1-degree bins (each taken at its centre) before the
// 12-bin histogram and the circular mean are formed from them [inference: each hue moves by less
// than 0.5 degree to its bin centre, so their circular mean moves by less than 0.5 degree too].
// Regions (lr_set_regions) get the same set, measured inside their box.

import sharp from "sharp";
import { boxToRect, type PixelRect, type Region, type RegionBox } from "./regions.js";

export const CLIP_HIGH = 253;
export const CLIP_LOW = 2;
export const LUMA_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;
/** HSV saturation and value (0-1) a pixel needs for its hue to count. */
export const CHROMATIC_MIN = { saturation: 0.1, value: 0.1 } as const;
export const HUE_BINS = 12;
export const HUE_BIN_DEGREES = 360 / HUE_BINS;

export type PerChannel = { r: number; g: number; b: number };
export type Percentiles = { p1: number; p5: number; p50: number; p95: number; p99: number };

/** The measured set, for the whole image or for one region. */
export type Stats = {
  luma_mean: number;
  luma_std: number;
  luma_percentiles: Percentiles;
  dynamic_range: number;
  channel_mean: PerChannel;
  rb_ratio: number | null;
  clip_high_pct: number;
  clip_low_pct: number;
  clip_high_pct_by_channel: PerChannel;
  clip_low_pct_by_channel: PerChannel;
  saturation_mean: number;
  chromatic_pct: number;
  hue_mean: number | null;
  hue_histogram: number[];
};

export type RegionStats = { label: string; box: RegionBox; rect: PixelRect; pixels: number } & Stats;

export type Metrics = {
  width: number;
  height: number;
  pixels: number;
  /** 256 bins each, pixel counts; luma bin i holds the pixels whose rounded luma is i. */
  histograms: { luma: number[]; r: number[]; g: number[]; b: number[] };
  regions: RegionStats[];
} & Stats;

/** Everything but the histograms and the size: what a tool result shows each pass. */
export type MetricsSummary = Omit<Metrics, "width" | "height" | "pixels" | "histograms">;

/** after - before for every scalar of Stats; null where either side is null. */
export type StatsDelta = Omit<Stats, "hue_histogram">;
export type MetricsDelta = StatsDelta & { regions: Array<{ label: string } & StatsDelta> };

const round = (value: number, digits = 4): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

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
  low: number;
  highBy: PerChannel;
  lowBy: PerChannel;
  saturationSum: number;
  chromatic: number;
};

function accumulate(data: Uint8Array, width: number, channels: number, rect: PixelRect): Accumulator {
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
      if (r >= CLIP_HIGH || g >= CLIP_HIGH || b >= CLIP_HIGH) acc.high++;
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
function percentile(histogram: Float64Array, total: number, p: number): number {
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

function finish(acc: Accumulator): Stats {
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
    clip_low_pct: pct(acc.low),
    clip_high_pct_by_channel: { r: pct(acc.highBy.r), g: pct(acc.highBy.g), b: pct(acc.highBy.b) },
    clip_low_pct_by_channel: { r: pct(acc.lowBy.r), g: pct(acc.lowBy.g), b: pct(acc.lowBy.b) },
    saturation_mean: round((acc.saturationSum / n) * 100, 3),
    chromatic_pct: pct(acc.chromatic),
    hue_mean: hue.mean,
    hue_histogram: hue.histogram,
  };
}

/**
 * Metrics of interleaved 8-bit pixels, and of each region's box. `channels` is 3 (RGB) or 4 (RGBA;
 * alpha is ignored). Pure function, so the tests can feed exact pixel values.
 */
export function computeMetrics(data: Uint8Array, width: number, height: number, channels: number, regions: readonly Region[] = []): Metrics {
  if (channels !== 3 && channels !== 4) throw new Error(`expected 3 or 4 channels, got ${channels}`);
  const pixels = width * height;
  if (pixels <= 0 || data.length !== pixels * channels) {
    throw new Error(`pixel buffer is ${data.length} bytes; ${width}x${height}x${channels} needs ${pixels * channels}`);
  }
  const whole = accumulate(data, width, channels, { left: 0, top: 0, width, height });
  const regionStats = regions.map((region): RegionStats => {
    const rect = boxToRect(region.box, width, height);
    return { label: region.label, box: { ...region.box }, rect, pixels: rect.width * rect.height, ...finish(accumulate(data, width, channels, rect)) };
  });
  return {
    width,
    height,
    pixels,
    histograms: { luma: Array.from(whole.luma), r: Array.from(whole.r), g: Array.from(whole.g), b: Array.from(whole.b) },
    ...finish(whole),
    regions: regionStats,
  };
}

/**
 * Decode an image (the preview JPEG) and measure it. sharp honours an embedded ICC profile when it
 * decodes. For an sRGB profile that changes no pixel value: on the Lightroom-exported S3 fixture
 * JPEG (3,144-byte profile), 0 of 8,386,560 bytes differed with and without `ignoreIcc` [handle:
 * Claude Code, 2026-09-26, sharp 0.35.4, `sharp(f).raw()` vs `sharp(f, {ignoreIcc: true}).raw()` on
 * fixtures\20260907-_OZ80093.jpg; the fixture is not in git, so tests\metrics.test.ts repeats the
 * comparison on a generated image].
 */
export async function measureImage(input: Buffer, regions: readonly Region[] = []): Promise<Metrics> {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return computeMetrics(data, info.width, info.height, info.channels, regions);
}

export function summarize(metrics: Metrics): MetricsSummary {
  const { width: _w, height: _h, pixels: _p, histograms: _hist, ...summary } = metrics;
  return summary;
}

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
    clip_low_pct: d(after.clip_low_pct, before.clip_low_pct),
    clip_high_pct_by_channel: dc(after.clip_high_pct_by_channel, before.clip_high_pct_by_channel),
    clip_low_pct_by_channel: dc(after.clip_low_pct_by_channel, before.clip_low_pct_by_channel),
    saturation_mean: d(after.saturation_mean, before.saturation_mean, 3),
    chromatic_pct: d(after.chromatic_pct, before.chromatic_pct),
    hue_mean: after.hue_mean === null || before.hue_mean === null ? null : round(hueTurn(before.hue_mean, after.hue_mean), 2),
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
