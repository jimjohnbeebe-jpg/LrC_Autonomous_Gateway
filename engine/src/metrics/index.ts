// Entry point of the metrics module (sharp; ARCHITECTURE section 6).

export {
  CHROMATIC_MIN,
  CLIP_HIGH,
  CLIP_LOW,
  HUE_BIN_DEGREES,
  HUE_BINS,
  LUMA_WEIGHTS,
  computeMetrics,
  deltaMetrics,
  measureImage,
  summarize,
} from "./compute.js";
export type { Metrics, MetricsDelta, MetricsSummary, PerChannel, Percentiles, RegionStats, Stats, StatsDelta } from "./compute.js";
export { boxProblem, boxToRect } from "./regions.js";
export type { PixelRect, Region, RegionBox } from "./regions.js";
