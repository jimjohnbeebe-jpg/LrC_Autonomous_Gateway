// The session module's types: the tool arguments and outputs, the dependencies, and the state of
// the open session (manager.ts has the overview).

import type { BridgeClient, HudStage } from "../bridge/index.js";
import type { IntentLibrary, LoadedIntent } from "../intents/index.js";
import type { SessionLogData, SessionLogFiles } from "../log/index.js";
import type { Metrics, Region, RegionBox } from "../metrics/index.js";
import type { CanonicalSettings, Geometry, ParamMap } from "../params/index.js";
import type { RenderedPreview } from "../preview/index.js";
import type { KnownLogFolders, PageRead } from "../settings/index.js";
import type { AiTimings } from "./ai-update.js";
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
/**
 * lr_approve_pass: `confirmed` states that the user approved in chat, as lr_save_intent's does
 * [stated: Jim, 2026-09-30, "Go with recommendations" on the PHASE5_PLAN row 6 plan, D2-A].
 */
export type ApproveArgs = { session_id: string; confirmed: boolean };
/** The mask tools (masks.ts, GitHub issue #59): each change is a pass of the session's photo [stated: Jim, 2026-10-03, "Own pass (Recommended)"]. */
export type ListMasksArgs = { session_id: string; target?: TargetId | undefined };
type MaskPassArgs = { session_id: string; target?: TargetId | undefined; rationale: string; return_image?: ReturnImage | undefined };
export type CreateMaskArgs = MaskPassArgs & {
  kind: string;
  name?: string | undefined;
  geometry?: Geometry | undefined;
  /** People kinds: a point on the person (0-1). */
  point?: { x: number; y: number } | undefined;
  sliders?: Record<string, number> | undefined;
};
export type EditMaskArgs = MaskPassArgs & {
  mask_id: string;
  name?: string | undefined;
  active?: boolean | undefined;
  inverted?: boolean | undefined;
  geometry?: Geometry | undefined;
  sliders?: Record<string, number> | undefined;
  combine?: { mode: string } | undefined;
};
export type DeleteMaskArgs = MaskPassArgs & { mask_id: string };

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
  /** How long lr_step waits for an approval (tests shorten it); approval.ts APPROVAL_WAIT_MS by default. */
  approvalWaitMs?: number;
  /** The AI mask waits (tests shorten them); ai-update.ts AI_TIMINGS by default. */
  aiTimings?: Partial<AiTimings>;
  /** The HUD (hud\publisher.ts, PHASE5_PLAN row 5); no HUD updates without it. */
  hud?: HudSink;
};

/**
 * What the session loop tells the HUD. `stage` builds the whole update from the session and returns
 * at once: it never throws and never waits for the plugin. `settle` resolves once the HUD has the
 * session's current state, or after a short wait (before the session selects a photo the HUD must
 * know first).
 */
export type HudSink = {
  stage(s: Session, stage: HudStage, options?: { note?: string; open?: boolean }): void;
  settle(s: Session): Promise<void>;
};

/** Where an end by the user came from: a HUD button or a menu item (PRD FR-1.1). */
export type UserSource = "hud" | "menu";
/** Who approved a pass (approval.ts): the HUD (or menu), Claude on the user's word in chat, or the user's pick. */
export type ApprovalBy = UserSource | "claude" | "pick";

/** An Abort or Accept from the HUD or the menu, as the session keeps it until the session ends. */
export type UserEnd = {
  source: UserSource;
  click_id: string;
  /** When the engine received the event, and performance.now() then (for the log's done_ms). */
  received: Date;
  t0: number;
  /** An Abort: pending until the photo is back; failed when the revert failed (a new click retries). */
  state: "pending" | "failed";
  /** The operation an Abort stopped, if one was running. */
  interrupted: string | null;
};

/** A HUD action Claude has not been told of yet; the next session tool result lists it (`hud_actions`). */
export type HudNotice = { action: "pick"; variant: VariantId; source: UserSource; at: string };

/** What every session operation works with: the dependencies, with the clock and id source resolved. */
export type SessionContext = { deps: SessionDeps; now: () => Date; newId: () => string };

/**
 * A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md "Numbers"].
 * The plugin's write gate waits up to 60 s for the catalog (plugin\LrC-AVG.lrplugin\Gate.lua), so the
 * engine waits 90 s: a write queued behind a Lightroom dialog gets its own answer, not a timeout
 * (that the plugin's gate waits behind a dialog is [unverified] until masks capture 4).
 */
export const WRITE_TIMEOUT_MS = 90000;
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
  /** The mask table it shows (params\mask-table.ts tableInfo fingerprint). */
  masks: string;
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
  /** The mask table before the session (its fingerprint): a revert must bring it back too. */
  startMasks: string;
  /** How AI masks were last made (ai-masks.ts): the table route, or LrDevelopController after it failed. */
  aiRoute: "table" | "dc" | null;
  /** An update_ai_settings not answered yet (ai-update.ts): while set, the session writes, exports and renders nothing (io.ts). */
  aiPending: { since: string; kind: string } | null;
  /** Why the engine itself ended the session (ai-masks.ts autoRevert, after a Lightroom dialog); the manager then closes it. */
  endedByEngine: string | null;
  regions: RegionState[];
  files: SessionLogFiles;
  log: SessionLogData;
  /** The photo's EXIF from get_context at lr_begin_session, for the HUD (a copy shares its master's file). */
  exif: { iso: unknown; shutter: unknown; aperture: unknown; lens: unknown };
  /** What the running operation works on, for the HUD's stages; null between operations. */
  work: Work | null;
  /** The note the HUD shows once the running operation is over (e.g. after a pick from the HUD). */
  idleNote: string | null;
  /** An Abort from the HUD or the menu (PHASE5_PLAN decision 3): while set, writes and exports are refused. */
  abort: UserEnd | null;
  /** Who picked the copy (Variants mode): lr_select_variant, the HUD or the menu. */
  pickedBy: "claude" | UserSource | null;
  /** A HUD Pick answered and queued but not yet made (an Accept after it counts on it). */
  pendingPick: VariantId | null;
  notices: HudNotice[];
  /** approve_each_pass (approval.ts): the last pass the user approved, of which photo, by whom. */
  approval: { target: TargetId; pass: number; by: ApprovalBy; at: string } | null;
  /** While a step waits for an approval (approval.ts): what ended the wait, and how to end it. */
  approvalWait: ApprovalWait | null;
};

/** What ends a step's wait for an approval; the strongest seen before the step resumes wins (approval.ts). */
export type ApprovalWake = "approved" | "accept" | "abort";
export type ApprovalWait = { why: ApprovalWake | "timeout" | null; wake(why: ApprovalWake): void };

/** The photo and pass an operation works on (pass null: not a pass, e.g. a probe or a preview). */
export type Work = { target: Target; pass: number | null; note?: string };

/** The folder a dependency names: itself, or what its function gives now. */
export function folderOf(dir: string | (() => string)): string {
  return typeof dir === "function" ? dir() : dir;
}

/** A new target record, with nothing rendered or stepped yet. */
export function newTarget(fields: Omit<Target, "passes" | "endReason" | "last" | "slopes">): Target {
  return { ...fields, passes: 0, endReason: null, last: null, slopes: new Map() };
}
