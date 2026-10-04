// Entry point of the params module: the pinned LrC 15.5.1 files, loaded and cross-checked.

import cameraProfilesJson from "./camera-profiles.lrc15.json" with { type: "json" };
import presetFormatJson from "./preset-format.lrc15.json" with { type: "json" };
import sdkKeysJson from "./sdk-keys.lrc15.json" with { type: "json" };
import { loadCameraProfiles } from "./camera-profiles.js";
import { ParamMap } from "./map.js";
import { parsePresetFormat, type PresetFormat } from "./preset-format.js";
import { loadSdkKeys } from "./sdk-keys.js";

export { CAMERA_PROFILE_PARAM, CANONICAL_PARAMS, SUPPORTED_PROCESS_VERSIONS } from "./canonical.js";
export type { ParamSpec } from "./canonical.js";
export { lightroomLabel } from "./labels.js";
export { AI_KINDS, KIND_LABELS, LOCAL_PARAMS, MASK_TABLE_KEY, MaskError, aiError, computed, isAiKind, readTable, summarize, tableInfo, uncaptured, verifyTable } from "./mask-table.js";
export type { AiKind, Correction, LocalParam, MaskKind, MaskSummary } from "./mask-table.js";
export { REFUSED_KINDS, applyOp, checkKind, correctionIds, firstComponent, named, precheck, storedSliders, tableSettings } from "./mask-ops.js";
export type { Geometry, MaskOp, OpResult } from "./mask-ops.js";
export { CameraProfiles, UnknownCameraProfileError, isEmptyLook } from "./camera-profiles.js";
export type { CameraProfileEntry, ProfileIdentity } from "./camera-profiles.js";
export { CUSTOM_WHITE_BALANCE_PARAMS, ParamError, ParamMap, READBACK_TOLERANCE, canonicalValuesEqual, differingSettings } from "./map.js";
export type { CanonicalSettings, CanonicalValue, FromSdkResult, ReadbackMismatch, SdkSettings } from "./map.js";
export { SdkKeyMap, UnknownSdkKeyError } from "./sdk-keys.js";
export {
  AS_SHOT_WHITE_BALANCE,
  CAMERA_PROFILE_KEY,
  CUSTOM_WHITE_BALANCE,
  PROCESS_VERSION_KEY,
  PROFILE_KEYS,
  TONE_CURVE_NAME_KEY,
  WHITE_BALANCE_KEY,
  sdkKeysOf,
} from "./preset-keys.js";
export { parsePresetFormat, readPresetFormatFile } from "./preset-format.js";
export type { NumberFormat, PresetFormat } from "./preset-format.js";

/** How Lightroom writes a preset file, pinned from its own (preset-format.lrc15.json). */
export function loadDefaultPresetFormat(): PresetFormat {
  return parsePresetFormat(presetFormatJson as unknown);
}

/** The map over the pinned key dump (sdk-keys.lrc15.json) and profile pairs (camera-profiles.lrc15.json). */
export function loadDefaultParamMap(): ParamMap {
  return new ParamMap(loadSdkKeys(sdkKeysJson as unknown), loadCameraProfiles(cameraProfilesJson as unknown));
}
