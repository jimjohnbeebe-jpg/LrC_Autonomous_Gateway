// The Phase 4 check's fixed values, its dependencies and the helpers its modules share
// (phase4-check.ts runs the check; plan approved by Jim 2026-09-28 [stated: "Go"], PHASE4_PLAN row 10).

import { BridgeError, type BridgeClient, type PhotoExpect } from "../bridge/index.js";
import { toToolError, type BridgeGate, type Tools } from "../mcp/index.js";
import { differingSettings, type CanonicalSettings, type FromSdkResult, type ParamMap } from "../params/index.js";
import type { PreviewService } from "../preview/index.js";
import type { Answer } from "./phase1-check.js";
import { describeError } from "./phase1-check.js";
import type { ChatLogs } from "./phase2-check.js";
import type { Json } from "./phase3-config.js";

export type { Answer, Json };

/**
 * The photo every part of the check works on, the chat included [stated: Jim, 2026-09-28, plan
 * decision 1]. Phase 3's AC-4 failed on it [handle: docs\reports\phase3\PHASE3.md "AC-4, what
 * happened"], so Phase 4's check verifies the AC-4 fix there (PHASES.md Phase 4, "Inputs from Phase 3").
 */
export const PHOTO = "20260907-_OZ80099.NEF";
/** Plugin 0.4.0 writes to photos by uuid without selecting them (PHASE4_PLAN row 8), which the sync needs. */
export const MIN_PLUGIN_VERSION = "0.4.0";
/** The check's own copies, made in one create_virtual_copies command (2-4 names, each "AVG …": Catalog.lua). */
export const SYNC_COPIES = ["AVG P4check sync 1", "AVG P4check sync 2", "AVG P4check sync 3"] as const;
export const REPLAY_COPY = "AVG P4check replay";
/** PHASE4_PLAN decision 5: each burst copy starts at its own exposure; absolute values, as in tests\sync-adaptive.test.ts:24. */
export const START_EXPOSURES = [-1, 0.5, 1] as const;
export const START_HISTORY_NAME = "AVG P4check exposure start";
/** PHASES.md Phase 4: "matches mean luma within ±2/255". */
export const LUMA_TOLERANCE = 2;
/** Session A's and the Variants session's intent: AC-1's, whose variants A-C differ in contrast, dehaze, blacks, clarity [handle: engine\intents\landscape_golden_hour.json]. */
export const INTENT = "landscape_golden_hour";
/** Variants mode: one refined pass per copy (PRD 6.6 step 4), then one on the pick. Small changes, far from any limit [inference]. */
export const VARIANT_STEP = { settings: { clarity: 5 }, rationale: "scripted refined pass on each copy" } as const;
export const PICK_STEP = { settings: { vibrance: 5 }, rationale: "scripted pass on the pick" } as const;
/** The unselected-original write: vibrance moved by this much, then undone with the sync's snapshot. */
export const ORIGINAL_NUDGE = 5;
/**
 * The preset's photo gets a custom white balance first, so the preset carries Temperature/Tint
 * (row 9 left "Temperature/Tint with a Custom white balance" [unverified]), and a Nikon profile
 * (phase4-preset.ts prepareSource).
 */
export const WB_SHIFT = 300;
export const PREPARE_HISTORY_NAME = "AVG P4check preset source";
/** Jim's two reference presets (row 9), on row 10's cleanup list [stated: Jim, 2026-09-28, plan decision 4]. */
export const REFERENCE_PRESETS = ["AVG preset reference", "AVG preset reference 2"] as const;
/**
 * The chat (Part 2): Variants in Claude Desktop with the pick in chat (PHASE4_PLAN decision 3). It
 * asks for a refined pass on each copy before the pick (PRD 6.6 step 4, the way to `awaiting_pick`)
 * and a pass after it, which AC-3's "continues convergence on it" needs (phase4-chat.ts chatSessionOk).
 */
export const CHAT_PROMPT = "Make three variants of the active photo for a golden hour landscape, give each one a refined pass, let me pick one, then refine the one I pick.";
/** create_virtual_copies of four: the plugin's 10 s lock wait plus 4 x 5 s, as session\copies.ts sizes it [inference]. */
export const COPIES_TIMEOUT_MS = 30000;
export const WRITE_TIMEOUT_MS = 30000;
/** The plugin listened 8-22 s after Lightroom started in Phase 4 [handle: vault LrC_AVG_STATE.md, the row 6 and row 8 probes]; 180 s leaves time to quit and start it. */
export const RESTART_TIMEOUT_MS = 180000;

