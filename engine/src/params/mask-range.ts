// Colour and depth range components (issue #190, the Automaat ports of its PRs #324 and #334), beside the
// luminance range of mask-build.ts. Field names come only from mask-table.ts (rule 03). The colour range is
// in the form Lightroom wrote when Jim made one by hand: Type 1, one PointModels entry "r g b x y 0" (the
// sampled colour 0-1, then the pin's place in the photo) and ColorAmount [handle: docs\reports\phase8.5\
// mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json, "Color Range 1": "0.991135 0.440358 0.818088 0.821179
// 0.214512 0", CorrectionReferenceX/Y 0.821179/0.214512]. Exactly one entry: two crash Lightroom and the
// catalog on reopen [upstream claim: Automaat PR #324]. A depth range is Type -1 with a DepthRange trapezoid
// like LumRange, 0 the nearest; Lightroom fills LuminanceDepthSampleInfo only on a photo with a depth map
// [upstream claim: Automaat PR #334]. No capture here shows a depth range: [unverified] [stated: Jim,
// 2026-10-24, "Ship depth unverified"].
// What the first three numbers of PointModels are (issue #210): not sRGB but Lightroom's own per-photo ranking of
// the sampled colour, l (lightness), a (green to red), b (blue to yellow), 0-1; the same colour stores different
// triples in different photos, develop edits leave it unchanged, and selection follows the triple, not the pin
// [upstream claim: Automaat PR #339, `git show 2acd90c`, 14 Lightroom-authored samples on LrC 15.6 macOS]. Jim's
// own colour ranges fit that reading: "Reds" stores a 0.748875, "Yellows" b 0.938049 [handle:
// docs\reports\phase8\probes\kinds.json " Reds", "Yellows" PointModels] [inference]. A sample Lightroom stored
// is taken over verbatim (copiedSample, Automaat PR #341, `git show c695468`) or given as {l, a, b}; the engine's own
// point sample (the preview's sRGB) is refused since `npm run masks:verify` did not select the red asked for on one
// photo of two (mask-ops.ts COLOR_SAMPLE_NEEDED) [handle: docs\reports\phase11\MASKS-VERIFY.md "Observed"].

import { toView, type CropFrame, type Point } from "./crop-frame.js";
import { C, M, MaskError, RANGE, WHAT, components, type Component, type Correction } from "./mask-table.js";

/** The three numbers a colour range stores first: Lightroom's l, a, b of the sample, each 0-1 [upstream claim: Automaat PR #339]. */
export type Lab = { l: number; a: number; b: number };
export const RANGE_TYPE = { color: 1, luminance: 2, depth: -1 } as const;
/** A full-strength band narrower than this Lightroom replaces with its default [upstream claim: Automaat PR #334]. */
const MIN_BAND = 0.01;
export const COLOR_AMOUNT = 0.5;

const invalid = (message: string): never => {
  throw new MaskError("INVALID_ARGUMENTS", message);
};

/** A range [a, b, c, d] in 0-1, each at least the one before (masked a..d, fully b..c), as LumRange and DepthRange store it. */
export function trapezoid(r: readonly number[] | undefined, what: string): string {
  const ok = r && r.length === 4 && r.every((x, i) => typeof x === "number" && x >= 0 && x <= 1 && x >= (i > 0 ? (r[i - 1] as number) : 0));
  if (!ok) return invalid(`${what} needs 4 numbers in 0-1, each at least the one before.`);
  if ((r[2] as number) - (r[1] as number) < MIN_BAND) invalid(`${what}'s full band (its 2nd to 3rd number) must be at least ${MIN_BAND} wide.`);
  return r.map((x) => x.toFixed(6)).join(" ");
}

/** The fields a range component of Type `type` shares (as the captured luminance and colour ranges carry them). */
const holder = (type: number, fields: Record<string, unknown>): Record<string, unknown> => ({
  [RANGE.holder]: { [RANGE.type]: type, [RANGE.version]: 3, [RANGE.sampleType]: 0, ...fields, [RANGE.invert]: false },
});

/** A colour range: the sample's l, a, b written verbatim, pinned at `at` in the photo. */
export function colorFields(sample: Lab, at: Point, amount: number | undefined): Record<string, unknown> {
  const a = amount ?? COLOR_AMOUNT;
  // 0 is Lightroom's own: Jim's "Reds" colour range stores ColorAmount 0 [handle: docs\reports\phase8\probes\kinds.json
  // " Reds"], so a copy of it keeps 0; the tool's schema still asks a caller for more than 0 (Automaat's contract).
  if (!(a >= 0 && a <= 1)) invalid("geometry.color_amount (how far the selection reaches from the colour) must be 0 to 1.");
  const lab = [sample.l, sample.a, sample.b];
  if (!lab.every((v) => typeof v === "number" && v >= 0 && v <= 1)) invalid("geometry.sample needs l, a and b, each 0-1.");
  const model = [...lab, at.x, at.y].map((v) => v.toFixed(6)).join(" ") + " 0";
  return holder(RANGE_TYPE.color, { [RANGE.pointModels]: [model], [RANGE.colorAmount]: a });
}

