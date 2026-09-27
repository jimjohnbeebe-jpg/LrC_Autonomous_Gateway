// Entry point of the session module (ARCHITECTURE section 4).

export { SessionManager } from "./manager.js";
export { MAX_REGIONS } from "./types.js";
export type { BeginArgs, EndArgs, ProbeArgs, RegionArgs, RegionKind, RenderRequest, ReturnImage, SessionDeps, SessionOutput, StepArgs } from "./types.js";
export { applyProjectedGuardrail, convergedByMetrics, fixedCorrection, hueDistance, planStep, pullBack } from "./plan.js";
export type { Change, Clamp, Limits, Refusal, Slope, StepPlan } from "./plan.js";
export {
  CONVERGENCE,
  CRUSHES_SHADOWS,
  HIGH_CORRECTIONS,
  LOW_CORRECTIONS,
  MAX_CORRECTIONS,
  RAISES_HIGHLIGHTS,
  REGION_PRESERVE,
  SESSION_DEFAULTS,
  baseMaxStep,
  decayFor,
  minStep,
  roundForSlider,
} from "./rules.js";
