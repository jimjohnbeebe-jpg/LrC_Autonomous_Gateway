// The metrics' constants and types (split out of compute.ts, Phase 10 row 7; compute.ts has the definitions).

import type { PixelRect, RegionBox } from "./regions.js";

export const CLIP_HIGH = 253;
export const CLIP_LOW = 2;
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
  clip_high_tone_pct: number;
  clip_low_pct: number;
  clip_high_pct_by_channel: PerChannel;
  clip_low_pct_by_channel: PerChannel;
  saturation_mean: number;
  chromatic_pct: number;
  hue_mean: number | null;
  hue_histogram: number[];
  sharpness: number | null;
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

/** Round to `digits` decimals. */
export const round = (value: number, digits = 4): number => {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
};
