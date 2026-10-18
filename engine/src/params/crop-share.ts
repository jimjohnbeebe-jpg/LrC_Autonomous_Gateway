// How much of a geometric mask lies outside the preview (GitHub issue #179): a mask that falls mostly
// outside the visible crop changes little the agent can see, as the issue's surf and foreground masks did,
// so a mask pass warns when 90 % or more of it does [handle: GitHub issue #179, "Suggested fix": "a geometric
// mask whose area falls ≥90% outside the crop should return a warning"; acceptance criteria]. Measured in the preview's frame (crop-frame.ts), where an area ratio is
// the same as in the photo's [inference: the mapping is affine]. A radial is taken as its box; a linear
// gradient as the part of the photo on the full side of its zero line.

import { toView, type CropFrame, type Point } from "./crop-frame.js";
import type { MaskSummary } from "./mask-summary.js";

/** At or above this share outside the preview, a mask pass warns. */
export const OUTSIDE_WARN = 0.9;

type Poly = Point[];

const area = (p: Poly): number => Math.abs(p.reduce((s, a, i) => {
  const b = p[(i + 1) % p.length] as Point;
  return s + a.x * b.y - b.x * a.y;
}, 0)) / 2;

/** `poly` cut to where `side` is >= 0 (Sutherland-Hodgman, one edge); `side` is affine. */
function clip(poly: Poly, side: (p: Point) => number): Poly {
  const out: Poly = [];
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length] as Point;
    const [sa, sb] = [side(a), side(b)];
    if (sa >= 0) out.push(a);
    if (sa >= 0 !== sb >= 0) {
      const t = sa / (sa - sb);
      out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
    }
  });
  return out;
}

const VIEW: ReadonlyArray<(p: Point) => number> = [(p) => p.x, (p) => 1 - p.x, (p) => p.y, (p) => 1 - p.y];
const toUnit = (poly: Poly): Poly => VIEW.reduce(clip, poly);
const isPoint = (v: unknown): v is Point => typeof v === "object" && v !== null && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);

/** The share (0-1) of a mask's area outside the preview, from its geometry as summarized (preview frame); null without one to measure. */
export function outsideShare(f: CropFrame, g: Record<string, unknown> | undefined): number | null {
  if (!g || f.refused) return null;
  let shape: Poly;
  const { zero, full, left, top, right, bottom } = g;
  if (isPoint(zero) && isPoint(full)) {
    const d = { x: full.x - zero.x, y: full.y - zero.y };
    if (d.x === 0 && d.y === 0) return null;
    const photo = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((p) => toView(f, p));
    shape = clip(photo, (p) => (p.x - zero.x) * d.x + (p.y - zero.y) * d.y);
  } else if (typeof left === "number" && typeof top === "number" && typeof right === "number" && typeof bottom === "number") {
    shape = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  } else {
    return null;
  }
  const whole = area(shape);
  return whole > 0 ? 1 - area(toUnit(shape)) / whole : null;
}

/** One warning per part of `mask` with OUTSIDE_WARN or more of it outside the preview. */
export function outsideWarnings(f: CropFrame, mask: MaskSummary | null): string[] {
  if (!mask) return [];
  const geometries = mask.parts ? mask.parts.map((p) => p.geometry) : [mask.geometry];
  return geometries.flatMap((g, i) => {
    const share = outsideShare(f, g);
    if (share === null || share < OUTSIDE_WARN) return [];
    const which = mask.parts ? `part ${i + 1} of mask "${mask.name}"` : `mask "${mask.name}"`;
    return [`${Math.round(share * 100)} % of ${which} lies outside the preview (the photo's crop), so it changes little that the preview shows: check its geometry.`];
  });
}
