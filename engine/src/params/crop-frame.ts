// The crop frame (GitHub issue #179, fix option A [stated: Jim, 2026-10-18]): every point and box the mask
// tools take or report is in 0-1 of the preview the agent sees, the cropped photo shown upright, from its
// top-left; Lightroom stores mask geometry in 0-1 of the uncropped photo. This maps between the two from the
// photo's own crop settings, read on every call (the user may crop again meanwhile). The preview and its
// regions already are in the cropped frame [handle: engine\src\mcp\tools-context.ts regionPreview, "The export
// follows a Lightroom crop"; docs\reports\phase4\S7.md Numbers, item 3]. What the crop keys mean comes from
// third parties, none of it Adobe's (the research for issue #179, 2026-10-18):
//   - CropLeft/Top/Right/Bottom are fractions of the uncropped photo as stored, before its orientation, from
//     its top-left, y down [community] [handle: https://community.adobe.com/questions-675/sdk-computing-the-corners-of-a-crop-rectangle-962108];
//     at angle 0 on an "AB" photo the crop's pixel size matches them [handle: docs\reports\phase4\S7\
//     s7_run_2026-09-27T12-53-05.json `crop.size_after_crop`];
//   - with a CropAngle (degrees, clockwise positive) they are the top-left and bottom-right corners of the
//     turned rectangle, which turns about its own centre [community] [handle: the URL above;
//     https://github.com/storytold/lightcraft/pull/495, 223 straightened crops fitted to Lightroom's exports];
//   - mask geometry is in the same stored, uncropped frame [community] [handle: https://community.adobe.com/
//     feature-requests-676/p-correct-copying-of-crops-and-local-adjustments-664795], observed here on an
//     uncropped upright photo only [handle: docs\reports\phase6\masks-capture\check.json `8_geometry_plan`];
//   - orientation AB, BC, CD, DA shows the stored photo turned 0, 90, 180, 270 degrees clockwise [community]
//     [handle: the first URL; https://github.com/storytold/lightcraft/issues/483]; CD is [inference]. Automaat's
//     table of all eight codes agrees with UNTURN below on these four, from its own live check of every
//     orientation on LrC 15.6 (#331) [upstream claim: plugin/LightroomMCP.lrplugin/ImageFrame.lua:7-16, `git show
//     e1ca0c6`] (issue #210 cross-check, engine\tests\params-crop-frame-mirror.test.ts);
//   - the mirrored codes BA, DC, CB, AD come from that table only [upstream claim: the same lines]: the mapping is
//     here, but cropFrame refuses them (MIRROR_UNVERIFIED) until `npm run masks:verify` (issue #210); the check
//     lifts the refusal for its own writes (withMirrorMapping). How a crop angle reads on a mirrored photo is
//     [unverified].
// On a cropped, angled or turned photo all of this is [unverified] in Lightroom until `npm run masks:crop`
// (docs\reports\phase9\issue179.md). Key names from params\sdk-keys.lrc15.json (rule 03).

import type { SdkSettings } from "./map.js";
import { MaskError } from "./mask-table.js";

export type Point = { x: number; y: number };
export type Box = { left: number; top: number; right: number; bottom: number };
/** A radial's fields: the two opposite corners of its box turned by `angle` degrees about its centre (as a crop's) [community] [handle: https://github.com/skymanbp/autoshade/blob/5c1902eff2d1813f720fd94670da246426646bdd/docs/ARCHITECTURE.md L3332-3350]. */
export type Ellipse = Box & { angle: number };

export const CROP = { left: "CropLeft", top: "CropTop", right: "CropRight", bottom: "CropBottom", angle: "CropAngle", orientation: "orientation" } as const;

/** The mirrored orientation codes [upstream claim: Automaat ImageFrame.lua:9-15]. */
export const MIRRORED = ["BA", "DC", "CB", "AD"] as const;
const TURNS = ["AB", "BC", "CD", "DA", ...MIRRORED] as const;
type Turn = (typeof TURNS)[number];
/**
 * The preview's (p, q) -> the crop's own axes (u, v), and back [community] [handle: the first URL above;
 * https://github.com/storytold/lightcraft/issues/483]; CD is [inference]; the mirrored four [upstream claim: Automaat
 * ImageFrame.lua STORED_FROM_DISPLAYED], each its own inverse.
 */
