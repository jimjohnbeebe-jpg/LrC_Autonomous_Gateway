// Canonical parameter vocabulary (PRD FR-4.2) -> Lightroom SDK develop keys.
//
// The params module is the only place that names SDK keys (.claude/rules/03-lightroom.md).
// Every key string here must exist in sdk-keys.lrc15.json, the pinned live getDevelopSettings()
// dump from spike S5, with a matching value type: ParamMap checks that when it is constructed,
// and tests/params-map.test.ts asserts it. Nothing here is copied from SDK documentation.
//
// Ranges: the Phase 1 range probe (Jim's run 3, LrC 15.5.1, the raw NEF fixture) wrote every
// minimum and maximum below, then 1 % of the range beyond each, and read each back
// (docs/reports/phase1/PHASE1.md, run 3). All 114 limits read back exactly as written. Beyond them,
// four keys were clamped to exactly the limit; the other 53 did not take the value at all and read
// back as they were before the check, silently. `rangeSource` gives the handle for each.
//
// Values are absolute settings, not per-pass deltas; step clamping and decay are session logic
// (ARCHITECTURE section 4, Phase 3).

export type NumberParam = { kind: "number"; sdkKey: string; min: number; max: number; rangeSource: string };
/** A number that is either 0 or 1 in the dump, e.g. LensProfileEnable. */
export type SwitchParam = { kind: "switch"; sdkKey: string };
export type BooleanParam = { kind: "boolean"; sdkKey: string };
/** A point curve as a flat array [x0, y0, x1, y1, ...], e.g. ToneCurvePV2012; `hdrSdkKey` on a photo in HDR edit mode (map.ts). */
export type CurveParam = { kind: "curve"; sdkKey: string; hdrSdkKey: string };
export type ParamSpec = NumberParam | SwitchParam | BooleanParam | CurveParam;

/** The canonical name of the camera profile; it maps to a (CameraProfile, Look) pair (camera-profiles.ts). */
export const CAMERA_PROFILE_PARAM = "camera_profile";

/**
 * Process versions the map accepts, newest first. "15.4": both S5 dumps report it [handle:
 * engine/src/params/sdk-keys.lrc15.json "sources"]. "11.0" (Phase 8, decision D2 A [stated: Jim,
 * 2026-10-08, "Go with recommendations"]): the same keys and types as 15.4, and two JPGs and one NEF on
 * it took every write as the 15.4 photos did, same limits and clamps [handle:
 * docs/reports/phase8/S10/s10_check_2026-10-09T12-24-50-743Z.json writes for DSC_0031.JPG, IMG_1595.JPG,
 * _DSC0028.NEF; LR_SDK_NOTES "Recorded in Phase 8"]. Anything else, legacy PV2010 included, is refused
 * rather than mapped (ARCHITECTURE section 5).
 */
export const SUPPORTED_PROCESS_VERSIONS: readonly string[] = ["15.4", "11.0"];

/**
 * Lightroom's names for the supported process versions, for messages. "Version 5" for 11.0: LR_SDK_NOTES
 * "Recorded in Phase 8" (the S10 probes); "Version 6" for 15.4 is [unverified].
 */
export const PROCESS_VERSION_LABELS: Readonly<Record<string, string>> = { "15.4": "Version 6", "11.0": "Version 5" };

const RUN3 = "docs/reports/phase1/P1/p1_check_2026-09-26T21-06-50-295Z.json range_probe";
/** The limits were taken as written; 1 % of the range beyond them was not taken. */
const PROBED_EDGE = `[handle: ${RUN3}] min and max read back as written; 1 % beyond was not taken (read back as the value before the check)`;
/** The limits were taken as written; 1 % beyond them was clamped to exactly the limit. */
export const PROBED_CLAMP = `[handle: ${RUN3}] min and max read back as written; 1 % beyond was clamped to exactly the limit`;

function num(sdkKey: string, min: number, max: number, rangeSource: string = PROBED_EDGE): NumberParam {
  return { kind: "number", sdkKey, min, max, rangeSource };
}

/**
 * The effects probe (issue #125; docs/reports/phase8.5/effects.md, verdict Go [stated: Jim, 2026-10-12]):
 * on the raw 20260907-_OZ80093.NEF and the rendered DSC_0031.JPG, each limit read back as written and
 * 1 % beyond read back as the value before the probe. Names follow the SDK keys (Jim, D1 B, 2026-10-12).
 */