/** A depth range; [0, 0, 1, 1] is refused, as Lightroom stores its default so and a photo without depth would look the same [upstream claim: Automaat PR #334]. */
export function depthFields(r: readonly number[] | undefined): Record<string, unknown> {
  const text = trapezoid(r, "geometry.depth_range");
  if (text === "0.000000 0.000000 1.000000 1.000000") invalid("geometry.depth_range 0, 0, 1, 1 selects everything; give a band of distances.");
  return holder(RANGE_TYPE.depth, { [RANGE.depthRange]: text });
}

/**
 * Whether the depth range of correction `id`, as read back, lacks LuminanceDepthSampleInfo: Lightroom fills
 * it only on a photo with a depth map, and the mask then selects nothing [upstream claim: Automaat PR #334].
 */
export function depthMapMissing(entries: readonly Correction[], id: string): boolean {
  const part = entries.find((e) => e[C.id] === id)?.[C.masks] as Component[] | undefined;
  const range = part?.[0]?.[RANGE.holder] as Record<string, unknown> | undefined;
  return !range || typeof range[RANGE.sampleInfo] !== "string" || range[RANGE.sampleInfo] === "";
}

/** A colour range component's sample, pin (in the photo) and amount, or why it cannot be copied (Automaat PR #341 copiableColorRange). */
export function colorRangeOf(m: Component | undefined): { sample: Lab; pin: Point; amount: number } | string {
  const range = m?.[RANGE.holder] as Record<string, unknown> | undefined;
  if (!m || m[M.what] !== WHAT.range || !range) return "is not a range mask";
  if (range[RANGE.type] !== RANGE_TYPE.color) return "is a range of another kind (luminance or depth), not a colour range";
  const models = range[RANGE.pointModels];
  // Exactly one: two entries crash Lightroom and the catalog on reopen [upstream claim: Automaat PR #324].
  if (!Array.isArray(models) || models.length !== 1) return `has ${Array.isArray(models) ? models.length : 0} colour sample points; exactly one can be copied`;
  const n = typeof models[0] === "string" ? models[0].trim().split(/\s+/).map(Number) : [];
  const amount = Number(range[RANGE.colorAmount] ?? COLOR_AMOUNT);
  if (n.length < 5 || !n.slice(0, 5).every((v) => Number.isFinite(v) && v >= 0 && v <= 1) || !(amount >= 0 && amount <= 1)) return "has a colour sample that cannot be read";
  const [l, a, b, x, y] = n as [number, number, number, number, number];
  return { sample: { l, a, b }, pin: { x, y }, amount };
}

/** copy_sample_from (Automaat PR #341): the colour range to take the sample from, by its mask and, in a mask of several parts, `part` (1 = the first). */
export type CopySample = { mask_id: string; part?: number | undefined; target?: string | undefined };

/**
 * The sample of the colour range `copy` names in `entries` (the source photo's table, `frame` its crop frame): its l, a, b
 * and amount as Lightroom stored them, and its pin in 0-1 of the source's preview, clamped to it (the pin only places
 * the panel's handle; selection follows the triple [upstream claim: Automaat PR #339]). Refused: an unknown mask
 * (MASK_NOT_FOUND), a mask of several parts without `part`, anything but a colour range with one sample.
 */
export function copiedSample(entries: readonly Correction[], frame: CropFrame, copy: CopySample): { sample: Lab; point: Point; amount: number } {
  const e = entries.find((x) => x[C.id] === copy.mask_id);
  if (!e) throw new MaskError("MASK_NOT_FOUND", `copy_sample_from: no mask has id ${copy.mask_id} on that photo; call lr_list_masks for the current ids.`, { mask_id: copy.mask_id });
  const parts = components(e);
  if (copy.part === undefined && parts.length !== 1) invalid(`copy_sample_from: mask ${copy.mask_id} has ${parts.length} parts; name the colour range's part (1 = the first).`);
  const got = colorRangeOf(parts[(copy.part ?? 1) - 1]);
  if (typeof got === "string") return invalid(`copy_sample_from: ${copy.part ? `part ${copy.part} of ` : ""}mask ${copy.mask_id} ${got}.`);
  const v = toView(frame, got.pin);
  const clamp = (x: number): number => Math.min(1, Math.max(0, x));
  return { sample: got.sample, point: { x: clamp(v.x), y: clamp(v.y) }, amount: got.amount };
}