export type Phase4Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  tools: Tools;
  previews: PreviewService;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and return the line typed (trimmed), or null if input ended. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  collectChat: (since: Date) => ChatLogs;
  /** Lightroom's preset folder (presets\folder.ts defaultPresetDir). */
  presetDir: string;
  /** The run's time stamp; it names the check's preset. */
  stamp: string;
  connectTimeoutMs?: number;
  restartTimeoutMs?: number;
  /** How long the check's own create_virtual_copies may take (COPIES_TIMEOUT_MS; tests shorten it). */
  copiesTimeoutMs?: number;
  now?: () => Date;
};

/** A virtual copy the check has to have removed at the end, and who made it. */
export type CopyRecord = { uuid: string; copy_name: string; made_by: "check" | "variants" | "chat" };
/** The photo, as it was before the check. */
export type Photo = { uuid: string; local_id: number; process_version: string; start: CanonicalSettings };

/** The run's record: the results file, its errors, and what the cleanup must remove. */
export type Run = {
  results: Json;
  errors: string[];
  fail: (message: string) => void;
  copies: CopyRecord[];
  /**
   * Names of copies that may exist although the check knows no uuid for them: a copy command that
   * got no answer, or a copy that came back without a uuid (Greptile, PR #37). The cleanup asks Jim
   * to remove them too, and says it cannot confirm them.
   */
  unconfirmedCopies: string[];
  /** Session A's pre-session snapshot of the photo, once the session accepted: it puts the photo back. */
  masterSnapshot: { id: string; name: string } | null;
  /** The check's own preset, once written. */
  preset: { name: string; path: string } | null;
};

export const MASTER: PhotoExpect = { is_virtual_copy: false };
export const copyOf = (photo: Photo, copyName: string): PhotoExpect => ({ is_virtual_copy: true, master_local_id: photo.local_id, copy_name: copyName });

/** A photo's settings by uuid, the selection untouched (plugin 0.4.0). */
export async function settingsOf(deps: Pick<Phase4Deps, "client" | "map">, uuid: string): Promise<FromSdkResult> {
  return deps.map.fromSdk((await deps.client.request("get_settings", { photo_uuid: uuid })).settings);
}

/** Select a photo in Lightroom, checked against `expect` (Photos.lua find). */
export async function select(deps: Pick<Phase4Deps, "client">, uuid: string, expect: PhotoExpect): Promise<void> {
  await deps.client.request("select_photo", { uuid, expect });
}

/** The names in `names` whose values differ between `a` and `b` (within the read-back tolerance). */
export function differingIn(names: readonly string[], a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): string[] {
  const pick = (s: Readonly<Record<string, unknown>>) => Object.fromEntries(names.map((n) => [n, s[n]]));
  return differingSettings(pick(a), pick(b));
}

/** A step's error for the results and the window. */
export const failLine = (what: string, err: unknown): string => `${what}: ${describeError(err)}`;

/**
 * A command that got no answer (timeout, lost bridge) may still have been carried out by Lightroom;
 * one refused before it was sent (`not_connected`) was not [handle: engine\src\sync\target.ts
 * UNANSWERED and neverSent(), the same rule for the sync's writes].
 */
export function mayHaveLanded(err: unknown): boolean {
  if (err instanceof BridgeError && err.code === "not_connected") return false;
  const code = toToolError(err).code;
  return code === "BRIDGE_TIMEOUT" || code === "BRIDGE_DISCONNECTED";
}

/** Record names of copies that may exist without a known uuid, once each. */
export function addUnconfirmed(run: Run, names: readonly string[]): void {
  for (const n of names) if (!run.unconfirmedCopies.includes(n)) run.unconfirmedCopies.push(n);
}

/** An error for the results, with its code as Claude would see it (a plugin error's code upper-cased: mcp\errors.ts toToolError). */
export const errorBody = (err: unknown): Json => ({ ...toToolError(err).body() });

/**
 * After an error, end a session left open with revert, so the photo is put back (a Variants
 * session's copies stay) and the next session can begin (phase3-check.ts closeOpenSession: an open
 * session made every later begin fail with SESSION_ALREADY_ACTIVE).
 */
export async function closeOpenSession(deps: Pick<Phase4Deps, "tools" | "say">, out: Json): Promise<void> {
  const open = deps.tools.sessionManager()?.current();
  if (!open) return;
  try {
    const end = await deps.tools.endSession({ session_id: open.id, outcome: "revert" });
    out["closed_after_error"] = { session_id: open.id, revert: end.json["revert"] };
    deps.say("  The open session was ended with revert.");
  } catch (err) {
    out["closed_after_error"] = { session_id: open.id, error: errorBody(err) };
    deps.say(`  The open session could not be ended: ${describeError(err)}. Tell Claude Code.`);
  }
}

export const ms = (since: number): number => Math.round(performance.now() - since);
