// `npm run masks:crop` (GitHub issue #179): does a mask the engine places in the preview's frame land where
// asked on a cropped, angled or turned photo? The pure parts: what is written (small strong radials at three
// preview points, the issue's A/B foreground gradient), where a radial's blob is in a render (sharp, a diff
// against the render without it), and the verdicts. The steps are mask-crop-run.ts; the CLI, which puts every
// photo back, is mask-crop-probe-cli.ts. Report: docs\reports\phase9\issue179.md.

import sharp from "sharp";
import type { MaskOp } from "../params/index.js";

export const HISTORY = "AVG masks:crop";
export const SNAPSHOT = "AVG masks:crop before";
/** Case B: the photo's own crop turned by this many degrees, inside Lightroom's +-45 [community] [handle: https://github.com/darktable-org/darktable/blob/62c225f304db5040c80da2ddd861a79e1587950f/src/develop/lightroom.c L1343, "limited to -45;+45 by LR"]. */
export const ANGLE_B = 10;
/** Where the radials go, in 0-1 of the preview; away from the edges, so an angled crop keeps them on the photo. */
export const POINTS = [{ x: 0.3, y: 0.35 }, { x: 0.65, y: 0.5 }, { x: 0.45, y: 0.7 }] as const;
/** A radial's box: twice as wide as tall, so a wrongly turned ellipse shows as a tilt. */
const HALF = { w: 0.05, h: 0.025 };
/** A blob within this distance of the point asked for, per axis, in 0-1 of the preview [inference: a few pixels of feathered blob, far under the issue's miss]. */
export const NEAR = 0.03;
/** The blob's long axis within this many degrees of the preview's horizontal [inference: a sign error in the radial's Angle would tilt it by 2 x 10]. */
export const LEVEL_DEG = 8;
/** The issue's A/B gradient: frame delta luma about -2 on the uncropped DNG; under 0.5 is the bug [handle: GitHub issue #179 "Evidence", sessions d4372429 and 4c9a8a79]. */
export const MIN_LINEAR_DELTA = 0.5;
export const READBACK_TOLERANCE = 1e-6;

export const radialOp = (p: { x: number; y: number }, n: number): Extract<MaskOp, { op: "create" }> => ({
  op: "create",
  kind: "radial",
  name: `${HISTORY} radial ${n}`,
  geometry: { left: p.x - HALF.w, top: p.y - HALF.h, right: p.x + HALF.w, bottom: p.y + HALF.h },
  sliders: { "local.exposure": 2 },
});
export const LINEAR_GEOMETRY = { zero: { x: 0.5, y: 0.64 }, full: { x: 0.5, y: 1 } };
export const linearOp: MaskOp = { op: "create", kind: "linear", name: `${HISTORY} foreground`, geometry: LINEAR_GEOMETRY, sliders: { "local.exposure": -0.25, "local.saturation": -10, "local.texture": -8 } };

export type Grey = { data: Uint8Array; width: number; height: number };
export const grey = async (jpeg: Buffer): Promise<Grey> => {
  const { data, info } = await sharp(jpeg).greyscale().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

export type Blob = { x: number; y: number; axis_deg: number; pixels: number; peak: number };
/** A blob's standard deviation, per axis, as a share of the render, above which it is scattered change, not one blob [inference: uniform scatter gives 0.29]. */
const MAX_SPREAD = 0.15;

/**
 * The brightened blob of `after` against `before` (same size): the pixels at least half the peak gain, weighted
 * by their gain; its centre in 0-1 of the render, and its long axis in degrees from horizontal (-90..90, y down).
 * Null when nothing brightened by 8 levels or more, the change is scattered (MAX_SPREAD), or the sizes differ.
 */
export function blobOf(before: Grey, after: Grey): Blob | null {
  if (before.width !== after.width || before.height !== after.height) return null;
  const { width, height } = after;
  let peak = 0;
  for (let i = 0; i < after.data.length; i++) peak = Math.max(peak, (after.data[i] as number) - (before.data[i] as number));
  if (peak < 8) return null;
  let [w, sx, sy] = [0, 0, 0];
  const kept: Array<[number, number, number]> = [];
  for (let i = 0; i < after.data.length; i++) {
    const d = (after.data[i] as number) - (before.data[i] as number);
    if (d < peak / 2) continue;
    const [x, y] = [(i % width) + 0.5, Math.floor(i / width) + 0.5];
    kept.push([x, y, d]);
    [w, sx, sy] = [w + d, sx + d * x, sy + d * y];
  }
  const [cx, cy] = [sx / w, sy / w];
  let [xx, yy, xy] = [0, 0, 0];
  for (const [x, y, d] of kept) [xx, yy, xy] = [xx + d * (x - cx) ** 2, yy + d * (y - cy) ** 2, xy + d * (x - cx) * (y - cy)];
  // Scattered pixels (noise, a render that changed all over) are no blob: a radial's spread is a few % of the frame.
  if (Math.max(Math.sqrt(xx / w) / width, Math.sqrt(yy / w) / height) > MAX_SPREAD) return null;
  const axis = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI;
  return { x: cx / width, y: cy / height, axis_deg: Math.round(axis * 10) / 10, pixels: kept.length, peak };
}

export type PointResult = { asked: { x: number; y: number }; blob: Blob | null; readback_ok: boolean; ok: boolean; why: string };

/** A radial is right when its blob is within NEAR of the point, level within LEVEL_DEG, and it read back as written. */
export function pointVerdict(asked: { x: number; y: number }, blob: Blob | null, readbackOk: boolean): PointResult {
  const problems: string[] = [];
  if (!blob) problems.push("no brightened blob in the render");
  else {
    const [dx, dy] = [blob.x - asked.x, blob.y - asked.y];
    if (Math.abs(dx) > NEAR || Math.abs(dy) > NEAR) problems.push(`blob at (${blob.x.toFixed(3)}, ${blob.y.toFixed(3)}), off by (${dx.toFixed(3)}, ${dy.toFixed(3)})`);
    if (Math.abs(blob.axis_deg) > LEVEL_DEG) problems.push(`blob tilted ${blob.axis_deg} degrees`);
  }
  if (!readbackOk) problems.push("lr_list_masks-style read-back differs from what was written");
  return { asked, blob, readback_ok: readbackOk, ok: problems.length === 0, why: problems.join("; ") || "on the point, level, read back as written" };
}

/** Whether two geometries (as summarized, preview frame) agree within READBACK_TOLERANCE, number by number. */
export function sameGeometry(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= READBACK_TOLERANCE;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const [x, y] = [a as Record<string, unknown>, b as Record<string, unknown>];
    return Object.keys(x).every((k) => sameGeometry(x[k], y[k]));
  }
  return a === b;
}

