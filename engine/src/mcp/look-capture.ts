// "Save this edit as a look" (Phase 10 row 5, PHASE10_PLAN "Second re-plan"): lr_save_intent with
// `from_photo` takes the whole global edit of the photo selected in Lightroom into a v3 intent's `set`.
// The groups are lr_sync_series' (sync\mask.ts): tone and presence, white balance, curves, HSL, grading,
// effects, B&W mixer and calibration, and the camera profile [stated: Jim, 2026-10-26: 0b's look, which
// left the tonal settings out, came out too dark and too flat; "Include white balance"]. Detail
// (sharpening, noise), lens corrections, masks and crop stay with the photo [inference: they depend on
// the photo's sensor, lens, ISO and framing, not on its look].
// Rows 9+10 ("Third re-plan"): the photo's AI masks that need no point (captureMasks), as kind, name and local sliders
// with no geometry, and `from_preset`, a Develop preset's settings read through the params map (presetLook).

import { LOOK_MASK_KINDS, MAX_LOOK_MASKS, isColourParam } from "../intents/index.js";
import {
  CAMERA_PROFILE_PARAM,
  CUSTOM_WHITE_BALANCE_PARAMS,
  MaskError,
  amountOf,
  readPreset,
  readTable,
  summarize,
  type CameraProfiles,
  type CanonicalSettings,
  type CanonicalValue,
  type FromSdkResult,
  type ParamMap,
  type Pipeline,
  type SdkSettings,
} from "../params/index.js";
import { applyMask, type MaskGroup } from "../sync/index.js";

export const LOOK_GROUPS: readonly MaskGroup[] = ["basic_tone", "white_balance", "tone_curve", "hsl", "grading", "effects", "bw", "calibration"];
export const LOOK_LEFT_OUT = "detail (sharpening, noise), lens corrections and crop stay with each photo; masks only as AI kinds with no geometry";

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
export function captureLook(view: Pick<FromSdkResult, "settings" | "pipeline">, profiles: CameraProfiles): CapturedLook {
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

export type LookMask = { kind: string; name: string; purpose: string; sliders: Record<string, number> };

/** The photo's masks a look can carry (an AI kind with no point, one part, shown, not inverted, at Amount 1), without geometry; `skipped` says why each other one is not. */
export function captureMasks(sdk: SdkSettings): { masks: LookMask[]; skipped: string[] } {
  let table;
  try {
    table = readTable(sdk);
  } catch (err) {
    if (!(err instanceof MaskError)) throw err;
    return { masks: [], skipped: [err.message] };
  }
  const masks: LookMask[] = [];
  const skipped: string[] = [];
  for (const e of table) {
    const m = summarize(e);
    const fits = m.components === 1 && m.active && !m.inverted && (LOOK_MASK_KINDS as readonly string[]).includes(m.kind);
    if (!fits) skipped.push(`"${m.name}" (${m.kind}): a look carries only shown, one-part, not inverted AI masks Lightroom finds without a point`);
    // lr_create_mask makes a mask at Amount 1 (params mask-ops.ts newCorrection), so a lower Amount would come back stronger.
    else if (amountOf(e) !== 1) skipped.push(`"${m.name}": its Amount is ${amountOf(e)}, and a look's mask is made at Amount 1`);
    else if (masks.length >= MAX_LOOK_MASKS) skipped.push(`"${m.name}": a look carries at most ${MAX_LOOK_MASKS} masks`);
    else masks.push({ kind: m.kind, name: m.name.slice(0, 60), purpose: `From the source photo's "${m.name}" mask; adjust it to each photo.`.slice(0, 300), sliders: m.sliders });
  }
  return { masks, skipped };
}

/**
 * A Develop preset's look (lr_save_intent from_preset): its settings in canonical names (params\preset-read.ts), taken as
 * captureLook takes a photo's. A preset has no pipeline: white balance read from a rendered-pipeline key (relative) goes
 * under `rendered`, otherwise under the profile's pipeline, else `raw` [inference: preset-read.ts reads the raw key first].
 * `dropped`: the preset's SDK keys no canonical name reads; `left_out`: canonical settings outside LOOK_GROUPS.
 */
export function presetLook(map: ParamMap, sdk: SdkSettings): CapturedLook & { dropped: string[]; left_out: string[] } {
  const r = readPreset(map, sdk);
  const profiles = map.cameraProfiles();
  const profile = r.settings[CAMERA_PROFILE_PARAM];
  const pipeline: Pipeline = r.relative.length > 0 ? "rendered" : typeof profile === "string" ? profiles.pipeline(profile) : "raw";
  const settings = r.settings as CanonicalSettings;
  const left = applyMask(settings, LOOK_GROUPS).left.filter((n) => n !== CAMERA_PROFILE_PARAM);
  return { ...captureLook({ settings, pipeline }, profiles), dropped: r.other_keys, left_out: left };
}
