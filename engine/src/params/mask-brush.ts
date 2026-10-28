// Brush components from strokes (issue #190, the Automaat port of its PR #326; feather, density, erase and strokes
// added to a brush: issue #217 row 5, its PR #340). Field names come only from mask-table.ts (rule 03). The form is
// Lightroom's own, from a brush Jim painted by hand: a Mask/Aggregate holding one Mask/Paint per stroke, each with
// Flow, Radius, CenterWeight, MaskValue and Dabs, its dabs "d x y" in 0-1 of the uncropped photo [handle:
// docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json, "Brush 1"]. Lightroom's own Dabs also
// carry "r" (radius), "f" (flow) and "h" (CenterWeight: "h 0.3629" beside CenterWeight 0.362855 in that capture)
// tokens; the engine writes "d" dabs, a leading "f" when flow is below 1 and a leading "h" when CenterWeight is
// between 0 and 1, as Automaat writes them [upstream claim: Automaat PR #326, BrushStrokes.lua dabsAlong at
// 1040453]. Radius is a fraction of the uncropped photo's long edge [upstream claim: same PR]; Lightroom's Size
// slider is a screen size, so only the radius is offered [upstream claim: BrushStrokes.lua
// REASON_OF_UNSUPPORTED_FIELD].
// Feather (0 hard, 100 soft) is not stored: it sets the stored Radius (the brush's radius times a scale) and
// CenterWeight, by the curve upstream interpolated from Lightroom-authored samples [upstream claim: BrushFeather.lua
// at 1040453, PR #340]; feather 100 is scale 1 and CenterWeight 0, what the engine wrote before. Density is the
// Paint's MaskValue, and an erase stroke is MaskValue 0 [upstream claim: BrushStrokes.lua newPaint, PR #340]. Whether
// Lightroom draws each as its panel would is [unverified] until Jim's `npm run masks:parity`.

import { photoPoint, type CropFrame, type Point } from "./crop-frame.js";
import { BRUSH, M, MaskError, WHAT, newMaskId, newSyncId, type Component } from "./mask-table.js";

/** One stroke: radius as a fraction of the long edge, flow and density 0-1, feather 0 (hard) to 100 (soft); erase takes paint away. */
export type Stroke = {
  points: Point[];
  radius?: number | undefined;
  flow?: number | undefined;
  feather?: number | undefined;
  density?: number | undefined;
  erase?: boolean | undefined;
};
export const BRUSH_LIMITS = { strokes: 50, points: 1000, dabs: 2000 } as const;
/** About the radius of the brush Jim painted (Radius 0.052099, the capture above). */
export const BRUSH_RADIUS = 0.05;
/** Dabs at most this many radii apart; Lightroom's own were about 0.2 [handle: the capture above, 0.0104 apart at Radius 0.052]. */
const SPACING = 0.25;

/** Feather (0-1), the stored radius's scale, CenterWeight [upstream claim: BrushFeather.lua FEATHER_SAMPLES at 1040453]. */
const FEATHER: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0.392053, 1], [0.02, 0.394077, 0.934595], [0.05, 0.397636, 0.843964], [0.1, 0.405332, 0.710941], [0.15, 0.41599, 0.597666],
  [0.2, 0.430693, 0.501304], [0.25, 0.4507, 0.419401], [0.3, 0.4774, 0.349837], [0.35, 0.512008, 0.290787], [0.4, 0.554709, 0.240684],
  [0.45, 0.603801, 0.198184], [0.5, 0.656012, 0.16214], [0.55, 0.707956, 0.131575], [0.6, 0.757206, 0.105656], [0.65, 0.802427, 0.083679],
  [0.7, 0.843085, 0.065044], [0.75, 0.879117, 0.049246], [0.8, 0.910729, 0.035858], [0.85, 0.938245, 0.024519], [0.9, 0.962042, 0.014927],
  [0.95, 0.982506, 0.006825], [1, 1, 0],
];

/** The radius scale and CenterWeight for feather `f` (0-1), linear between the samples. */
export function featherOf(f: number): { scale: number; centerWeight: number } {
  const i = Math.max(1, FEATHER.findIndex((s) => f <= s[0]));
  const [lo, hi] = [FEATHER[i - 1], FEATHER[i]] as [readonly [number, number, number], readonly [number, number, number]];
  const t = (f - lo[0]) / (hi[0] - lo[0]);
  return { scale: lo[1] + (hi[1] - lo[1]) * t, centerWeight: lo[2] + (hi[2] - lo[2]) * t };
}

const invalid = (message: string): never => {
  throw new MaskError("INVALID_ARGUMENTS", message);
};

const inRange = (v: unknown, lo: number, hi: number, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi) invalid(`${what} must be a number from ${lo} to ${hi}.`);
  return v as number;
};
const unitIn = (v: unknown, lo: number, what: string): number => inRange(v, lo, 1, what);
const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/**
 * The dabs of one stroke: its points mapped into the photo through `frame`, joined with dabs at most
 * SPACING radii apart.
 * ponytail: the spacing is measured in 0-1 units of each axis, so on a non-square photo it is a little
 * closer along the short side; the dab count is what matters.
 */
