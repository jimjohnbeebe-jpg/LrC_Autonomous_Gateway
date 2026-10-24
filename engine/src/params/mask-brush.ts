// Brush components from strokes (issue #190, the Automaat port of its PR #326). Field names come only from
// mask-table.ts (rule 03). The form is Lightroom's own, from a brush Jim painted by hand: a Mask/Aggregate
// holding one Mask/Paint per stroke, each with Flow, Radius, CenterWeight and Dabs, its dabs "d x y" in 0-1
// of the uncropped photo [handle: docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json,
// "Brush 1"]. Lightroom's own Dabs also carry "r" (radius), "f" (flow) and "h" (hardness, CenterWeight)
// tokens; the engine writes "d" dabs only, with a leading "f" when flow is below 1, and CenterWeight 0, as
// Automaat writes them and found taken [upstream claim: Automaat PR #326]. Radius is a fraction of the
// uncropped photo's long edge [upstream claim: same PR]. No erase: Lightroom sets a written Paint's blend
// mode to add [upstream claim: same PR].

import { photoPoint, type CropFrame, type Point } from "./crop-frame.js";
import { BRUSH, M, MaskError, WHAT, newMaskId, newSyncId, type Component } from "./mask-table.js";

export type Stroke = { points: Point[]; radius?: number | undefined; flow?: number | undefined };
export const BRUSH_LIMITS = { strokes: 50, points: 1000, dabs: 2000 } as const;
/** About the radius of the brush Jim painted (Radius 0.052099, the capture above). */
export const BRUSH_RADIUS = 0.05;
/** Dabs at most this many radii apart; Lightroom's own were about 0.2 [handle: the capture above, 0.0104 apart at Radius 0.052]. */
const SPACING = 0.25;

const invalid = (message: string): never => {
  throw new MaskError("INVALID_ARGUMENTS", message);
};

const unitIn = (v: unknown, lo: number, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > 1) invalid(`${what} must be a number from ${lo} to 1.`);
  return v as number;
};

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
    for (let j = 1; j <= steps; j++) out.push({ x: a.x + ((b.x - a.x) * j) / steps, y: a.y + ((b.y - a.y) * j) / steps });
  }
  if (out.length > BRUSH_LIMITS.dabs) invalid(`strokes[${k}] needs ${out.length} dabs at this radius, over ${BRUSH_LIMITS.dabs}: split it or use a larger radius.`);
  return out.map((p) => `d ${p.x.toFixed(6)} ${p.y.toFixed(6)}`);
}

/** The Mask/Paint of one stroke. */
function paint(s: Stroke, frame: CropFrame, k: number): Component {
  if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > BRUSH_LIMITS.points) invalid(`strokes[${k}] needs 1 to ${BRUSH_LIMITS.points} points.`);
  const radius = s.radius === undefined ? BRUSH_RADIUS : unitIn(s.radius, 0.001, `strokes[${k}].radius`);
  const flow = s.flow === undefined ? 1 : Math.round(unitIn(s.flow, 0.01, `strokes[${k}].flow`) * 10000) / 10000;
  const d = dabs(s, radius, frame, k);
  return {
    [M.what]: WHAT.paint, [M.value]: 1, [M.inverted]: false, [M.syncId]: newSyncId(), [M.id]: newMaskId(), [M.active]: true, [M.blend]: 0,
    [BRUSH.flow]: flow, [BRUSH.radius]: radius, [BRUSH.centerWeight]: 0, [BRUSH.dabs]: flow < 1 ? [`f ${flow.toFixed(4)}`, ...d] : d,
  };
}

/** A brush component's own fields: its Masks, one Paint per stroke. */
export function brushFields(strokes: readonly Stroke[] | undefined, frame: CropFrame): Record<string, unknown> {
  if (!Array.isArray(strokes) || strokes.length === 0 || strokes.length > BRUSH_LIMITS.strokes) invalid(`A brush needs geometry.strokes: 1 to ${BRUSH_LIMITS.strokes} strokes, each { points: [{x, y}, ...], radius?, flow? }.`);
  return { [BRUSH.masks]: (strokes as Stroke[]).map((s, k) => paint(s, frame, k)) };
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
