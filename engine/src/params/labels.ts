// Lightroom's Develop panel labels for the canonical parameter names: what the HUD shows the user
// (PRODUCT.md, "Lightroom's words"). The only map from canonical names to labels. Jim checked every
// group against his Lightroom 15.5.1 Develop panel [stated: Jim, 2026-10-03, "All match"]. The local
// sliders (`local.*`, mask-table.ts LOCAL_PARAMS) carry the Masking panel's words; those are [unverified]
// until Jim's mask tools check (GitHub issue #59).

const COLOURS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
const HSL = { hue: "Hue", sat: "Saturation", lum: "Luminance" } as const;
const ZONES = { shadows: "Shadows", midtones: "Midtones", highlights: "Highlights", global: "Global" } as const;
const title = (w: string): string => w.charAt(0).toUpperCase() + w.slice(1);
const LOCAL = {
  temperature: "Temp", tint: "Tint", exposure: "Exposure", contrast: "Contrast", highlights: "Highlights", shadows: "Shadows",
  whites: "Whites", blacks: "Blacks", texture: "Texture", clarity: "Clarity", dehaze: "Dehaze", hue: "Hue", saturation: "Saturation",
  sharpness: "Sharpness", noise: "Noise", moire: "Moire", defringe: "Defringe", toning_hue: "Color (hue)", toning_saturation: "Color (saturation)", grain: "Grain",
} as const;

const LABELS: ReadonlyMap<string, string> = new Map([
  ["temperature", "Temp"],
  ["tint", "Tint"],
  ["exposure", "Exposure"],
  ["contrast", "Contrast"],
  ["highlights", "Highlights"],
  ["shadows", "Shadows"],
  ["whites", "Whites"],
  ["blacks", "Blacks"],
  ["texture", "Texture"],
  ["clarity", "Clarity"],
  ["dehaze", "Dehaze"],
  ["vibrance", "Vibrance"],
  ["saturation", "Saturation"],
  ["camera_profile", "Profile"],
  ...COLOURS.flatMap((c) => Object.entries(HSL).map(([k, v]) => [`hsl.${c}.${k}`, `${title(c)} ${v}`] as const)),
  ...Object.entries(ZONES).flatMap(([z, zone]) => Object.entries(HSL).map(([k, v]) => [`grading.${z}.${k}`, `${zone} ${v}`] as const)),
  ["grading.blending", "Blending"],
  ["grading.balance", "Balance"],
  ["sharpening.amount", "Sharpening Amount"],
  ["sharpening.radius", "Sharpening Radius"],
  ["sharpening.detail", "Sharpening Detail"],
  ["sharpening.masking", "Sharpening Masking"],
  ["noise.luminance", "Noise Reduction Luminance"],
  ["noise.color", "Noise Reduction Color"],
  ["lens.corrections_enable", "Lens Corrections (panel on/off)"],
  ["lens.profile_enable", "Enable Profile Corrections"],
  ["lens.ca_remove", "Remove Chromatic Aberration"],
  ["tone_curve.master", "Point Curve"],
  ["tone_curve.red", "Point Curve Red"],
  ["tone_curve.green", "Point Curve Green"],
  ["tone_curve.blue", "Point Curve Blue"],
  ...Object.entries(LOCAL).map(([k, v]) => [`local.${k}`, v] as const),
]);

/** Lightroom's label for a canonical name ("hsl.orange.sat" -> "Orange Saturation"); an unknown name as given. */
export function lightroomLabel(name: string): string {
  return LABELS.get(name) ?? name;
}
