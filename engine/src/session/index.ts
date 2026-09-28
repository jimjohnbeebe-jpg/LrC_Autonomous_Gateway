// Entry point of the session module (ARCHITECTURE section 4).

export { SessionManager } from "./manager.js";
export type { SessionView } from "./manager.js";
export { COPIES_TIMEOUT_MS, MAX_REGIONS, VARIANT_IDS } from "./types.js";
export type {
  BeginArgs,
  EndArgs,
  ProbeArgs,
  RegionArgs,
  RegionKind,
  RenderRequest,
  ReturnImage,
  SelectArgs,
  SessionDeps,
  SessionOutput,
  StepArgs,
  TargetId,
  VariantId,
} from "./types.js";
export { DEFAULT_VARIANT_COUNT, MAX_VARIANT_COUNT, VARIANTS_PLUGIN } from "./copies.js";
export { applyProjectedGuardrail, convergedByMetrics, fixedCorrection, hueDistance, planStep, pullBack } from "./plan.js";
export type { Change, Clamp, Limits, Refusal, Slope, StepPlan } from "./plan.js";
export {
  CONVERGENCE,
  CRUSHES_SHADOWS,
  HIGH_CORRECTIONS,
  LOW_CORRECTIONS,
  MAX_BASELINE_CORRECTIONS,
  MAX_CORRECTIONS,
  RAISES_HIGHLIGHTS,
  REGION_PRESERVE,
  SESSION_DEFAULTS,
  baseMaxStep,
  decayFor,
  minStep,
  roundForSlider,
} from "./rules.js";
