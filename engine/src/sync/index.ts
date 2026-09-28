// Entry point of the sync module: lr_sync_series (PRD 6.10; sync.ts has the overview).

export { LUMA_TOLERANCE, MAX_RENDERS, solveExposure } from "./exposure.js";
export type { Point, Solved } from "./exposure.js";
export { MASK_GROUPS, applyMask, groupOf } from "./mask.js";
export type { MaskGroup } from "./mask.js";
export { resolveSource } from "./source.js";
export type { ResolvedSource, SyncSource } from "./source.js";
export { syncSeries } from "./sync.js";
export type { Skip, SyncTargets } from "./targets.js";
export { MAX_ADAPTIVE_TARGETS, MAX_TARGETS, SHEET_TARGETS, SYNC_PLUGIN } from "./types.js";
export type { SyncArgs, SyncDeps, SyncOutput, TargetResult } from "./types.js";
