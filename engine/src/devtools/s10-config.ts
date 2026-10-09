// Spike S10, the rendered pipeline recorded (PHASE8_PLAN row 1; plan approved by Jim 2026-10-08
// [stated: "Go with recommendations"]). `npm run s10:check` (s10-check-cli.ts) runs s10-check.ts:
//   1. the census (s10-census.ts): every photo of the "fixtures" collection read by uuid, its
//      settings saved as a dump in the S5 shape, and its pipeline named from two signals;
//   2. the write battery on every photo behind a snapshot (s10-writes.ts): the range probe of each
//      numeric parameter the photo carries and the numeric keys beyond the raw pin (s10-probe.ts),
//      a Custom white balance, the lens switches and the recorded profile pairs (s10-profiles.ts);
//      then the snapshot applied and every key compared: PUT BACK YES/NO;
//   3. two virtual copies of the selected rendered original, and an export of every photo
//      (s10-extras.ts).
// This module holds what they share. Why the spike exists: every non-raw photo in Jim's catalog
// carries IncrementalTemperature/IncrementalTint instead of Temperature/Tint, and CameraProfile
// "Embedded" with no Look [handle: logs\nonraw-2026-10-08\kinds.json, committed redacted in row 2];
// what those keys take on a write is [unverified] until this run. Every write goes by uuid with the
// selection untouched (plugin 0.4.0), as wb-check.ts writes.

import { BridgeError, type BridgeClient } from "../bridge/index.js";
import { pluginVersionAtLeast } from "../bridge/version.js";
import type { BridgeGate } from "../mcp/index.js";
import { CAMERA_PROFILE_KEY, READBACK_TOLERANCE, type ParamMap, type SdkSettings } from "../params/index.js";
import { describeError, type Answer } from "./phase1-check.js";
import type { Json } from "./phase3-config.js";
import { errorBody, mayHaveLanded } from "./phase4-config.js";

export const COLLECTION = "fixtures";
export const MIN_PLUGIN_VERSION = "0.4.0";
export const WRITE_TIMEOUT_MS = 30000;
export const COPIES_TIMEOUT_MS = 30000;
export const EXPORT_TIMEOUT_MS = 60000;
/** Two copies, each "AVG …" (Catalog.lua); Jim removes them after the run (spikes\S10\README.md). */
export const COPY_NAMES = ["AVG S10 copy A", "AVG S10 copy B"] as const;
/** The CameraProfile every rendered photo reported [handle: logs\nonraw-2026-10-08\formats.json]. */
export const EMBEDDED_PROFILE = "Embedded";
/** The session's preview size (PRD 6.8). */
export const PREVIEW = { long_edge: 1600, quality: 75 } as const;
/**
 * Lightroom checks a write (clamps or ignores an out-of-range value, refuses a raw profile pair)
 * only on the photo loaded in Develop: in Jim's run 1 the selected photo was clamped as in Phase 1,
 * while every photo written by uuid read every out-of-range value and the raw pair back as written
 * [handle: %TEMP%\LrC-AVG\S10\s10_check_2026-10-09T11-55-47-680Z.json writes[*].range, collected
 * into docs\reports\phase8\S10\ in row 2]. So the battery selects each photo first and waits this
 * long for Develop to load it [inference: the figure], then puts Jim's selection back at the end.
 */
export const SELECT_SETTLE_MS = 1500;
/** A dropped bridge (run 1: ECONNRESET on the last photo) reconnects by itself; a put-back or a step waits this long for it. */
export const RECONNECT_WAIT_MS = 30000;
export const snapshotName = (stamp: string): string => `AVG S10 before ${stamp}`;
export const historyName = (section: string, n: number, of: number): string => `AVG S10 ${section} ${n}/${of}`;

/** Which of Lightroom's two develop pipelines a photo is on, read from its own settings (PHASE8_PLAN "The design"). */
export type Pipeline = "raw" | "rendered" | "unknown";
export type Signals = { temperature_key: string; temperature_present: boolean; camera_profile: string | null; embedded: boolean };

export type S10Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  say: (line: string) => void;
  stamp: string;
  /** Where the census writes its dumps (%TEMP%\LrC-AVG\S10\census). */
  dumpDir: string;
  /** Where S10Recorder.lua saved the profile recordings (%TEMP%\LrC-AVG\S10\run1). */
  recorderDir: string;
  /** The previews folder (PreviewService's default, %TEMP%\LrC-AVG\previews; tests point it at the sim's). */
  previewDir?: string;
  connectTimeoutMs?: number;
  writeTimeoutMs?: number;
  /** SELECT_SETTLE_MS and RECONNECT_WAIT_MS; tests shorten them. */
  settleMs?: number;
  reconnectWaitMs?: number;
  now?: () => Date;
};

