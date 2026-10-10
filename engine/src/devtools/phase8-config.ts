// The Phase 8 check's fixed values, its dependencies and the helpers its modules share
// (phase8-check.ts runs the check; PHASE8_PLAN row 6, plan approved by Jim 2026-10-10 with D1-D4 as
// recommended [stated: "Go"]).

import type { BridgeClient } from "../bridge/index.js";
import type { BridgeGate, Tools } from "../mcp/index.js";
import { differingSettings, type CanonicalSettings, type ParamMap, type Pipeline } from "../params/index.js";
import type { Answer } from "./phase1-check.js";
import { describeError } from "./phase1-check.js";
import type { ChatLogs } from "./phase2-check.js";
import type { Json } from "./phase3-config.js";
import { settingsOf } from "./phase4-config.js";
import type { StateStore } from "./phase5-state.js";
import type { CheckState, Pending } from "./phase8-state.js";

export type { Answer, Json };

/** The collection spike S10 filled with one photo of every format Jim has or made (s10-fixtures.ts). */
export { COLLECTION } from "./s10-config.js";
/** Plugin 0.19.1: a missing original is refused, also when only the disk says so (PR #103). */
export const MIN_PLUGIN_VERSION = "0.19.1";
/** Part 1's intent: the plan's (PHASE8_PLAN row 6), a colour profile on both pipelines [handle: engine\intents\portrait_natural_light.json profile]. */
export const INTENT = "portrait_natural_light";
/** The JPEG of Parts 2-5: row 5's reference presets were made on it [handle: docs\reports\phase8\presets-rendered.md "Steps for Jim"]. */
export const JPEG = { filename: "DSC_0031.JPG", copy_name: "Copy 1" } as const;
/** Part 3's raw source: the raw fixture of Phases 5 and 7. */
export const RAW_SOURCE = "20260907-_OZ80093.NEF";
/** Row 5's two reference presets and its snapshot on the JPEG, which the cleanup removes (PHASE8_PLAN row 5 "For row 6"). */
export const REFERENCE_PRESETS = ["AVG preset reference rendered", "AVG preset reference rendered mono"] as const;
export const REFERENCE_SNAPSHOT = "before presets";
/** The Claude Desktop chat (Part 5). */
export const CHAT_PROMPT = "Edit the active photo as a natural light portrait.";

/**
 * Two scripted passes. Temperature moves in the photo's own unit: Kelvin on raw, -100..100 on rendered;
 * both well inside pass 2's limit (session\rules.ts baseMaxStep 1500 K and 30, times decay 0.6). Vibrance
 * and clarity move by more than their minimum step, so no pass converges by metrics (as phase5-config.ts STEPS).
 */
export function stepsFor(pipeline: Pipeline): Array<{ settings: Record<string, number>; rationale: string }> {
  return [
    { settings: { vibrance: 6, clarity: 4 }, rationale: "Phase 8 check: scripted pass" },
    { settings: { temperature: pipeline === "raw" ? 200 : 8, vibrance: -3 }, rationale: "Phase 8 check: scripted pass with white balance" },
  ];
}
/** Part 2's one pass: clarity stays in the table under a monochrome profile, unlike vibrance (S10 finding 5). */
export const INTENT_STEP = { settings: { clarity: 4 }, rationale: "Phase 8 check: scripted pass" } as const;

/**
 * Lightroom checks a write only on the photo loaded in Develop [handle: docs\reports\phase8\S10.md
 * "Observed", run 1], so each photo is selected and given this long to load before its session (as
 * s10-config.ts SELECT_SETTLE_MS) [inference: the figure].
 */
export const SELECT_SETTLE_MS = 1500;
export const WRITE_TIMEOUT_MS = 30000;
/** After a chat, Claude Desktop's engine gives the bridge back a minute after its last call (phase5-config.ts BRIDGE_WAIT_MS). */
export const BRIDGE_WAIT_MS = 150000;