export const EFFECTS_RUN = "docs/reports/phase8.5/effects/effects_probe_2026-10-12T13-17-04-307Z.json";
const EFFECTS = `[handle: ${EFFECTS_RUN} photos[*].range.per_parameter] min and max read back as written on both pipelines; 1 % beyond was not taken`;
/** Style: whole numbers only; what 1-3 are called in Lightroom's menu is [unverified]. */
const EFFECTS_STYLE = `[handle: ${EFFECTS_RUN} photos[*].style.steps] 1, 2 and 3 read back as written on both pipelines; 0 and 4 were not taken`;

/**
 * Spike S14 run 2 (Phase 10 row 1; docs/reports/phase10/S14.md, verdict Go [stated: Jim, 2026-10-25]): on the
 * raw 20260907-_OZ80093.NEF and the rendered DSC_0031.JPG, each limit read back as written and 1 % beyond read
 * back as the value before the probe. The B&W mixer keys exist only while ConvertToGrayscale is true [handle:
 * docs/reports/phase10/S14.md "d. B&W mixer"], so lr_step refuses a bw.* change on a colour photo before writing
 * (session\plan.ts); what Lightroom does with a GrayMixer* key written to a colour photo is [unverified].
 */
export const S14_RUN = "docs/reports/phase10/S14/run2/s14_check_2026-10-25T23-35-11-636Z.json";
const S14_MIXER = `[handle: ${S14_RUN} photos[0..1].mixer.range.per_parameter] -100 and 100 read back as written under Monochrome on both pipelines; 1 % beyond was not taken`;
const S14_CALIBRATION = `[handle: ${S14_RUN} photos[0..1].calibration.per_parameter] -100 and 100 read back as written on both pipelines; 1 % beyond was not taken`;

const S10_RUN2 ="docs/reports/phase8/S10/s10_check_2026-10-09T12-24-50-743Z.json";
/**
 * The rendered pipeline's white-balance keys (spike S10, Phase 8 row 2), pinned in
 * sdk-keys.lrc15.rendered.json. Both are relative values in -100..100: on the selected rendered DNG,
 * whose WhiteBalance was already "Custom", 101 read back 100 and -101 read back -100 while ±50, ±100
 * and 0 read back as written; on the 17 other rendered photos (WhiteBalance "As Shot") every value
 * was ignored until written together with WhiteBalance = "Custom", when +20/+20 was taken on all 18
 * [handle: rangeSource below; docs/reports/phase8/S10.md "Observed"]. RENDERED_PARAMS maps
 * `temperature` and `tint` to them.
 */
export const RENDERED_WHITE_BALANCE = {
  keys: { temperature: "IncrementalTemperature", tint: "IncrementalTint" },
  min: -100,
  max: 100,
  rangeSource: `[handle: ${S10_RUN2} writes[20260906-_OZ80005-Rendered.dng].extra_keys.per_key (101 -> 100, -101 -> -100) and writes[*].white_balance (custom_taken and values_taken true on all 18 rendered photos)]`,
} as const;

