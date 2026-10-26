// What a revert writes back besides the canonical values (issue #187 part 2; Greptile, PR #200): the SDK
// values a canonical name's write changes but no canonical name holds. A camera_profile writes its pair and
// ConvertToGrayscale (camera-profiles.ts toSdk), a temperature or tint WhiteBalance "Custom" (map.ts toSdk), and
// a photo's earlier profile may be one the map does not name (unpinned), so its settings have no camera_profile.
// Writing back only the canonical values would leave the step's profile, or "Custom", on the photo.

import { isDeepStrictEqual } from "node:util";
import { isEmptyLook } from "./camera-profiles.js";
import { CAMERA_PROFILE_PARAM } from "./canonical.js";
import { CUSTOM_WHITE_BALANCE_PARAMS, type FromSdkResult, type SdkSettings } from "./map.js";
import { CONVERT_TO_GRAYSCALE_KEY, LOOK_KEY, PROFILE_KEYS, WHITE_BALANCE_KEY } from "./preset-keys.js";

/** Each group of companion keys, and the canonical names whose write sets it. */
const GROUPS: ReadonlyArray<{ keys: readonly string[]; names: readonly string[] }> = [
  { keys: [...PROFILE_KEYS, CONVERT_TO_GRAYSCALE_KEY], names: [CAMERA_PROFILE_PARAM] },
  { keys: [WHITE_BALANCE_KEY], names: CUSTOM_WHITE_BALANCE_PARAMS },
];

/** `sdk`: written over the canonical values' own table; `not_restored`: keys the photo did not report before, so cannot be put back. */
export type CompanionsBack = { sdk: SdkSettings; not_restored: string[] };

/**
 * The companion values of `before` to write with the canonical values `back`: a group goes whole when a name
 * that sets it is written back or any of its keys differs from `current`. A Look absent before (cleared, as a
 * Nikon profile's) goes back as {}, which clears it [handle: docs/reports/phase0/S5.md "Part 2 analysis"]; a Look's
 * Parameters.Version is left out, as toSdk does (Lightroom stamps its own, issue #67). A key absent before that is
 * not the Look cannot be written back as absent. Every key goes through the write's read-back like any other, so
 * what Lightroom does with "As Shot" written back is checked, not assumed [unverified in Lightroom].
 */
export function companionsBack(before: FromSdkResult, current: FromSdkResult, back: Readonly<Record<string, unknown>>): CompanionsBack {
  const sdk: SdkSettings = {};
  const notRestored: string[] = [];
  for (const g of GROUPS) {
    const differs = g.keys.some((k) => !isDeepStrictEqual(before.companions[k], current.companions[k]));
    if (!differs && !g.names.some((n) => n in back)) continue;
    for (const k of g.keys) {
      const v = before.companions[k];
      if (k === LOOK_KEY) sdk[k] = v === undefined || isEmptyLook(v) ? {} : withoutVersion(v);
      else if (v !== undefined) sdk[k] = structuredClone(v);
      else notRestored.push(k);
    }
  }
  return { sdk, not_restored: notRestored };
}

function withoutVersion(look: unknown): unknown {
  const copy = structuredClone(look) as { Parameters?: Record<string, unknown> };
  if (copy.Parameters) delete copy.Parameters["Version"];
  return copy;
}