const UNTURN: Record<Turn, (p: number, q: number) => [number, number]> = {
  AB: (p, q) => [p, q], BC: (p, q) => [q, 1 - p], CD: (p, q) => [1 - p, 1 - q], DA: (p, q) => [1 - q, p],
  BA: (p, q) => [1 - p, q], DC: (p, q) => [p, 1 - q], CB: (p, q) => [q, p], AD: (p, q) => [1 - q, 1 - p],
};
const TURN: Record<Turn, (u: number, v: number) => [number, number]> = {
  AB: (u, v) => [u, v], BC: (u, v) => [1 - v, u], CD: (u, v) => [1 - u, 1 - v], DA: (u, v) => [v, 1 - u],
  BA: (u, v) => [1 - u, v], DC: (u, v) => [u, 1 - v], CB: (u, v) => [v, u], AD: (u, v) => [1 - v, 1 - u],
};
const mirrorWhy = (o: string): string => `the photo is mirrored (orientation "${o}"), and where Lightroom puts mask geometry on a mirrored photo is not yet checked`;

/** `aspect`: getRawMetadata width / height (only a crop angle needs it); `refused`: why no geometry can be mapped on this photo, else null. */
export type CropFrame = Box & { angle: number; turn: Turn; aspect: number; refused: string | null };

export const IDENTITY: CropFrame = { left: 0, top: 0, right: 1, bottom: 1, angle: 0, turn: "AB", aspect: 1, refused: null };
export const isIdentity = (f: CropFrame): boolean =>
  f.refused === null && f.turn === "AB" && f.angle === 0 && f.left === 0 && f.top === 0 && f.right === 1 && f.bottom === 1;