const entries: Array<[string, ParamSpec]> = [
  // Basic panel (PV 2012+ keys).
  ["exposure", num("Exposure2012", -5, 5, PROBED_CLAMP)],
  ["contrast", num("Contrast2012", -100, 100)],
  ["highlights", num("Highlights2012", -100, 100)],
  ["shadows", num("Shadows2012", -100, 100)],
  ["whites", num("Whites2012", -100, 100)],
  ["blacks", num("Blacks2012", -100, 100)],
  ["texture", num("Texture", -100, 100)],
  ["clarity", num("Clarity2012", -100, 100)],
  ["dehaze", num("Dehaze", -100, 100)],
  ["vibrance", num("Vibrance", -100, 100)],
  ["saturation", num("Saturation", -100, 100)],
  // White balance on the raw pipeline (Kelvin and tint), probed on the raw NEF. The rendered pipeline
  // (JPEG, TIFF, PNG, PSD, PSB, HEIC, AVIF, JXL, rendered DNG) carries IncrementalTemperature and
  // IncrementalTint instead, -100..100 (RENDERED_WHITE_BALANCE above, RENDERED_PARAMS below).
  ["temperature", num("Temperature", 2000, 50000, PROBED_CLAMP)],
  ["tint", num("Tint", -150, 150, PROBED_CLAMP)],

  // Color grading. The dump has ColorGrade* keys for midtones, global, blending and the shadow
  // and highlight luminance, but no ColorGrade hue/saturation keys for shadows and highlights.
  // The SplitToning* keys drive the Shadows and Highlights wheels [stated: Jim, 2026-10-25, S14 run 2,
  // the Shadows wheel read 120 / 80 after the write; handle: docs/reports/phase10/S14.md "b. Grading wheels"].
  ["grading.shadows.hue", num("SplitToningShadowHue", 0, 360)],
  ["grading.shadows.sat", num("SplitToningShadowSaturation", 0, 100)],
  ["grading.shadows.lum", num("ColorGradeShadowLum", -100, 100)],
  ["grading.midtones.hue", num("ColorGradeMidtoneHue", 0, 360)],
  ["grading.midtones.sat", num("ColorGradeMidtoneSat", 0, 100)],
  ["grading.midtones.lum", num("ColorGradeMidtoneLum", -100, 100)],
  ["grading.highlights.hue", num("SplitToningHighlightHue", 0, 360)],
  ["grading.highlights.sat", num("SplitToningHighlightSaturation", 0, 100)],
  ["grading.highlights.lum", num("ColorGradeHighlightLum", -100, 100)],
  ["grading.global.hue", num("ColorGradeGlobalHue", 0, 360)],
  ["grading.global.sat", num("ColorGradeGlobalSat", 0, 100)],
  ["grading.global.lum", num("ColorGradeGlobalLum", -100, 100)],
  ["grading.blending", num("ColorGradeBlending", 0, 100)],
  ["grading.balance", num("SplitToningBalance", -100, 100)],

  // Calibration (spike S14, Phase 10 row 2): the same limits on both pipelines (S14_CALIBRATION).
  ["calibration.shadow_tint", num("ShadowTint", -100, 100, S14_CALIBRATION)],
  ["calibration.red.hue", num("RedHue", -100, 100, S14_CALIBRATION)],
  ["calibration.red.sat", num("RedSaturation", -100, 100, S14_CALIBRATION)],
  ["calibration.green.hue", num("GreenHue", -100, 100, S14_CALIBRATION)],
  ["calibration.green.sat", num("GreenSaturation", -100, 100, S14_CALIBRATION)],
  ["calibration.blue.hue", num("BlueHue", -100, 100, S14_CALIBRATION)],
  ["calibration.blue.sat", num("BlueSaturation", -100, 100, S14_CALIBRATION)],

  // Detail.
  ["sharpening.amount", num("Sharpness", 0, 150)],
  ["sharpening.radius", num("SharpenRadius", 0.5, 3, PROBED_CLAMP)],
  ["sharpening.detail", num("SharpenDetail", 0, 100)],
  ["sharpening.masking", num("SharpenEdgeMasking", 0, 100)],
  ["noise.luminance", num("LuminanceSmoothing", 0, 100)],
  ["noise.color", num("ColorNoiseReduction", 0, 100)],

  // Lens. EnableLensCorrections and LensProfileEnable are separate, independent keys
  // (Phase 0, P-16) [handle: docs/reports/phase0/S5.md "Part 2 analysis"].
  ["lens.corrections_enable", { kind: "boolean", sdkKey: "EnableLensCorrections" }],
  ["lens.profile_enable", { kind: "switch", sdkKey: "LensProfileEnable" }],
  ["lens.ca_remove", { kind: "switch", sdkKey: "AutoLateralCA" }],

  // Effects: post-crop vignette and grain (issue #125), the same limits on both pipelines (EFFECTS).
  ["vignette.amount", num("PostCropVignetteAmount", -100, 100, EFFECTS)],
  ["vignette.midpoint", num("PostCropVignetteMidpoint", 0, 100, EFFECTS)],
  ["vignette.roundness", num("PostCropVignetteRoundness", -100, 100, EFFECTS)],
  ["vignette.feather", num("PostCropVignetteFeather", 0, 100, EFFECTS)],
  ["vignette.highlight_contrast", num("PostCropVignetteHighlightContrast", 0, 100, EFFECTS)],
  ["vignette.style", num("PostCropVignetteStyle", 1, 3, EFFECTS_STYLE)],
  ["grain.amount", num("GrainAmount", 0, 100, EFFECTS)],
  ["grain.size", num("GrainSize", 0, 100, EFFECTS)],
  ["grain.frequency", num("GrainFrequency", 0, 100, EFFECTS)],

  // Point curves. On a photo in HDR edit mode (HDREditMode 1, map.ts HDR_EDIT_MODE_KEY) Lightroom refused
  // ToneCurvePV2012 under every profile [handle: docs\reports\phase10\curve-probe\run2\curve_probe_2026-10-26T03-06-50-864Z.json
  // photo.profile_sweep] and took ExtendedToneCurvePV2012, read back as written, ToneCurveName2012 "Custom",
  // ToneCurvePV2012 then the same points; Jim saw a lift written there raised in Develop > Tone Curve > Point Curve
  // [stated: Jim, "y"; handle: curve-probe run 3, docs\reports\phase10\curve-probe\run3\curve_probe_2026-10-26T03-46-42-653Z.json
  // photo.extended_curve, questions[0] point_curve; issue #187]. The keys are from that photo's live dump
  // (docs\reports\phase10\curve-probe\run2\curve_probe_settings_20220828-_DSC1159-HDR.dng__65937445.json).
  // Only the master was written: the Red, Green and Blue extended curves are [unverified] beyond their names there.
  ["tone_curve.master", { kind: "curve", sdkKey: "ToneCurvePV2012", hdrSdkKey: "ExtendedToneCurvePV2012" }],
  ["tone_curve.red", { kind: "curve", sdkKey: "ToneCurvePV2012Red", hdrSdkKey: "ExtendedToneCurvePV2012Red" }],
  ["tone_curve.green", { kind: "curve", sdkKey: "ToneCurvePV2012Green", hdrSdkKey: "ExtendedToneCurvePV2012Green" }],
  ["tone_curve.blue", { kind: "curve", sdkKey: "ToneCurvePV2012Blue", hdrSdkKey: "ExtendedToneCurvePV2012Blue" }],
];