function dabs(s: Stroke, radius: number, frame: CropFrame, k: number): string[] {
  const at = s.points.map((p, i) => {
    const what = `strokes[${k}].points[${i}]`;
    return photoPoint(frame, { x: unitIn(p?.x, 0, `${what}.x`), y: unitIn(p?.y, 0, `${what}.y`) }, what);
  });
  const out: Point[] = at.slice(0, 1);
  for (let i = 1; i < at.length; i++) {
    const [a, b] = [at[i - 1] as Point, at[i] as Point];
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (radius * SPACING)));
    // Before the dabs are made, so a stroke far over the cap is refused at once (Greptile, PR #191).
    if (out.length + steps > BRUSH_LIMITS.dabs) invalid(`strokes[${k}] needs more than ${BRUSH_LIMITS.dabs} dabs at this radius: split it or use a larger radius or feather.`);
    for (let j = 1; j <= steps; j++) out.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
  }
  return out.map((p) => `d ${p.x.toFixed(6)} ${p.y.toFixed(6)}`);
}

/** MaskValue: the density, 0 for an erase stroke (erase: true, or density 0). */
function valueOf(s: Stroke, k: number): number {
  if (s.erase !== undefined && typeof s.erase !== "boolean") invalid(`strokes[${k}].erase must be true or false.`);
  if (s.erase === true && s.density !== undefined && s.density !== 0) invalid(`strokes[${k}]: an erase stroke takes no density (it removes the paint it covers).`);
  return s.erase === true ? 0 : s.density === undefined ? 1 : r6(inRange(s.density, 0, 1, `strokes[${k}].density`));
}

/** The Mask/Paint of one stroke. */
function paint(s: Stroke, frame: CropFrame, k: number): Component {
  if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > BRUSH_LIMITS.points) invalid(`strokes[${k}] needs 1 to ${BRUSH_LIMITS.points} points.`);
  const size = s.radius === undefined ? BRUSH_RADIUS : unitIn(s.radius, 0.001, `strokes[${k}].radius`);
  const flow = s.flow === undefined ? 1 : Math.round(unitIn(s.flow, 0.01, `strokes[${k}].flow`) * 10000) / 10000;
  const f = featherOf(s.feather === undefined ? 1 : inRange(s.feather, 0, 100, `strokes[${k}].feather`) / 100);
  const [radius, centerWeight] = [r6(size * f.scale), r6(f.centerWeight)];
  const tokens = [...(flow < 1 ? [`f ${flow.toFixed(4)}`] : []), ...(centerWeight > 0 && centerWeight < 1 ? [`h ${centerWeight.toFixed(4)}`] : [])];
  return {
    [M.what]: WHAT.paint, [M.value]: valueOf(s, k), [M.inverted]: false, [M.syncId]: newSyncId(), [M.id]: newMaskId(), [M.active]: true, [M.blend]: 0,
    [BRUSH.flow]: flow, [BRUSH.radius]: radius, [BRUSH.centerWeight]: centerWeight, [BRUSH.dabs]: [...tokens, ...dabs(s, radius, frame, k)],
  };
}

/** A brush component's own fields: its Masks, one Paint per stroke; on an existing brush (`old`), the strokes added after its own. */
export function brushFields(strokes: readonly Stroke[] | undefined, frame: CropFrame, old: Component | null = null): Record<string, unknown> {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > BRUSH_LIMITS.strokes) invalid(`A brush needs geometry.strokes: 1 to ${BRUSH_LIMITS.strokes} strokes, each { points: [{x, y}, ...], radius?, flow?, feather?, density?, erase? }.`);
  const painted = (strokes as Stroke[]).map((s, k) => paint(s, frame, k));
  if (!old) {
    if (painted.every((p) => p[M.value] === 0)) invalid("A new brush needs a stroke that paints: erase strokes only take paint away.");
    return { [BRUSH.masks]: painted };
  }
  const had = old[BRUSH.masks];
  if (!Array.isArray(had)) invalid("This brush is stored compressed by Lightroom (no strokes the tools can read), so strokes cannot be added to it.");
  return { [BRUSH.masks]: [...(had as Component[]), ...painted] };
}

/** The middle dab of the first stroke: where Lightroom put the pin of the brush Jim painted (CorrectionReferenceX 0.496219, one of its dabs). */
export function brushPin(m: Component): Point | null {
  const first = (m[BRUSH.masks] as Component[] | undefined)?.[0];
  const ds = ((first?.[BRUSH.dabs] as string[] | undefined) ?? []).filter((t) => t.startsWith("d "));
  const mid = ds[Math.floor(ds.length / 2)];
  if (!mid) return null;
  const [, x, y] = mid.split(" ").map(Number);
  return { x: x as number, y: y as number };
}