export const snapshotName = (stamp: string): string => `AVG P8check before ${stamp}`;
export const presetName = (stamp: string, n: number): string => `AVG P8check ${stamp} ${n}`;
export const keptPresetName = (stamp: string): string => `AVG P8check JPEG ${stamp}`;
export const PRESET_PREFIX = "AVG P8check ";

export type Phase8Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  tools: Tools;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and return the line typed (trimmed), or null if input ended. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  /** Claude Desktop's logs from `since` on; `tag` names the saved files. */
  collectChat: (since: Date, tag: string) => ChatLogs;
  /** Lightroom's preset folder (presets\folder.ts defaultPresetDir). */
  presetDir: string;
  state: StateStore<CheckState>;
  stamp: string;
  connectTimeoutMs?: number;
  restartTimeoutMs?: number;
  bridgeWaitMs?: number;
  pollMs?: number;
  settleMs?: number;
  now?: () => Date;
};

/** The run's record, and the state it continues (saved after every photo and part). */
export type Run = { results: Json; errors: string[]; fail: (message: string) => void; state: CheckState; save: () => void };

/** A photo of the collection as the check found it. */
export type Fixture = { uuid: string; label: string; filename: string; copy_name: string | null; file_format: string | null; pipeline: Pipeline | null; process_version: string | null; available: boolean };

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Select a photo and give Develop time to load it. */
export async function selectSettled(deps: Pick<Phase8Deps, "client" | "settleMs">, uuid: string): Promise<void> {
  await deps.client.request("select_photo", { uuid });
  await sleep(deps.settleMs ?? SELECT_SETTLE_MS);
}

/**
 * The check's own snapshot of a photo before it writes anything there, saved in the state at once: a
 * run that stops midway puts the photo back with it first thing (phase8-check.ts putBackPending).
 */
export async function holdBack(deps: Pick<Phase8Deps, "client" | "map" | "stamp">, run: Run, uuid: string, label: string): Promise<Pending> {
  const start = (await settingsOf(deps, uuid)).settings;
  const snap = await deps.client.request("create_snapshot", { photo_uuid: uuid, name: snapshotName(deps.stamp) });
  const pending: Pending = { uuid, label, snapshot_id: snap.snapshot_id, snapshot_name: snapshotName(deps.stamp), start };
  run.state.pending.push(pending);
  run.save();
  return pending;
}

/**
 * Put a photo back with a snapshot (`snapshotId`, else the check's own) and compare it with its start;
 * the setting names that still differ. Back exactly: it leaves the state's pending list.
 */
export async function putBack(deps: Pick<Phase8Deps, "client" | "map">, run: Run, p: Pending, snapshotId: string = p.snapshot_id): Promise<string[]> {
  const res = await deps.client.request("apply_snapshot", { photo_uuid: p.uuid, snapshot_id: snapshotId }, { timeoutMs: WRITE_TIMEOUT_MS });
  const differing = differingSettings(deps.map.fromSdk(res.read_back).settings, p.start as CanonicalSettings);
  if (differing.length === 0) {
    run.state.pending = run.state.pending.filter((x) => x !== p && !(x.uuid === p.uuid && x.snapshot_id === p.snapshot_id));
    run.save();
  }
  return differing;
}

/** Every photo still pending put back with the check's own snapshot; false when one is not back exactly. */
export async function putBackAll(deps: Pick<Phase8Deps, "client" | "map" | "say" | "stamp">, run: Run): Promise<boolean> {
  let all = true;
  for (const p of [...run.state.pending]) {
    try {
      const differing = await putBack(deps, run, p);
      deps.say(`  ${p.label} put back as before the check: ${differing.length === 0 ? "YES" : `NO (${differing.join(", ")} differ)`}`);
      if (differing.length > 0) throw new Error(`${differing.join(", ")} differ`);
    } catch (err) {
      all = false;
      run.fail(`${p.label} is not back as before the check (${describeError(err)}): in the Snapshots panel, click "${p.snapshot_name}"`);
    }
  }
  return all;
}

/** A failed step's line: what failed and why. */
export const failLine = (what: string, err: unknown): string => `${what}: ${describeError(err)}`;
export const yes = (b: boolean): string => (b ? "YES" : "NO");
