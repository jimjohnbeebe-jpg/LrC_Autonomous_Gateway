// The session module's types: the tool arguments and outputs, the dependencies, and the state of
// the open session (manager.ts has the overview).

import type { BridgeClient } from "../bridge/index.js";
import type { IntentLibrary, LoadedIntent } from "../intents/index.js";
import type { SessionLogData, SessionLogFiles } from "../log/index.js";
import type { Metrics, Region, RegionBox } from "../metrics/index.js";
import type { CanonicalSettings, ParamMap } from "../params/index.js";
import type { RenderedPreview } from "../preview/index.js";
import type { Limits, Slope } from "./plan.js";

export type SessionOutput = { json: Record<string, unknown>; image?: Buffer; log?: Record<string, unknown> };
export type RenderRequest = { longEdge: number; quality: number; targetUuid: string; regions: readonly Region[] };
export type ReturnImage = "after" | "before_after" | "none";
export type RegionKind = "skin" | "fur" | "sky" | "custom";

export type BeginArgs = {
  intent_id: string;
  mode?: "converge" | undefined;
  max_passes?: number | undefined;
  guardrails?: { clip_high_pct?: number | undefined; clip_low_pct?: number | undefined } | undefined;
  notes?: string | undefined;
  long_edge?: number | undefined;
  return_image?: ReturnImage | undefined;
};
export type StepArgs = {
  session_id: string;
  target?: "master" | undefined;
  settings: Record<string, unknown>;
  rationale: string;
  return_image?: ReturnImage | undefined;
};
export type ProbeArgs = { session_id: string; sliders: string[]; magnitude?: number | undefined };
export type RegionArgs = {
  session_id: string;
  regions: Array<{ kind: RegionKind; label: string; box: RegionBox; preserve?: boolean | undefined }>;
};
export type EndArgs = { session_id: string; outcome: "accept" | "revert" };

export type SessionDeps = {
  client: BridgeClient;
  map: ParamMap;
  intents: IntentLibrary;
  render: (request: RenderRequest) => Promise<RenderedPreview>;
  logDir: string;
  engineVersion: string;
  now?: () => Date;
  newId?: () => string;
};

/** What every session operation works with: the dependencies, with the clock and id source resolved. */
export type SessionContext = { deps: SessionDeps; now: () => Date; newId: () => string };

/** A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md "Numbers"]; 30 s leaves room. */
export const WRITE_TIMEOUT_MS = 30000;
/** At most this many regions per session [inference: each one is measured on every render]. */
export const MAX_REGIONS = 8;

export type RegionState = { kind: RegionKind; label: string; box: RegionBox; preserve: boolean; baseline: { hue_mean: number | null; saturation_mean: number } | null };
/** A render of the session's photo, with the settings it shows (to tell when the photo changed outside the session). */
export type Rendered = {
  metrics: Metrics;
  jpeg: Buffer;
  hash: string;
  width: number;
  height: number;
  timings: RenderedPreview["timings"];
  settings: CanonicalSettings;
  /** The long edge the render was asked for (a session preview may use another than the session's). */
  longEdge: number;
  preview: RenderedPreview;
};

export type Session = {
  id: string;
  short: string;
  startedAt: Date;
  intent: LoadedIntent;
  maxPasses: number;
  limits: Limits;
  decay: readonly number[];
  longEdge: number;
  quality: number;
  target: { uuid: string; local_id: number; filename: string | null; copy_name: string | null; process_version: string; camera_profile: string | null };
  snapshot: { name: string; id: string };
  startSettings: CanonicalSettings;
  passes: number;
  endReason: "converged" | "cap_reached" | null;
  last: Rendered | null;
  regions: RegionState[];
  slopes: Map<string, Slope>;
  files: SessionLogFiles;
  log: SessionLogData;
};
