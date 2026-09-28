// The sync module's types and limits (sync.ts has the overview).

import type { BridgeClient } from "../bridge/index.js";
import type { CanonicalSettings, ParamMap } from "../params/index.js";
import type { PreviewRequest, RenderedPreview } from "../preview/index.js";
import type { MaskGroup } from "./mask.js";
import type { SyncSource } from "./source.js";
import type { SyncTargets } from "./targets.js";

/** get_selection and `photo_uuid` come with plugin 0.4.0 [handle: engine\src\bridge\protocol.ts COMMANDS, Target]. */
export const SYNC_PLUGIN = "0.4.0";
/**
 * Targets per call [stated: Jim, 2026-09-27, "go with recommendations" on the row 8 plan, decision 5].
 * With adaptive exposure a target takes up to 4 renders, so 3 targets and the source are up to 13
 * renders, ~45 s at the Phase 2 pass time [inference: from docs\reports\phase2\PHASE2.md:239-240];
 * Claude Desktop's tool-call timeout is [unverified]. Without it a target is ~4 bridge commands.
 */
export const MAX_TARGETS = 20;
export const MAX_ADAPTIVE_TARGETS = 3;
/** Contact-sheet panels: the source and up to three targets (preview\composite.ts takes 2-4). */
export const SHEET_TARGETS = 3;

export type SyncDeps = {
  client: BridgeClient;
  map: ParamMap;
  /** Export and measure a photo (preview\service.ts); sync names it with photoUuid. */
  render: (request: PreviewRequest) => Promise<RenderedPreview>;
  /** Where session recipes are (log\session-log.ts). */
  logDir: string;
  newId?: () => string;
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
  /** The settings written to every target (the mask applied; without exposure when adaptive). */
  copied: CanonicalSettings;
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
  snapshot: { name: string; id: string };
  history_names: string[];
  /** Canonical names whose value the sync changed. */
  changed: string[];
  exposure: { start: number; final: number; offset: number | null } | null;
  luma: { goal: number; start: number; final: number; renders: number; met: boolean; tries: Array<{ exposure: number; luma: number }> } | null;
  render: RenderedPreview | null;
};
