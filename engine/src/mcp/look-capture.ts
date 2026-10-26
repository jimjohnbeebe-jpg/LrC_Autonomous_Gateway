// "Save this edit as a look" (Phase 10 row 5, PHASE10_PLAN "Second re-plan"): lr_save_intent with
// `from_photo` takes the whole global edit of the photo selected in Lightroom into a v3 intent's `set`.
// The groups are lr_sync_series' (sync\mask.ts): tone and presence, white balance, curves, HSL, grading,
// effects, B&W mixer and calibration, and the camera profile [stated: Jim, 2026-10-26: 0b's look, which
// left the tonal settings out, came out too dark and too flat; "Include white balance"]. Detail
// (sharpening, noise), lens corrections, masks and crop stay with the photo [inference: they depend on
// the photo's sensor, lens, ISO and framing, not on its look].

import { isColourParam } from "../intents/index.js";
import { CUSTOM_WHITE_BALANCE_PARAMS, type CameraProfiles, type CanonicalValue, type FromSdkResult, type Pipeline } from "../params/index.js";
import { applyMask, type MaskGroup } from "../sync/index.js";

export const LOOK_GROUPS: readonly MaskGroup[] = ["basic_tone", "white_balance", "tone_curve", "hsl", "grading", "effects", "bw", "calibration"];
export const LOOK_LEFT_OUT = "detail (sharpening, noise), lens corrections, masks and crop stay with each photo";

export type CapturedLook = {
  profile?: { raw: string; rendered: string };
  set: Record<string, CanonicalValue>;
  set_by_pipeline: Partial<Record<Pipeline, Record<string, CanonicalValue>>>;
};

/**
 * The look of a photo whose settings are `view`: its profile (with the matching profile of the other
 * pipeline: Adobe Color / Color, Adobe Monochrome / Monochrome), its values in LOOK_GROUPS as `set`,
 * and its white balance under `set_by_pipeline` for its own pipeline (the units differ).
 */
export function captureLook(view: FromSdkResult, profiles: CameraProfiles): CapturedLook {
  const { copied } = applyMask(view.settings, LOOK_GROUPS);
  const name = view.settings["camera_profile"];
  const mono = typeof name === "string" && profiles.monochrome(name);
  const set: Record<string, CanonicalValue> = {};
  const own: Record<string, CanonicalValue> = {};
  for (const [key, value] of Object.entries(copied)) {
    if (mono && isColourParam(key)) continue;
    (CUSTOM_WHITE_BALANCE_PARAMS.includes(key) ? own : set)[key] = value;
  }
  const out: CapturedLook = { set, set_by_pipeline: Object.keys(own).length ? { [view.pipeline]: own } : {} };
  if (typeof name === "string") {
    const other = view.pipeline === "raw" ? (mono ? "Monochrome" : "Color") : mono ? "Adobe Monochrome" : "Adobe Color";
    out.profile = view.pipeline === "raw" ? { raw: name, rendered: other } : { raw: other, rendered: name };
  }
  return out;
}