const num = (sdk: SdkSettings, key: string, fallback: number): number => {
  const v = sdk[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

/** Whether the frame of `sdk` needs the photo's pixel size: a crop angle other than 0. */
export const needsSize = (sdk: SdkSettings): boolean => num(sdk, CROP.angle, 0) !== 0;

/**
 * The crop frame of a photo from its develop settings; `size` (getRawMetadata width/height) when needsSize.
 * Its width / height is the aspect as it comes, not swapped for a quarter turn: on a photo turned BC with a
 * 10-degree crop, the swapped aspect put radials off by up to 0.04 and the unswapped one predicts all three
 * blobs within 0.001 [handle: Jim's masks:crop run %TEMP%\LrC-AVG\masks-crop\mask_crop_2026-10-18T20-49-52-931Z.json,
 * IMG_1595.JPG case B]; DA is the same by symmetry [inference]. A missing key
 * reads as uncropped, and a missing orientation as "AB" [inference: every recorded dump carries it,
 * params\sdk-keys.lrc15.json `orientation`; the Lightroom simulator leaves it out].
 */
export function cropFrame(sdk: SdkSettings, size: { width: number; height: number } | null): CropFrame {
  const base = { left: num(sdk, CROP.left, 0), top: num(sdk, CROP.top, 0), right: num(sdk, CROP.right, 1), bottom: num(sdk, CROP.bottom, 1), angle: num(sdk, CROP.angle, 0), aspect: 1 };
  const o = sdk[CROP.orientation] ?? "AB";
  const refuse = (why: string): CropFrame => ({ ...base, turn: "AB", refused: why });
  if (!(TURNS as readonly unknown[]).includes(o)) return refuse(`the photo's orientation is "${String(o)}", an unknown one`);
  const turn = o as Turn;
  let aspect = 1;
  if (base.angle !== 0) {
    if (!size || !(size.width > 0 && size.height > 0)) return refuse("the photo has a crop angle and its pixel size is not known");
    aspect = size.width / size.height;
  }
  const f: CropFrame = { ...base, turn, aspect, refused: null };
  const b = basis(f);
  if (!(b.ws > 0 && b.hs > 0)) return refuse(`its crop (left ${f.left}, top ${f.top}, right ${f.right}, bottom ${f.bottom}, angle ${f.angle}) is empty`);
  return (MIRRORED as readonly string[]).includes(turn) ? { ...f, refused: mirrorWhy(turn) } : f;
}

/** `f` with a mirrored photo's refusal lifted, for `npm run masks:verify` only (issue #210); any other frame as is. */
export const withMirrorMapping = (f: CropFrame): CropFrame => (f.refused !== null && f.refused === mirrorWhy(f.turn) ? { ...f, refused: null } : f);

/** The crop in stored pixels with width `k` = aspect and height 1: its top-left corner, its sides and its axes. */
function basis(f: CropFrame): { x0: number; y0: number; ws: number; hs: number; c: number; s: number; k: number } {
  const k = f.aspect;
  const th = (f.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(th), Math.sin(th)];
  const [dx, dy] = [(f.right - f.left) * k, f.bottom - f.top];
  return { x0: f.left * k, y0: f.top, ws: dx * c + dy * s, hs: -dx * s + dy * c, c, s, k };
}

function usable(f: CropFrame): void {
  if (f.refused) throw new MaskError("CROP_FRAME_UNSUPPORTED", `Nothing was written: mask geometry and points cannot be placed on this photo because ${f.refused}. AI masks without a point still work.`, { why: f.refused });
}

/** A point of the preview -> 0-1 of the uncropped stored photo. */
export function toPhoto(f: CropFrame, p: Point): Point {
  usable(f);
  if (isIdentity(f)) return { x: p.x, y: p.y };
  const b = basis(f);
  const [u, v] = UNTURN[f.turn](p.x, p.y);
  return { x: (b.x0 + u * b.ws * b.c - v * b.hs * b.s) / b.k, y: b.y0 + u * b.ws * b.s + v * b.hs * b.c };
}

/** A point of the uncropped stored photo -> 0-1 of the preview (outside 0-1 when it lies outside the crop). */
export function toView(f: CropFrame, p: Point): Point {
  usable(f);
  if (isIdentity(f)) return { x: p.x, y: p.y };
  const b = basis(f);
  const [rx, ry] = [p.x * b.k - b.x0, p.y - b.y0];
  const [x, y] = TURN[f.turn]((rx * b.c + ry * b.s) / b.ws, (-rx * b.s + ry * b.c) / b.hs);
  return { x, y };
}

const EPS = 1e-9;
/** toPhoto, refused when it lands outside the photo (a crop reaching past it), clamped within EPS. */
export function photoPoint(f: CropFrame, p: Point, what: string): Point {
  const q = toPhoto(f, p);
  for (const v of [q.x, q.y]) {
    if (!(v >= -EPS && v <= 1 + EPS)) throw new MaskError("INVALID_ARGUMENTS", `${what} (${p.x}, ${p.y}) lies outside the uncropped photo once mapped through the photo's crop.`, { what, point: p });
  }
  const clamp = (v: number): number => Math.min(1, Math.max(0, v));
  return { x: clamp(q.x), y: clamp(q.y) };
}

const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;

/**
 * A box of the preview, as the ellipse square to the preview it holds, -> a radial's fields in the photo:
 * the box's axes turned with the crop, so `angle` is the crop's [inference: the radial's Angle has the
 * crop's sense, per the autoshade URL above; [unverified] in Lightroom]. Refused when a corner lands
 * outside the photo.
 */
export function boxToRadial(f: CropFrame, box: Box): Ellipse {
  usable(f);
  if (isIdentity(f)) return { ...box, angle: 0 };
  const k = f.aspect;
  const at = (p: Point): Point => {
    const q = toPhoto(f, p);
    return { x: q.x * k, y: q.y };
  };
  const cv = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
  const c = at(cv);
  const [ax, bx] = [sub(at({ x: box.right, y: cv.y }), c), sub(at({ x: cv.x, y: box.bottom }), c)];
  const th = (f.angle * Math.PI) / 180;
  const [ex, ey] = [{ x: Math.cos(th), y: Math.sin(th) }, { x: -Math.sin(th), y: Math.cos(th) }];
  const a = Math.abs(dot(ax, ex)) + Math.abs(dot(bx, ex));
  const b = Math.abs(dot(ax, ey)) + Math.abs(dot(bx, ey));
  const d = { x: a * ex.x + b * ey.x, y: a * ex.y + b * ey.y };
  const p0 = photoPoint(IDENTITY, { x: (c.x - d.x) / k, y: c.y - d.y }, "the radial's box");
  const p1 = photoPoint(IDENTITY, { x: (c.x + d.x) / k, y: c.y + d.y }, "the radial's box");
  return { left: p0.x, top: p0.y, right: p1.x, bottom: p1.y, angle: f.angle };
}

/**
 * A radial's fields in the photo -> the box of the preview that holds its ellipse (exact for one boxToRadial
 * wrote). A radial turned other than the crop is boxed with the frame's aspect, 1 on a crop without an angle:
 * whether Lightroom turns it in pixels or in 0-1 is [unverified].
 */
export function radialToBox(f: CropFrame, e: Ellipse): Box {
  if (isIdentity(f) && e.angle === 0) return { left: e.left, top: e.top, right: e.right, bottom: e.bottom };
  const k = f.aspect;
  const th = (e.angle * Math.PI) / 180;
  const [c, s] = [Math.cos(th), Math.sin(th)];
  const [X, Y] = [((e.right - e.left) / 2) * k, (e.bottom - e.top) / 2];
  const [a, b] = [X * c + Y * s, -X * s + Y * c];
  const centre = { x: (e.left + e.right) / 2, y: (e.top + e.bottom) / 2 };
  const cv = toView(f, centre);
  const u = sub(toView(f, { x: centre.x + (a * c) / k, y: centre.y + a * s }), cv);
  const v = sub(toView(f, { x: centre.x - (b * s) / k, y: centre.y + b * c }), cv);
  const [hx, hy] = [Math.hypot(u.x, v.x), Math.hypot(u.y, v.y)];
  return { left: cv.x - hx, top: cv.y - hy, right: cv.x + hx, bottom: cv.y + hy };
}

/** A box of the photo, square to it (a person's InstanceBounds), -> the preview's box that holds it. */
export function boxToView(f: CropFrame, box: Box): Box {
  const ps = [{ x: box.left, y: box.top }, { x: box.right, y: box.top }, { x: box.right, y: box.bottom }, { x: box.left, y: box.bottom }].map((p) => toView(f, p));
  const xs = ps.map((p) => p.x);
  const ys = ps.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

// lr_crop (GitHub issue #115): a crop asked for in 0-1 of the photo shown upright and uncropped, as the five keys,
// and the photo's crop described in that frame. The inverse of cropFrame's model above (the keys are the turned
// rectangle's top-left and bottom-right corners), which predicts the straightened render of crop:spike run 2
// (k 1024/683, corners 0.1/0.9/0.2/0.8, angle 5: 2.5288 against the render's 1024/405 = 2.5284) [handle:
// docs\reports\phase11\CROP-SPIKE.md "Observed", run 2; tests\params-crop-settings.test.ts]. On a quarter-turned
// photo it is [unverified] in Lightroom (crop:check uses one landscape raw).

export type UprightBox = { x: number; y: number; w: number; h: number };
/** `aspect`: "original" or "W:H" (the largest such box centred in `box`); `angle`: degrees, clockwise positive. */
export type CropRequest = { box?: UprightBox | undefined; aspect?: string | undefined; angle?: number | undefined; reset?: boolean | undefined };
/** A crop in the upright, uncropped frame: its box before the turn, the turn, and its width / height in pixels. */
export type CropView = { box: UprightBox; angle: number; aspect: number };
type Size = { width: number; height: number };

export const NO_CROP: Readonly<Record<string, number>> = { [CROP.left]: 0, [CROP.top]: 0, [CROP.right]: 1, [CROP.bottom]: 1, [CROP.angle]: 0 };
/** The five crop keys of `sdk`, a missing one read as uncropped. */
export const cropKeys = (sdk: SdkSettings): Record<string, number> => Object.fromEntries(Object.entries(NO_CROP).map(([k, v]) => [k, num(sdk, k, v)]));
/** Whether two photos' crops differ by more than `eps` on any of the five keys. */
export const cropDiffers = (a: SdkSettings, b: SdkSettings, eps = 1e-4): boolean => {
  const [x, y] = [cropKeys(a), cropKeys(b)];
  return Object.keys(NO_CROP).some((k) => Math.abs((x[k] ?? 0) - (y[k] ?? 0)) > eps);
};

/** The upright photo's width and height, its stored height being 1 (a quarter turn swaps them). */
const uprightSize = (f: CropFrame, size: Size): [number, number] => {
  const k = size.width / size.height;
  return f.turn === "BC" || f.turn === "DA" ? [1, k] : [k, 1];
};

function cropUsable(f: CropFrame): void {
  if (f.refused) throw new MaskError("CROP_FRAME_UNSUPPORTED", `Nothing was written: lr_crop cannot place a crop on this photo because ${f.refused}.`, { why: f.refused });
}

const bad = (why: string): MaskError => new MaskError("INVALID_ARGUMENTS", `Nothing was written: ${why}.`, { why });
function ratioOf(aspect: string, original: number): number {
  if (aspect === "original") return original;
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(aspect);
  const r = m ? Number(m[1]) / Number(m[2]) : NaN;
  if (!(r > 0 && Number.isFinite(r))) throw bad(`aspect "${aspect}" is not "original" or "W:H" with W and H above 0`);
  return r;
}

/**
 * The crop keys for `req` on a photo of frame `f` (its orientation) and pixel size `size` (get_context: the stored
 * size, not swapped for a quarter turn, as cropFrame takes it). With an angle the box shrinks about its centre
 * until the turned box lies inside the photo, with 0.1 % to spare [inference: for Lightroom's rounding].
 */
export function cropSettings(req: CropRequest, f: CropFrame, size: Size): SdkSettings {
  cropUsable(f);
  if (req.reset) {
    if (req.box !== undefined || req.aspect !== undefined || req.angle !== undefined) throw bad("reset takes no box, aspect or angle");
    return { ...NO_CROP };
  }
  const [W, H] = uprightSize(f, size);
  const b = req.box ?? { x: 0, y: 0, w: 1, h: 1 };
  if (!(b.w > 0 && b.h > 0 && b.x >= 0 && b.y >= 0 && b.x + b.w <= 1 + EPS && b.y + b.h <= 1 + EPS)) throw bad("the box must lie within 0-1 of the photo, w and h above 0");
  const angle = req.angle ?? 0;
  if (!(Math.abs(angle) <= 45)) throw bad("the angle must be -45 to 45 degrees");
  let [cw, ch] = [b.w * W, b.h * H];
  const [cx, cy] = [(b.x + b.w / 2) * W, (b.y + b.h / 2) * H];
  if (req.aspect !== undefined) {
    const r = ratioOf(req.aspect, W / H);
    if (cw / ch > r) cw = ch * r;
    else ch = cw / r;
  }
  const th = (angle * Math.PI) / 180;
  const [c, s] = [Math.cos(th), Math.sin(th)];
  const [ex, ey] = [(cw * Math.abs(c) + ch * Math.abs(s)) / 2, (cw * Math.abs(s) + ch * Math.abs(c)) / 2];
  const m = Math.min(cx / ex, (W - cx) / ex, cy / ey, (H - cy) / ey);
  const fit = m >= 1 - 1e-12 ? 1 : 0.999 * m;
  [cw, ch] = [cw * fit, ch * fit];
  // A point (u, v) of the crop's own axes -> the preview -> the upright photo -> 0-1 of the stored photo.
  const at = (u: number, v: number): [number, number] => {
    const [p, q] = TURN[f.turn](u, v);
    const [X, Y] = [(p - 0.5) * cw, (q - 0.5) * ch];
    return UNTURN[f.turn]((cx + X * c - Y * s) / W, (cy + X * s + Y * c) / H);
  };
  const [tl, br] = [at(0, 0), at(1, 1)];
  return { [CROP.left]: tl[0], [CROP.top]: tl[1], [CROP.right]: br[0], [CROP.bottom]: br[1], [CROP.angle]: angle };
}

const r6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** The crop of frame `f` in the upright, uncropped frame, to 6 decimals (cropSettings' inverse, an aspect's fit aside). */
export function cropView(f: CropFrame, size: Size): CropView {
  cropUsable(f);
  const [W, H] = uprightSize(f, size);
  const up = (p: Point): Point => {
    const q = toPhoto(f, p);
    const [P, Q] = TURN[f.turn](q.x, q.y);
    return { x: P * W, y: Q * H };
  };
  const [a, b, c] = [up({ x: 0, y: 0 }), up({ x: 1, y: 0 }), up({ x: 0, y: 1 })];
  const [w, h] = [Math.hypot(b.x - a.x, b.y - a.y), Math.hypot(c.x - a.x, c.y - a.y)];
  const [cx, cy] = [(b.x + c.x) / 2, (b.y + c.y) / 2];
  return { box: { x: r6((cx - w / 2) / W), y: r6((cy - h / 2) / H), w: r6(w / W), h: r6(h / H) }, angle: f.angle, aspect: r6(w / h) };
}
