// The two pipelines Lightroom develops photos through (Phase 8, AVG-017): "raw" (camera raw files and
// raw DNGs) and "rendered" (JPEG, TIFF, PNG, PSD, PSB, HEIC, AVIF, JXL, rendered DNGs). A photo's
// pipeline is read from its own settings at every read, never from its extension or file_format: a
// ".jpeg" reported HEIC and a ".dng" can be either [handle: PHASE8_PLAN "What Lightroom actually does",
// items 1-2; docs/reports/phase8/probes/].
//
// The signals [handle: docs/reports/phase8/S10/s10_check_2026-10-09T12-24-50-743Z.json census: 31
// photos, 13 raw and 18 rendered, none unknown; engine/src/params/sdk-keys.lrc15.rendered.json, whose 18
// rendered dumps carry IncrementalTemperature and no Temperature, the raw pin the reverse]:
//   - raw: the Kelvin Temperature key, and no IncrementalTemperature;
//   - rendered: IncrementalTemperature, no Temperature, and CameraProfile "Embedded".
// The camera profile is not a raw signal: raw DNGs also took "Embedded" [handle: LR_SDK_NOTES
// "Recorded in Phase 8"; PHASE8_PLAN row 2 cell, item 6]. Anything else is "unknown" and refused by
// the map (PIPELINE_UNKNOWN), never guessed (rule 03). Spike S10's census rule (devtools\s10-config.ts
// pipelineOf) read a raw photo with "Embedded" as unknown; reading it as raw follows that finding [inference].

import { CANONICAL_PARAMS, PROCESS_VERSION_LABELS, RENDERED_WHITE_BALANCE, SUPPORTED_PROCESS_VERSIONS } from "./canonical.js";
import { ParamError } from "./param-error.js";
import { CAMERA_PROFILE_KEY } from "./preset-keys.js";

export type Pipeline = "raw" | "rendered";
export const PIPELINES: readonly Pipeline[] = ["raw", "rendered"];

/** The CameraProfile value of every rendered photo [handle: camera-profiles.lrc15.json "Color", "Monochrome"]. */
export const EMBEDDED_PROFILE = "Embedded";

/** What the temperature and tint sliders' numbers mean on each pipeline: Kelvin, or a relative -100..100. */
export const WHITE_BALANCE_UNITS: Readonly<Record<Pipeline, "kelvin" | "relative">> = { raw: "kelvin", rendered: "relative" };

const RAW_TEMPERATURE_KEY = (CANONICAL_PARAMS.get("temperature") as { sdkKey: string }).sdkKey;
const RENDERED_TEMPERATURE_KEY = RENDERED_WHITE_BALANCE.keys.temperature;

export type PipelineSignals = { kelvin_temperature: boolean; incremental_temperature: boolean; camera_profile: string | null };

/** The photo's pipeline from its getDevelopSettings() table, with the signals it was read from. */
export function pipelineOf(sdk: Readonly<Record<string, unknown>>): { pipeline: Pipeline | "unknown"; signals: PipelineSignals } {
  const profile = sdk[CAMERA_PROFILE_KEY];
  const signals: PipelineSignals = {
    kelvin_temperature: typeof sdk[RAW_TEMPERATURE_KEY] === "number",
    incremental_temperature: typeof sdk[RENDERED_TEMPERATURE_KEY] === "number",
    camera_profile: typeof profile === "string" ? profile : null,
  };
  const raw = signals.kelvin_temperature && !signals.incremental_temperature;
  const rendered = !signals.kelvin_temperature && signals.incremental_temperature && signals.camera_profile === EMBEDDED_PROFILE;
  return { pipeline: raw ? "raw" : rendered ? "rendered" : "unknown", signals };
}

/** "15.4 (Version 6)": the number with Lightroom's name for it, when known. */
export function processVersionLabel(pv: string): string {
  const name = PROCESS_VERSION_LABELS[pv];
  return name ? `${pv} (${name})` : pv;
}

/**
 * Refuse a process version the map does not support: an older one must be updated in Lightroom
 * (the menu path in the message is [unverified]); a newer one comes with a Lightroom update.
 */
export function checkProcessVersion(pv: string): void {
  if (SUPPORTED_PROCESS_VERSIONS.includes(pv)) return;
  const supported = `(supported: ${SUPPORTED_PROCESS_VERSIONS.map(processVersionLabel).join(", ")})`;
  // A newer process version comes with a Lightroom update; updating the photo cannot help then [inference].
  if (SUPPORTED_PROCESS_VERSIONS.every((v) => compareVersions(pv, v) > 0)) {
    throw new ParamError(
      "newer_process_version",
      `Process version ${pv} is newer than this engine knows ${supported}, so editing this photo is unavailable until the engine supports it; reading its context still works.`,
    );
  }
  throw new ParamError(
    "unsupported_process_version",
    `Process version ${pv} is not supported ${supported}: update the photo's process version in Lightroom first (Develop module, Settings > Process > ${PROCESS_VERSION_LABELS[SUPPORTED_PROCESS_VERSIONS[0] as string]}).`,
  );
}

/** Dotted versions compared by number per component ("15.10" > "15.4", "15.4.1" > "15.4"); NaN counts as not newer. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The signals in words, for PIPELINE_UNKNOWN. */
export function describeSignals(s: PipelineSignals): string {
  const has = (yes: boolean, key: string): string => `${key} ${yes ? "present" : "absent"}`;
  return `${has(s.kelvin_temperature, RAW_TEMPERATURE_KEY)}, ${has(s.incremental_temperature, RENDERED_TEMPERATURE_KEY)}, ${CAMERA_PROFILE_KEY} ${s.camera_profile === null ? "absent" : `"${s.camera_profile}"`}`;
}
