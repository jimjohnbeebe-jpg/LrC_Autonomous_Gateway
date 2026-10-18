// Entry point of the session module (ARCHITECTURE section 4).

export { SessionManager } from "./manager.js";
export type { SessionView } from "./view.js";
export { COPIES_TIMEOUT_MS, MAX_REGIONS, VARIANT_IDS, folderOf } from "./types.js";
export { APPROVAL_WAIT_MS, pendingApproval } from "./approval.js";
export type { UserAction, UserEnded } from "./hud-actions.js";
export type { ShowRecord } from "./show-copy.js";
export type {
  ApprovalBy,
  ApproveArgs,
  BeginArgs,
  CreateMaskArgs,
  DeleteMaskArgs,
  EditMaskArgs,
  ListMasksArgs,
  EndArgs,
  HudNotice,
  HudSink,
  ProbeArgs,
  RegionArgs,
  RegionKind,
  RenderRequest,
  ReturnImage,
  SelectArgs,
  SessionDeps,
  Session,
  SessionOutput,
  StepArgs,
  Target,
  TargetId,
  UserSource,
  VariantId,
} from "./types.js";
export { KNOWN_CLIENTS, UNNAMED, cleanText, displayModel, displayName, sentenceName } from "./client.js";
export { awaitingPick } from "./pick.js";
export { MASKS_PLUGIN } from "./masks.js";
export { AI_PART_PLUGIN } from "./mask-parts.js";
export { DIALOG_NOTE, WORKING_NOTE } from "./ai-update.js";
export { AI_TIMINGS } from "./ai-timings.js";
export { abandonedNote } from "./abandon.js";
export { LEFT_OPEN_NOTE, leftOpenJson } from "./left-open.js";
export type { LeftOpen } from "./left-open.js";
export { STUCK_NOTE, engineEndedNote } from "./ai-revert.js";
export { ABORT_AI, ACCEPT_AFTER_FAILED } from "./hud-actions.js";
export { endedAlike, endedError } from "./hud-notes.js";
export type { AiTimings } from "./ai-timings.js";
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
  isCircularHue,
  minStep,
  roundForSlider,
} from "./rules.js";
