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

import type { Point } from "./crop-frame.js";
import { C, MaskError, RANGE, type Component, type Correction } from "./mask-table.js";

export type Rgb = [number, number, number];
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

/** A colour range: the colour `sample` (0-1 sRGB of the preview at the point), pinned at `at` in the photo. */
export function colorFields(sample: Rgb, at: Point, amount: number | undefined): Record<string, unknown> {
  const a = amount ?? COLOR_AMOUNT;
  if (!(a > 0 && a <= 1)) invalid("geometry.color_amount (how far the selection reaches from the colour) must be above 0 and at most 1.");
  const model = [...sample, at.x, at.y].map((v) => v.toFixed(6)).join(" ") + " 0";
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
