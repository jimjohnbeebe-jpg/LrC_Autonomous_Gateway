// SDK keys of a preset file (engine\src\presets\) beyond the canonical parameters' own. Kept in the
// params module, the only place that names SDK keys (.claude\rules\03-lightroom.md); each exists in
// the pinned dump [handle: tests\presets-format.test.ts "names only keys of the pinned dump"], and
// Lightroom wrote each into its own preset files [handle: engine\tests\fixtures\presets\reference.lrc15.xmp,
// reference-2.lrc15.xmp, captured 2026-09-28 by `npm run preset:capture`].

import { CAMERA_PROFILE_PARAM } from "./canonical.js";
import type { ParamMap } from "./map.js";

/** The key a Nikon Camera Matching profile is written as (reference-2.lrc15.xmp `crs:CameraProfile`). */
export const CAMERA_PROFILE_KEY = "CameraProfile";
/** The pair a camera profile is set with through the SDK (camera-profiles.ts toSdk). */
export const PROFILE_KEYS: readonly string[] = [CAMERA_PROFILE_KEY, "Look"];
/** Every preset carries the photo's process version, as both of Lightroom's do. */
export const PROCESS_VERSION_KEY = "ProcessVersion";
/** Lightroom writes the white balance mode ("As Shot", …) with the White Balance setting. */
export const WHITE_BALANCE_KEY = "WhiteBalance";
/**
 * The white balance mode of a raw photo whose white balance was not edited [handle: sdk-keys.lrc15.json
 * "WhiteBalance" sample, both S5 dumps; docs\reports\phase4\WB\wb_check_2026-09-28T12-19-08-508Z.json photo].
 */
export const AS_SHOT_WHITE_BALANCE = "As Shot";
/**
 * The white balance mode the engine writes with a Temperature or Tint (map.ts toSdk). Lightroom took
 * it through applyDevelopSettings and read it back [handle: docs\reports\phase4\WB\wb_check_2026-09-28T12-19-08-508Z.json
 * temperature_custom.custom_taken, tint_custom.custom_taken], and its Basic panel then read "Custom"
 * [stated: Jim, in the same run, temperature_custom.jim.panel_custom].
 */
export const CUSTOM_WHITE_BALANCE = "Custom";
/** Lightroom writes the point curve's name ("Linear", …) with the point curves. */
export const TONE_CURVE_NAME_KEY = "ToneCurveName2012";

/** The SDK keys that carry a canonical name's value; empty for an unknown name. */
export function sdkKeysOf(map: ParamMap, name: string): string[] {
  if (name === CAMERA_PROFILE_PARAM) return [...PROFILE_KEYS];
  const spec = map.spec(name);
  return spec ? [spec.sdkKey] : [];
}
