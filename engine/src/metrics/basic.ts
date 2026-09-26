// Basic metrics of a rendered preview (PHASES.md Phase 2: "basic histogram + clipping only").
// The full set (percentiles, per-channel histograms, HSV, regions) is Phase 3 (PRD section 6.7).
//
// Everything is measured on the preview as it is sent to Claude: 8-bit sRGB pixels as Lightroom
// rendered them, not the raw file's headroom (ARCHITECTURE section 6). Definitions:
//   luma           Rec. 709 weights on the 8-bit sRGB values, rounded to a 0-255 bin
//                  [inference: the choice of weights is ours; PRD 6.7 names luma without a formula]
//   clip_high_pct  pixels with any channel >= 253 (PRD 6.7)
//   clip_low_pct   pixels with all channels <= 2 (PRD 6.7)
//   *_by_channel   the same thresholds per channel, each channel on its own
// Percentages are 0-100.

import sharp from "sharp";

export const CLIP_HIGH = 253;
export const CLIP_LOW = 2;
export const LUMA_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

type PerChannel = { r: number; g: number; b: number };

export type BasicMetrics = {
  width: number;
  height: number;
  pixels: number;
  luma: {
    mean: number;
    /** 256 bins, pixel counts; bin i holds pixels whose rounded luma is i. */
    histogram: number[];
  };
  clip_high_pct: number;
  clip_low_pct: number;
  clip_high_pct_by_channel: PerChannel;
  clip_low_pct_by_channel: PerChannel;
};

/** The scalar metrics, for deltas and short summaries (the histogram left out). */
export type MetricsSummary = Omit<BasicMetrics, "luma" | "width" | "height" | "pixels"> & { luma_mean: number };

const round = (value: number, digits = 4): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};

/**
 * Metrics of interleaved 8-bit pixels. `channels` is 3 (RGB) or 4 (RGBA; alpha is ignored).
 * Pure function, so the tests can feed exact pixel values.
 */
export function computeBasicMetrics(data: Uint8Array, width: number, height: number, channels: number): BasicMetrics {
  if (channels !== 3 && channels !== 4) throw new Error(`expected 3 or 4 channels, got ${channels}`);
  const pixels = width * height;
  if (pixels <= 0 || data.length !== pixels * channels) {
    throw new Error(`pixel buffer is ${data.length} bytes; ${width}x${height}x${channels} needs ${pixels * channels}`);
  }
  const histogram = new Array<number>(256).fill(0);
  let lumaSum = 0;
  let high = 0;
  let low = 0;
  const highBy = { r: 0, g: 0, b: 0 };
  const lowBy = { r: 0, g: 0, b: 0 };
  for (let i = 0; i < data.length; i += channels) {
    const r = data[i] as number;
    const g = data[i + 1] as number;
    const b = data[i + 2] as number;
    const y = LUMA_WEIGHTS.r * r + LUMA_WEIGHTS.g * g + LUMA_WEIGHTS.b * b;
    lumaSum += y;
    histogram[Math.min(255, Math.round(y))]! += 1;
    if (r >= CLIP_HIGH) highBy.r++;
    if (g >= CLIP_HIGH) highBy.g++;
    if (b >= CLIP_HIGH) highBy.b++;
    if (r <= CLIP_LOW) lowBy.r++;
    if (g <= CLIP_LOW) lowBy.g++;
    if (b <= CLIP_LOW) lowBy.b++;
    if (r >= CLIP_HIGH || g >= CLIP_HIGH || b >= CLIP_HIGH) high++;
    if (r <= CLIP_LOW && g <= CLIP_LOW && b <= CLIP_LOW) low++;
  }
  const pct = (n: number): number => round((n / pixels) * 100);
  return {
    width,
    height,
    pixels,
    luma: { mean: round(lumaSum / pixels, 3), histogram },
    clip_high_pct: pct(high),
    clip_low_pct: pct(low),
    clip_high_pct_by_channel: { r: pct(highBy.r), g: pct(highBy.g), b: pct(highBy.b) },
    clip_low_pct_by_channel: { r: pct(lowBy.r), g: pct(lowBy.g), b: pct(lowBy.b) },
  };
}

/**
 * Decode an image (the preview JPEG) and measure it. sharp honours an embedded ICC profile when it
 * decodes. For an sRGB profile that changes no pixel value: on the Lightroom-exported S3 fixture
 * JPEG (3,144-byte profile), 0 of 8,386,560 bytes differed with and without `ignoreIcc` [handle:
 * Claude Code, 2026-09-26, sharp 0.35.4, `sharp(f).raw()` vs `sharp(f, {ignoreIcc: true}).raw()` on
 * fixtures\20260907-_OZ80093.jpg; the fixture is not in git, so tests\metrics-basic.test.ts repeats
 * the comparison on a generated image].
 */
export async function measureImage(input: Buffer): Promise<BasicMetrics> {
  const { data, info } = await sharp(input).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return computeBasicMetrics(data, info.width, info.height, info.channels);
}

export function summarize(metrics: BasicMetrics): MetricsSummary {
  return {
    luma_mean: metrics.luma.mean,
    clip_high_pct: metrics.clip_high_pct,
    clip_low_pct: metrics.clip_low_pct,
    clip_high_pct_by_channel: metrics.clip_high_pct_by_channel,
    clip_low_pct_by_channel: metrics.clip_low_pct_by_channel,
  };
}

/** after - before for every scalar of the summary. */
export function deltaMetrics(before: BasicMetrics, after: BasicMetrics): MetricsSummary {
  const d = (a: number, b: number): number => round(a - b);
  const dc = (a: PerChannel, b: PerChannel): PerChannel => ({ r: d(a.r, b.r), g: d(a.g, b.g), b: d(a.b, b.b) });
  return {
    luma_mean: round(after.luma.mean - before.luma.mean, 3),
    clip_high_pct: d(after.clip_high_pct, before.clip_high_pct),
    clip_low_pct: d(after.clip_low_pct, before.clip_low_pct),
    clip_high_pct_by_channel: dc(after.clip_high_pct_by_channel, before.clip_high_pct_by_channel),
    clip_low_pct_by_channel: dc(after.clip_low_pct_by_channel, before.clip_low_pct_by_channel),
  };
}
