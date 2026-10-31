// Metrics of a rendered preview: the full set of PRD section 6.7 (Phase 3; Phase 2 had the luma
// histogram and clipping only).
//
// Everything is measured on the preview as it is sent to Claude: 8-bit sRGB pixels as Lightroom
// exported them, not the raw file's headroom (ARCHITECTURE section 6; the preview is the export's
// JPEG, preview\service.ts). A session with measure_long_edge (issue #168) is measured on its larger
// export instead, so its pixel counts are at that size. Definitions:
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
//   clip_high_tone_pct pixels with two or more channels >= 253: blown tone, which the highlight
//                     guard acts on; one channel alone is saturated colour, not blown highlights
//                     [stated: Jim, 2026-10-24, issue #186, "2+ channels >= 253"]
//   clip_low_pct      pixels with all channels <= 2 (PRD 6.7)
//   *_by_channel      the same thresholds per channel, each channel on its own
//   saturation_mean   mean HSV saturation, (max - min) / max, over every pixel, 0-100
//   chromatic_pct     pixels with HSV saturation >= 0.1 and value >= 0.1, the pixels whose hue means
//                     something [inference: the thresholds are ours]
//   hue_histogram     12 bins of 30 degrees over the chromatic pixels, percent of them; bin i is centred
//                     on i * 30 degrees (0 red, 60 yellow, 120 green, 180 cyan, 240 blue, 300 magenta)
//   hue_mean          circular mean hue of the chromatic pixels, degrees 0-360; null when there are none
//   sharpness         Laplacian variance of the luma at a 512 px long edge (sharpness.ts, issue #216); null
//                     for a region too small to measure
// Percentages are 0-100. Hue is counted in 1-degree bins (each taken at its centre) before the
// 12-bin histogram and the circular mean are formed from them [inference: each hue moves by less
// than 0.5 degree to its bin centre, so their circular mean moves by less than 0.5 degree too].
// Regions (lr_set_regions) get the same set, measured inside their box.

import sharp from "sharp";
import { measurePerceptual } from "./perceptual.js";
import { boxToRect, type Region } from "./regions.js";
import { laplacianVariance, resampleLuma } from "./sharpness.js";
import { accumulate, finish } from "./stats.js";
import type { Metrics, MetricsSummary, RegionStats } from "./types.js";

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
  const grid = resampleLuma(data, width, height, channels);
  const regionStats = regions.map((region): RegionStats => {
    const rect = boxToRect(region.box, width, height);
    const stats = finish(accumulate(data, width, channels, rect));
    return { label: region.label, box: { ...region.box }, rect, pixels: rect.width * rect.height, ...stats, sharpness: laplacianVariance(grid, rect) };
  });
  return {
    width,
    height,
    pixels,
    histograms: { luma: Array.from(whole.luma), r: Array.from(whole.r), g: Array.from(whole.g), b: Array.from(whole.b) },
    ...finish(whole),
    sharpness: laplacianVariance(grid),
    regions: regionStats,
    perceptual: measurePerceptual(data, channels, whole.hue, whole.chromatic),
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

