// The sync module's types and limits (sync.ts has the overview).

import type { BridgeClient } from "../bridge/index.js";
import type { CanonicalSettings, ParamMap, Pipeline } from "../params/index.js";
import type { PreviewRequest, RenderedPreview } from "../preview/index.js";
import type { MaskGroup } from "./mask.js";
import type { SyncSource } from "./source.js";
import type { SyncTargets } from "./targets.js";
import type { NotTransferable } from "./transfer.js";

/** get_selection and `photo_uuid` come with plugin 0.4.0 [handle: engine\src\bridge\protocol.ts COMMANDS, Target]. */
export const SYNC_PLUGIN = "0.4.0";
/**
 * Targets per call, with or without adaptive exposure; the time budget (SyncDeps.budget) usually
 * ends a call sooner, and the photos not started come back as `not_yet` [stated: Jim, 2026-10-12,
 * issue #116, D3a A, "Go with recommendations"]. The figure is the most get_selection describes
 * (plugin Catalog.lua MAX_DESCRIBED) and lr_export_photos takes (library\files.ts MAX_EXPORT_PHOTOS).
 */
export const MAX_TARGETS = 500;
/** Contact-sheet panels: the source and up to three targets (preview\composite.ts takes 2-4). */
export const SHEET_TARGETS = 3;

export type SyncDeps = {
  client: BridgeClient;
  map: ParamMap;
  /** Export and measure a photo (preview\service.ts); sync names it with photoUuid. */
  render: (request: PreviewRequest) => Promise<RenderedPreview>;
  /** Where session recipes are (log\session-log.ts): the current log folder. */
  logDir: string;
  /** Earlier log folders to look in after it (settings\log-folders.ts). */
  earlierLogDirs?: readonly string[];
  newId?: () => string;
  /** How long a snapshot or a write may take (tests shorten it); target.ts WRITE_TIMEOUT_MS by default. */
  writeTimeoutMs?: number;
  /** When the call stops starting targets (tests shorten it); library\files.ts CALL_BUDGET_MS on the real clock by default. */
  budget?: { now: () => number; ms: number };
};

export type SyncArgs = {
  source: SyncSource;
  targets: SyncTargets;
  parameter_mask?: MaskGroup[] | undefined;
  adaptive_exposure: boolean;
  return_image?: "sheet" | "none" | undefined;
  long_edge: number;
  quality: number;
};

export type SyncOutput = { json: Record<string, unknown>; image?: Buffer; log?: Record<string, unknown> };

/** What every target of one call shares. */
export type SyncRun = {
  deps: SyncDeps;
  /** The first 4 hex digits of the sync's id, in its History and snapshot names. */
  short: string;
  /** The settings to write to every target (the mask applied; without exposure when adaptive); each target takes what its pipeline can (transfer.ts). */
  copied: CanonicalSettings;
  /** The source photo's pipeline, or null when unknown (source.ts). */
  sourcePipeline: Pipeline | null;
  /** Adaptive exposure: the source render's mean luma and the source's exposure; null without. */
  goal: { luma: number; exposure: number | null } | null;
  longEdge: number;
  quality: number;
};

/** One target's sync. `render` is its last render (for the contact sheet), not part of the result JSON. */
export type TargetResult = {
  uuid: string;
  filename: string | null;
  copy_name: string | null;
  /** The target's pipeline, from its own settings. */
  pipeline: Pipeline;
  snapshot: { name: string; id: string };
  history_names: string[];
  /** Canonical names whose value the sync changed. */
  changed: string[];
  /** The groups this target could not take from the source, with the reason (transfer.ts). */
  not_transferable: NotTransferable[];
  exposure: { start: number; final: number; offset: number | null } | null;
  luma: { goal: number; start: number; final: number; renders: number; met: boolean; tries: Array<{ exposure: number; luma: number }> } | null;
  render: RenderedPreview | null;
};
