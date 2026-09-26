// Canonical parameter vocabulary (PRD FR-4.2) -> Lightroom SDK develop keys.
//
// The params module is the only place that names SDK keys (.claude/rules/03-lightroom.md).
// Every key string here must exist in sdk-keys.lrc15.json, the pinned live getDevelopSettings()
// dump from spike S5, with a matching value type: ParamMap checks that when it is constructed,
// and tests/params-map.test.ts asserts it. Nothing here is copied from SDK documentation.
//
// Ranges are Lightroom Classic's Develop slider limits as Claude Code knows them. They are
// [unverified] until the Phase 1 range probe writes each limit, and one step beyond it, and reads
// the result back (docs/reports/phase1/PHASE1.md). `rangeSource` says which applies.
//
// Values are absolute settings, not per-pass deltas; step clamping and decay are session logic
// (ARCHITECTURE section 4, Phase 3).

export type NumberParam = { kind: "number"; sdkKey: string; min: number; max: number; rangeSource: string };
/** A number that is either 0 or 1 in the dump, e.g. LensProfileEnable. */
export type SwitchParam = { kind: "switch"; sdkKey: string };
export type BooleanParam = { kind: "boolean"; sdkKey: string };
/** A point curve as a flat array [x0, y0, x1, y1, ...], e.g. ToneCurvePV2012. */
export type CurveParam = { kind: "curve"; sdkKey: string };
export type ParamSpec = NumberParam | SwitchParam | BooleanParam | CurveParam;

/** The canonical name of the camera profile; it maps to a (CameraProfile, Look) pair (camera-profiles.ts). */
export const CAMERA_PROFILE_PARAM = "camera_profile";

/**
 * Process versions the map accepts. Only "15.4" was observed: both S5 dumps report it
 * [handle: engine/src/params/sdk-keys.lrc15.json "sources"]. Anything else, legacy PV2010 included,
 * is refused rather than mapped (ARCHITECTURE section 5).
 */
export const SUPPORTED_PROCESS_VERSIONS: readonly string[] = ["15.4"];

const UI_LIMIT = "[unverified] Lightroom Classic Develop slider limit; Phase 1 range probe pending";

function num(sdkKey: string, min: number, max: number): NumberParam {
  return { kind: "number", sdkKey, min, max, rangeSource: UI_LIMIT };
}

const entries: Array<[string, ParamSpec]> = [
  // Basic panel (PV 2012+ keys).
  ["exposure", num("Exposure2012", -5, 5)],
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
  // White balance on the raw scale (Kelvin and tint). Both S5 fixtures are raw files; that
  // rendered files (JPEG, TIFF) use a different -100..100 scale is [unverified] and not supported.
  ["temperature", num("Temperature", 2000, 50000)],
  ["tint", num("Tint", -150, 150)],

  // Color grading. The dump has ColorGrade* keys for midtones, global, blending and the shadow
  // and highlight luminance, but no ColorGrade hue/saturation keys for shadows and highlights.
  // Mapping those four to the SplitToning* keys is [inference]; unverified until a render shows it.
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

  // Detail.
  ["sharpening.amount", num("Sharpness", 0, 150)],
  ["sharpening.radius", num("SharpenRadius", 0.5, 3)],
  ["sharpening.detail", num("SharpenDetail", 0, 100)],
  ["sharpening.masking", num("SharpenEdgeMasking", 0, 100)],
  ["noise.luminance", num("LuminanceSmoothing", 0, 100)],
  ["noise.color", num("ColorNoiseReduction", 0, 100)],

  // Lens. EnableLensCorrections and LensProfileEnable are separate, independent keys
  // (Phase 0, P-16) [handle: docs/reports/phase0/S5.md "Part 2 analysis"].
  ["lens.corrections_enable", { kind: "boolean", sdkKey: "EnableLensCorrections" }],
  ["lens.profile_enable", { kind: "switch", sdkKey: "LensProfileEnable" }],
  ["lens.ca_remove", { kind: "switch", sdkKey: "AutoLateralCA" }],

  // Point curves.
  ["tone_curve.master", { kind: "curve", sdkKey: "ToneCurvePV2012" }],
  ["tone_curve.red", { kind: "curve", sdkKey: "ToneCurvePV2012Red" }],
  ["tone_curve.green", { kind: "curve", sdkKey: "ToneCurvePV2012Green" }],
  ["tone_curve.blue", { kind: "curve", sdkKey: "ToneCurvePV2012Blue" }],
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

/** Canonical name -> spec. `camera_profile` is not in here: it maps to two keys (camera-profiles.ts). */
export const CANONICAL_PARAMS: ReadonlyMap<string, ParamSpec> = new Map(entries);