export type LinearResult = { delta_luma: number | null; readback_ok: boolean; ok: boolean; why: string };
export function linearVerdict(delta: number | null, readbackOk: boolean): LinearResult {
  const problems: string[] = [];
  if (delta === null) problems.push("not measured");
  else if (Math.abs(delta) < MIN_LINEAR_DELTA) problems.push(`frame delta luma ${delta.toFixed(3)}, under ${MIN_LINEAR_DELTA}: the gradient barely shows`);
  if (!readbackOk) problems.push("read-back differs from what was written");
  return { delta_luma: delta, readback_ok: readbackOk, ok: problems.length === 0, why: problems.join("; ") || `frame delta luma ${delta?.toFixed(3)}` };
}

type Frame = { left: number; top: number; right: number; bottom: number; angle: number };
export type PhotoResult = { filename: string; orientation: unknown; cases: Array<{ case: string; ok: boolean; frame?: Frame; error?: string }>; put_back?: { ok: boolean; why: string } };

const cropped = (f: Frame | undefined): boolean => !!f && (f.left !== 0 || f.top !== 0 || f.right !== 1 || f.bottom !== 1 || f.angle !== 0);
/** A photo Lightroom shows turned a quarter or half turn [community] [handle: https://community.adobe.com/questions-675/sdk-computing-the-corners-of-a-crop-rectangle-962108]. */
const turned = (o: unknown): boolean => o === "BC" || o === "CD" || o === "DA";

/** WORKED: every case of every photo passed, every photo put back, and the photos cover a cropped one and a turned (portrait) one. */
export function verdict(photos: readonly PhotoResult[]): { worked: boolean; lines: string[] } {
  const lines = photos.map((p) => `${p.filename} (orientation ${String(p.orientation)}): ${p.cases.map((c) => `case ${c.case} ${c.ok ? "PASS" : "FAIL"}`).join(", ")}; put back: ${p.put_back?.ok ? "YES" : "NO"}`);
  const missing = [
    ...(photos.some((p) => cropped(p.cases[0]?.frame)) ? [] : ["none of the selected photos is cropped: select one cropped in Lightroom"]),
    ...(photos.some((p) => turned(p.orientation)) ? [] : ["none of the selected photos is a portrait photo Lightroom turns (orientation BC, CD or DA): select one shot upright"]),
  ];
  const worked = photos.length > 0 && missing.length === 0 && photos.every((p) => p.cases.length === 2 && p.cases.every((c) => c.ok) && p.put_back?.ok === true);
  return { worked, lines: [...lines, ...missing] };
}

/** Each photo in turn into `results`, stopping at the first one not put back: the CLI's state.json then keeps that photo's record, for its line and the next run's put-back. */
export async function eachPhoto<T>(photos: readonly T[], one: (x: T) => Promise<PhotoResult>, results: PhotoResult[]): Promise<void> {
  for (const x of photos) {
    const r = await one(x);
    results.push(r);
    if (r.put_back?.ok !== true) return;
  }
}
