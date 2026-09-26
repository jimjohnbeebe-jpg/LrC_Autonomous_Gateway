// Entry point of the params module: the pinned LrC 15.5.1 files, loaded and cross-checked.

import cameraProfilesJson from "./camera-profiles.lrc15.json" with { type: "json" };
import sdkKeysJson from "./sdk-keys.lrc15.json" with { type: "json" };
import { loadCameraProfiles } from "./camera-profiles.js";
import { ParamMap } from "./map.js";
import { loadSdkKeys } from "./sdk-keys.js";

export { CAMERA_PROFILE_PARAM, CANONICAL_PARAMS, SUPPORTED_PROCESS_VERSIONS } from "./canonical.js";
export type { ParamSpec } from "./canonical.js";
export { CameraProfiles, UnknownCameraProfileError, isEmptyLook } from "./camera-profiles.js";
export type { CameraProfileEntry, ProfileIdentity } from "./camera-profiles.js";
export { ParamError, ParamMap, READBACK_TOLERANCE } from "./map.js";
export type { CanonicalSettings, CanonicalValue, FromSdkResult, ReadbackMismatch, SdkSettings } from "./map.js";
export { SdkKeyMap, UnknownSdkKeyError } from "./sdk-keys.js";

/** The map over the pinned key dump (sdk-keys.lrc15.json) and profile pairs (camera-profiles.lrc15.json). */
export function loadDefaultParamMap(): ParamMap {
  return new ParamMap(loadSdkKeys(sdkKeysJson as unknown), loadCameraProfiles(cameraProfilesJson as unknown));
}
