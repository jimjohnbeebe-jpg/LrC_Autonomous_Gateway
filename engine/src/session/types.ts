// The session module's types: the tool arguments and outputs, the dependencies, and the state of
// the open session (manager.ts has the overview).

import type { BridgeClient } from "../bridge/index.js";
import type { IntentLibrary, LoadedIntent } from "../intents/index.js";
import type { SessionLogData, SessionLogFiles } from "../log/index.js";
import type { Metrics, Region, RegionBox } from "../metrics/index.js";
import type { CanonicalSettings, ParamMap } from "../params/index.js";
import type { RenderedPreview } from "../preview/index.js";
import type { KnownLogFolders, PageRead } from "../settings/index.js";
import type { Limits, Slope } from "./plan.js";

export type SessionOutput = { json: Record<string, unknown>; image?: Buffer; log?: Record<string, unknown> };
export type RenderRequest = { longEdge: number; quality: number; targetUuid: string; regions: readonly Region[] };
export type ReturnImage = "after" | "before_after" | "none";
export type RegionKind = "skin" | "fur" | "sky" | "custom";

/** The copies of Variants mode, in order; each takes its priors from the intent's variant of that letter. */
export const VARIANT_IDS = ["A", "B", "C"] as const;
export type VariantId = (typeof VARIANT_IDS)[number];
/** The photos a session edits: the master (Converge mode), or a copy (Variants mode). */
export type TargetId = "master" | VariantId;

export type BeginArgs = {
  intent_id: string;
  mode?: "converge" | "variants" | undefined;
  /** Variants mode: how many copies, 2-3 (A, B, C) [stated: Jim, 2026-09-27, "Go with A"]. */
  variant_count?: number | undefined;
  max_passes?: number | undefined;
  guardrails?: { clip_high_pct?: number | undefined; clip_low_pct?: number | undefined } | undefined;
  notes?: string | undefined;
  long_edge?: number | undefined;
  return_image?: ReturnImage | undefined;
};
export type StepArgs = {
  session_id: string;
  target?: TargetId | undefined;
  settings: Record<string, unknown>;
  rationale: string;
  return_image?: ReturnImage | undefined;
};
export type ProbeArgs = { session_id: string; target?: TargetId | undefined; sliders: string[]; magnitude?: number | undefined };
export type RegionArgs = {
  session_id: string;
  regions: Array<{ kind: RegionKind; label: string; box: RegionBox; preserve?: boolean | undefined }>;
};
export type SelectArgs = { session_id: string; variant: VariantId };
export type EndArgs = { session_id: string; outcome: "accept" | "revert" };

export type SessionDeps = {
  client: BridgeClient;
  map: ParamMap;
  intents: IntentLibrary;
  render: (request: RenderRequest) => Promise<RenderedPreview>;
  /** The session log folder, or a function giving it at each session start (settings\folders.ts). */
  logDir: string | (() => string);
  /**
   * Reads the settings page at lr_begin_session (settings\store.ts PageSettings.read, which also
   * moves the folders); settings\read.ts readPage on the client when absent.
   */
  readPage?: () => Promise<PageRead>;
  /** The log folders session logs were written to (settings\log-folders.ts): begin records its folder, lr_get_session_log searches them. */
  logFolders?: KnownLogFolders;
  engineVersion: string;
  now?: () => Date;
  newId?: () => string;
  /** How long create_virtual_copies may take (tests shorten it); COPIES_TIMEOUT_MS by default. */
  copiesTimeoutMs?: number;
};

/** What every session operation works with: the dependencies, with the clock and id source resolved. */
export type SessionContext = { deps: SessionDeps; now: () => Date; newId: () => string };

/** A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md "Numbers"]; 30 s leaves room. */
export const WRITE_TIMEOUT_MS = 30000;
/**
 * create_virtual_copies: the plugin waits up to 10 s for its selection lock [handle:
 * plugin\LrC-AVG.lrplugin\Catalog.lua Catalog.LOCK_WAIT_SECONDS], then makes each copy; S6's copies
 * took 212-1017 ms [handle: docs\reports\phase0\S6\s6_*.json calls[*].ms]. 10 s + 4 copies x 5 s
 * [inference: the per-copy allowance, about five times S6's slowest] (PHASE4_PLAN "For row 7, from PR #33").
 */
export const COPIES_TIMEOUT_MS = 30000;
/** At most this many regions per session [inference: each one is measured on every render]. */
export const MAX_REGIONS = 8;

/** A preserved region's hue and saturation when it was set, on one photo of the session. */
export type RegionBaseline = { hue_mean: number | null; saturation_mean: number };
/** `baselines` by photo: each photo is guarded against its own values (the copies look different). */
export type RegionState = { kind: RegionKind; label: string; box: RegionBox; preserve: boolean; baselines: Partial<Record<TargetId, RegionBaseline>> };
/** A render of a session photo, with the settings it shows (to tell when the photo changed outside the session). */
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

/** One photo the session edits, with its own pass count, last render and probe slopes. */
export type Target = {
  id: TargetId;
  /** The intent's label for the variant ("natural"); null for the master. */
  label: string | null;
  uuid: string;
  local_id: number;
  filename: string | null;
  copy_name: string | null;
  process_version: string;
  camera_profile: string | null;
  passes: number;
  endReason: "converged" | "cap_reached" | null;
  last: Rendered | null;
  slopes: Map<string, Slope>;
};

export type Session = {
  id: string;
  short: string;
  startedAt: Date;
  intent: LoadedIntent;
  mode: "converge" | "variants";
  maxPasses: number;
  limits: Limits;
  decay: readonly number[];
  longEdge: number;
  quality: number;
  /** The photo selected at lr_begin_session. Converge mode edits it; Variants mode copies it and leaves it alone. */
  master: Target;
  /** Variants mode: the copies, in the order A, B, C. */
  variants: Target[];
  picked: VariantId | null;
  /**
   * Variants mode: false until lr_begin_session made every copy and ran its pass 0; until then the
   * session only reads and reverts. Converge mode: true (a failed pass 0 still allows steps).
   */
  ready: boolean;
  /** The photo the last operation worked on (what Lightroom has selected, as far as the session knows). */
  active: Target;
  snapshot: { name: string; id: string };
  startSettings: CanonicalSettings;
  regions: RegionState[];
  files: SessionLogFiles;
  log: SessionLogData;
};

/** The folder a dependency names: itself, or what its function gives now. */
export function folderOf(dir: string | (() => string)): string {
  return typeof dir === "function" ? dir() : dir;
}

/** A new target record, with nothing rendered or stepped yet. */
export function newTarget(fields: Omit<Target, "passes" | "endReason" | "last" | "slopes">): Target {
  return { ...fields, passes: 0, endReason: null, last: null, slopes: new Map() };
}
