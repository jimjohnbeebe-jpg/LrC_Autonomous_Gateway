// Which of a photo's settings go into a preset (PHASE4_PLAN row 9, decision 2 [stated: Jim,
// 2026-09-28, "go with recommendations"]): the canonical settings of the groups asked for (the sync's
// groups, sync\mask.ts), with the keys Lightroom writes alongside them (the process version, the
// white balance mode, the point curve's name). Where Lightroom's own presets leave a setting out,
// this does too, and says why in `left_out` [handle: engine\tests\fixtures\presets\reference.lrc15.xmp
// and reference-2.lrc15.xmp, written by LrC 15.5.1, 2026-09-28, from Jim's checklist (Check All; for
// the second, Profile too) [stated: "reference made", "reference 2 made"]; which boxes were ticked
// is not recorded]. A rendered photo's preset follows the two JPEG references of Phase 8 row 5
// [handle: reference-rendered.lrc15.xmp, reference-rendered-mono.lrc15.xmp, written by LrC 15.6,
// 2026-10-10, Check All [stated: Jim, "presets done"]]: the relative white balance as
// IncrementalTemperature/IncrementalTint with WhiteBalance "Custom", and the profile as
// CameraProfile "Default Color" or "Default Monochrome" with ConvertToGrayscale, not the "Embedded"
// the photo holds. Each rule below reads these files: it is [inference] beyond them.

import {
  AS_SHOT_WHITE_BALANCE,
  CAMERA_PROFILE_KEY,
  CAMERA_PROFILE_PARAM,
  CONVERT_TO_GRAYSCALE_KEY,
  PROCESS_VERSION_KEY,
  TONE_CURVE_NAME_KEY,
  WHITE_BALANCE_KEY,
  type CanonicalSettings,
  type CanonicalValue,
  type ParamMap,
  type Pipeline,
  type SdkSettings,
} from "../params/index.js";
import { applyMask, type MaskGroup } from "../sync/mask.js";

/** A boolean is written as Lightroom writes one: "True" / "False" (xmp-write.ts). */
export type PresetEntry = { key: string; value: number | string | boolean | number[] };
export type LeftOut = { name: string; reason: string };
/** `written`: the canonical names written; `also_written`: the other keys written with them (the process version, modes). */
export type PresetSelection = { entries: PresetEntry[]; written: string[]; also_written: Record<string, string>; left_out: LeftOut[]; process_version: string };

const SHARPEN_DETAILS = ["sharpening.radius", "sharpening.detail", "sharpening.masking"];

/** Why a chosen setting is not written, or null when it is. */
function leaveOut(map: ParamMap, name: string, value: CanonicalValue, sdk: SdkSettings, copied: CanonicalSettings, pipeline: Pipeline): string | null {
  if (name === "lens.corrections_enable") return "Lightroom's own presets do not carry it: none of the reference files has it";
  // Observed on raw photos (both raw references); a rendered photo with As Shot is [inference] from them.
  if ((name === "temperature" || name === "tint") && sdk[WHITE_BALANCE_KEY] === AS_SHOT_WHITE_BALANCE) {
    return `white balance is "As Shot": the preset says so and, like Lightroom's ${pipeline === "raw" ? "two raw references" : "raw references"}, carries no temperature or tint`;
  }
  if (SHARPEN_DETAILS.includes(name) && copied["sharpening.amount"] === 0) {
    return "sharpening amount is 0: Lightroom then leaves radius, detail and masking out (reference.lrc15.xmp; reference-2 has them at amount 24)";
  }
  if (name === CAMERA_PROFILE_PARAM && map.cameraProfiles().get(String(value)).look !== null) {
    return "an Adobe profile: how Lightroom writes one (with its Look) into a preset has not been observed; the preset keeps each photo's own profile";
  }
  if (Array.isArray(value) && value.length === 0) return "the curve is empty";
  return null;
}

/**
 * The entries that write a canonical setting. A rendered-pipeline profile is written as Lightroom
 * writes it into a preset: CameraProfile "Default Color" / "Default Monochrome" (the pinned
 * preset_camera_profile, camera-profiles.lrc15.json) with ConvertToGrayscale, since CameraProfile
 * alone would make Color and Monochrome the same preset (Greptile, PR #98).
 */
function entriesOf(map: ParamMap, name: string, value: CanonicalValue, pipeline: Pipeline): PresetEntry[] {
  if (name === CAMERA_PROFILE_PARAM) {
    const entry = map.cameraProfiles().get(String(value));
    if (entry.convert_to_grayscale !== undefined && entry.preset_camera_profile !== undefined) {
      return [
        { key: CONVERT_TO_GRAYSCALE_KEY, value: entry.convert_to_grayscale },
        { key: CAMERA_PROFILE_KEY, value: entry.preset_camera_profile },
      ];
    }
    return [{ key: CAMERA_PROFILE_KEY, value: entry.camera_profile }];
  }
  const spec = map.spec(name, pipeline);
  if (!spec) throw new Error(`no spec for ${name}`);
  return [{ key: spec.sdkKey, value: typeof value === "boolean" ? Number(value) : value }];
}

/** The keys Lightroom writes with a group, read from the photo's own settings. */
function companions(sdk: SdkSettings, groups: readonly MaskGroup[]): PresetEntry[] {
  const out: PresetEntry[] = [];
  const add = (key: string): void => {
    const value = sdk[key];
    if (typeof value === "string") out.push({ key, value });
  };
  if (groups.includes("white_balance")) add(WHITE_BALANCE_KEY); // "As Shot" or "Custom", on both pipelines
  if (groups.includes("tone_curve")) add(TONE_CURVE_NAME_KEY);
  return out;
}

/** The preset's settings from a getDevelopSettings() table. Throws ParamError on an unsupported process version. */
export function selectPresetSettings(map: ParamMap, sdk: SdkSettings, groups: readonly MaskGroup[]): PresetSelection {
  const read = map.fromSdk(sdk);
  const { copied } = applyMask(read.settings, groups);
  const extra: PresetEntry[] = [{ key: PROCESS_VERSION_KEY, value: read.process_version }, ...companions(sdk, groups)];
  const entries: PresetEntry[] = [...extra];
  const written: string[] = [];
  const left_out: LeftOut[] = [];
  // Masks are the photo's own (GitHub issue #59): a preset of global settings carries none [inference:
  // how Lightroom writes masks into a preset file was not captured].
  if (read.masks.count > 0) left_out.push({ name: "masks", reason: `the photo's ${read.masks.count} mask(s): this preset carries global settings only` });
  if (groups.includes("camera_profile") && !(CAMERA_PROFILE_PARAM in copied)) {
    left_out.push({ name: CAMERA_PROFILE_PARAM, reason: `the photo's profile (${read.camera_profile.camera_profile ?? "none"}) is not one of the pinned profiles` });
  }
  for (const [name, value] of Object.entries(copied)) {
    const reason = leaveOut(map, name, value, sdk, copied, read.pipeline);
    if (reason !== null) left_out.push({ name, reason });
    else {
      entries.push(...entriesOf(map, name, value, read.pipeline));
      written.push(name);
    }
  }
  const also_written = Object.fromEntries(extra.map((e) => [e.key, String(e.value)]));
  return { entries, written: written.sort(), also_written, left_out, process_version: read.process_version };
}
