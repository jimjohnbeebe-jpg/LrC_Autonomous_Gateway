// Entry point of the metrics module (sharp; ARCHITECTURE section 6).

export { computeMetrics, measureImage, summarize } from "./compute.js";
export { deltaMetrics } from "./delta.js";
export { CHROMATIC_MIN, CLIP_HIGH, CLIP_LOW, HUE_BIN_DEGREES, HUE_BINS } from "./types.js";
export type { Metrics, MetricsDelta, MetricsSummary, PerChannel, Percentiles, RegionStats, Stats, StatsDelta } from "./types.js";
export { sampleColor } from "./pixel.js";
export { LUMA_WEIGHTS, SHARPNESS_LONG_EDGE } from "./sharpness.js";
export { boxProblem, boxToRect } from "./regions.js";
export type { PixelRect, Region, RegionBox } from "./regions.js";