// HSL: the eight colour bands, each with hue, saturation and luminance.
const HSL_BANDS: ReadonlyArray<[string, string]> = [
  ["red", "Red"],
  ["orange", "Orange"],
  ["yellow", "Yellow"],
  ["green", "Green"],
  ["aqua", "Aqua"],
  ["blue", "Blue"],
  ["purple", "Purple"],
  ["magenta", "Magenta"],
];
for (const [band, sdkBand] of HSL_BANDS) {
  entries.push([`hsl.${band}.hue`, num(`HueAdjustment${sdkBand}`, -100, 100)]);
  entries.push([`hsl.${band}.sat`, num(`SaturationAdjustment${sdkBand}`, -100, 100)]);
  entries.push([`hsl.${band}.lum`, num(`LuminanceAdjustment${sdkBand}`, -100, 100)]);
}
// The B&W mixer: one slider per band, there only under a monochrome profile (S14_MIXER).
for (const [band, sdkBand] of HSL_BANDS) entries.push([`bw.${band}`, num(`GrayMixer${sdkBand}`, -100, 100, S14_MIXER)]);

/**
 * Canonical name -> spec on the raw pipeline. `camera_profile` is not in here: it maps to two keys
 * (camera-profiles.ts).
 */
export const CANONICAL_PARAMS: ReadonlyMap<string, ParamSpec> = new Map(entries);

/**
 * The rendered pipeline's specs: the same names and keys, except white balance (RENDERED_WHITE_BALANCE).
 * The battery's other numeric sliders took the raw limits on every rendered photo, selected first, with
 * 1 % beyond clamped or ignored as on raw [handle: docs/reports/phase8/S10.md "Observed", "Run 2", the per-photo
 * table, and "Numbers", "Totals" ("limits taken 31 of 31 photos"); LR_SDK_NOTES "Recorded in Phase 8"].
 */
const W = RENDERED_WHITE_BALANCE;
export const RENDERED_PARAMS: ReadonlyMap<string, ParamSpec> = new Map([
  ...entries,
  ["temperature", num(W.keys.temperature, W.min, W.max, W.rangeSource)],
  ["tint", num(W.keys.tint, W.min, W.max, W.rangeSource)],
]);