/** A photo of the collection as the census read it. */
export type Photo = {
  uuid: string;
  local_id: number;
  filename: string;
  copy_name: string | null;
  is_virtual_copy: boolean;
  file_format: string | null;
  pipeline: Pipeline;
  signals: Signals;
  process_version: string | null;
  key_count: number;
  /** Keys the photo carries that the raw pin (sdk-keys.lrc15.json) does not. */
  extra_keys: string[];
  /** Pinned keys the photo does not carry. */
  missing_pinned_keys: string[];
  /** The photo selected in Lightroom when the check started: Jim's questions go to it. */
  selected: boolean;
  start: SdkSettings;
};

export type Ctx = { deps: S10Deps; results: Json; errors: string[]; fail: (message: string) => void };

/**
 * The pipeline from two signals that must agree: the Kelvin Temperature key present (raw) or absent
 * (rendered), and CameraProfile "Embedded" (rendered) or anything else (raw) [handle:
 * logs\nonraw-2026-10-08\kinds.json: 9 photos, the two signals agreed on every one]. Disagreement is
 * "unknown", recorded, never guessed (rule 03).
 */
export function pipelineOf(map: ParamMap, settings: SdkSettings): { pipeline: Pipeline; signals: Signals } {
  const spec = map.spec("temperature");
  if (!spec) throw new Error("the params map has no temperature");
  const temperaturePresent = typeof settings[spec.sdkKey] === "number";
  const profile = settings[CAMERA_PROFILE_KEY];
  const embedded = profile === EMBEDDED_PROFILE;
  const pipeline: Pipeline = temperaturePresent && !embedded ? "raw" : !temperaturePresent && embedded ? "rendered" : "unknown";
  return { pipeline, signals: { temperature_key: spec.sdkKey, temperature_present: temperaturePresent, camera_profile: typeof profile === "string" ? profile : null, embedded } };
}

export const label = (p: Pick<Photo, "filename" | "copy_name">): string => (p.copy_name ? `${p.filename} (${p.copy_name})` : p.filename);
export const same = (a: unknown, b: number): boolean => typeof a === "number" && Math.abs(a - b) <= READBACK_TOLERANCE;
export const answered = (a: Answer): boolean | null => (a === "no answer" ? null : a === "y");

/** Take the bridge and connect to Lightroom's plugin (as wb-check.ts). False, with the reason said, when it cannot. */
export async function connect(ctx: Ctx): Promise<boolean> {
  const { deps, results } = ctx;
  if (!(await deps.gate.start())) {
    ctx.fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return false;
  }
  try {
    results["hello"] = await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
  } catch (err) {
    await deps.gate.release();
    ctx.fail(`could not connect to Lightroom (${deps.client.stats.last_drop_reason ?? deps.client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return false;
  }
  const version = (results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (!pluginVersionAtLeast(version, MIN_PLUGIN_VERSION)) {
    await deps.gate.release();
    ctx.fail(`Lightroom is running LrC-AVG plugin ${String(version)}, not ${MIN_PLUGIN_VERSION} or later. Restart Lightroom and run the command again.`);
    return false;
  }
  deps.say(`Connected (plugin ${String(version)}).`);
  return true;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** True once the bridge is connected, waiting up to RECONNECT_WAIT_MS for a dropped one to come back; false, and the check FAILED, when it does not (Greptile, PR #97). */
export async function ensureConnected(ctx: Ctx, forWhat: string): Promise<boolean> {
  const waitMs = ctx.deps.reconnectWaitMs ?? RECONNECT_WAIT_MS;
  try {
    await ctx.deps.client.waitConnected(waitMs);
    return true;
  } catch (err) {
    ctx.fail(`the bridge did not come back within ${waitMs / 1000} s for ${forWhat} (${describeError(err)}). Check File > Plug-in Manager, then tell Claude Code.`);
    return false;
  }
}

/**
 * One write by uuid; its read-back, or null when it failed. `out` then says how (the rule of
 * wb-check.ts): never sent (`written: null`), answered with an error (`error`), or sent with no
 * answer, which Lightroom may still have applied (`maybe_written`).
 */
export async function write(ctx: Ctx, photo: Photo, settings: SdkSettings, history: string, out: Json): Promise<SdkSettings | null> {
  out["history_name"] = history;
  try {
    const res = await ctx.deps.client.request("apply_settings", { photo_uuid: photo.uuid, settings, history_name: history }, { timeoutMs: ctx.deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
    out["apply_ms"] = res.apply_ms;
    return res.read_back;
  } catch (err) {
    const sent = !(err instanceof BridgeError && err.code === "not_connected");
    Object.assign(out, { written: sent ? settings : null, error: errorBody(err), ...(mayHaveLanded(err) ? { maybe_written: history } : {}) });
    ctx.deps.say(`    FAILED ${history}: ${describeError(err)}`);
    return null;
  }
}
