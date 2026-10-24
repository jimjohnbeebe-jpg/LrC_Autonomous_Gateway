// One component of each kind and its geometry fields (GitHub issue #59, PR C step 2), shared by a new mask
// (mask-ops.ts newCorrection) and a part added to a mask (mask-combine.ts, issue #131). Moved out of
// mask-ops.ts in issue #131 so mask-combine.ts can build parts without an import cycle (module size, rule 01).
// Field names come only from mask-table.ts (rule 03).

import { IDENTITY, boxToRadial, photoPoint, radialToBox, type CropFrame, type Point } from "./crop-frame.js";
import { AI_KINDS, IMAGE, LINEAR, M, MaskError, RADIAL, RANGE, WHAT, isAiKind, newMaskId, newSyncId, type Component, type MaskKind } from "./mask-table.js";
import { brushFields, type Stroke } from "./mask-brush.js";
import { personFields } from "./mask-person.js";
import { colorFields, depthFields, trapezoid, type Rgb } from "./mask-range.js";

export type { Point } from "./crop-frame.js";
/**
 * 0-1 coordinates of the preview the agent sees (the cropped photo, upright), from its top-left; written
 * in 0-1 of the uncropped photo through the photo's crop frame (crop-frame.ts, issue #179). On an
 * uncropped upright photo the two are one [handle: docs\reports\phase6\masks-capture\check.json
 * `8_geometry_plan`; Jim's y, y]; on a cropped, angled or turned photo the mapping is [unverified].
 */
export type Geometry = {
  zero?: Point | undefined;
  full?: Point | undefined;
  left?: number | undefined;
  top?: number | undefined;
  right?: number | undefined;
  bottom?: number | undefined;
  feather?: number | undefined;
  lum_range?: number[] | undefined;
  /** depth_range: as lum_range, in distances (0 the nearest). */
  depth_range?: number[] | undefined;
  /** color_range: how far the selection reaches from the sampled colour, above 0 to 1 (Lightroom's Refine). */
  color_amount?: number | undefined;
  strokes?: Stroke[] | undefined;
  /** color_range, set by the engine (session\masks.ts): the preview's colour at the point, 0-1. */
  sample?: Rgb | undefined;
};

export const unit = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new MaskError("INVALID_ARGUMENTS", `${what} must be a number in 0-1 of the image.`);
  return v;
};

/** A radial component's fields as crop-frame.ts reads them (Angle 0 when absent). */
export const ellipseOf = (m: Component): { left: number; top: number; right: number; bottom: number; angle: number } => ({
  left: Number(m[RADIAL.left]), top: Number(m[RADIAL.top]), right: Number(m[RADIAL.right]), bottom: Number(m[RADIAL.bottom]), angle: Number(m[RADIAL.angle] ?? 0),
});

/**
 * The geometry fields to write into a component of `kind`, checked; `old`: the component's current ones (an
 * edit). `g` is in the preview's frame and is written through `frame` (issue #179); a radial is written
 * square to the preview, its Angle the crop's (crop-frame.ts boxToRadial).
 */
export function geometryFields(kind: string, g: Geometry, old: Component | null, frame: CropFrame = IDENTITY): Record<string, unknown> {
  const has = (k: keyof Geometry): boolean => g[k] !== undefined;
  const refuse = (msg: string): never => {
    throw new MaskError("INVALID_ARGUMENTS", msg);
  };
  if (kind === "linear") {
    if (!old && !(g.zero && g.full)) refuse("A linear gradient needs geometry.zero and geometry.full ({x, y} in 0-1).");
    const out: Record<string, unknown> = {};
    const at = (p: Point, what: string): Point => photoPoint(frame, { x: unit(p.x, `${what}.x`), y: unit(p.y, `${what}.y`) }, `geometry.${what}`);
    if (g.zero) {
      const p = at(g.zero, "zero");
      Object.assign(out, { [LINEAR.zeroX]: p.x, [LINEAR.zeroY]: p.y });
    }
    if (g.full) {
      const p = at(g.full, "full");
      Object.assign(out, { [LINEAR.fullX]: p.x, [LINEAR.fullY]: p.y });
    }
    return out;
  }
  if (kind === "radial") {
    const sides = ["left", "top", "right", "bottom"] as const;
    const given = sides.filter(has).length;
    if (!old && given < 4) refuse("A radial gradient needs geometry.left, top, right and bottom (0-1).");
    const out: Record<string, unknown> = has("feather") ? { [RADIAL.feather]: feather(g.feather) } : {};
    if (given === 0) return out; // feather only: the ellipse stays as it is, its Angle included
    // A box of the preview holds an ellipse square to it: one side of a radial turned otherwise cannot move alone.
    const turned = old && given < 4 && !frame.refused ? ellipseOf(old).angle - frame.angle : 0;
    if (Math.abs(turned) > 1e-6) refuse(`This radial is turned ${Math.round(turned * 100) / 100} degrees to the preview, so one side cannot move alone: give left, top, right and bottom (it is then written square to the preview), or only feather.`);
    const was = old && given < 4 ? radialToBox(frame, ellipseOf(old)) : null;
    const v = (k: (typeof sides)[number]): number => (g[k] !== undefined ? unit(g[k], k) : (was?.[k] as number));
    const box = { left: v("left"), top: v("top"), right: v("right"), bottom: v("bottom") };
    if (!(box.left < box.right && box.top < box.bottom)) refuse("A radial gradient needs left < right and top < bottom.");
    const e = boxToRadial(frame, box);
    return { [RADIAL.left]: e.left, [RADIAL.top]: e.top, [RADIAL.right]: e.right, [RADIAL.bottom]: e.bottom, [RADIAL.angle]: e.angle, ...out };
  }
  if (kind === "luminance") {
    return { [RANGE.holder]: { ...((old?.[RANGE.holder] as object | undefined) ?? rangeTemplate()), [RANGE.lumRange]: trapezoid(g.lum_range, "lum_range") } };
  }
  if (kind === "color_range" || kind === "depth_range" || kind === "brush") refuse(`A ${kind} mask is not reshaped: delete it and create it again.`);
  return refuse(`A ${kind} mask has no geometry to set.`);
}

function feather(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) throw new MaskError("INVALID_ARGUMENTS", "geometry.feather must be 0-100.");
  return v;
}

/**
 * The captured luminance range's fixed fields; the sample point at the photo's centre is [inference]. A
 * luminance entry made by the engine (not by Lightroom's own sampling) is [unverified] until Jim's mask
 * tools check creates one.
 */
const rangeTemplate = (): Record<string, unknown> => ({ [RANGE.type]: 2, [RANGE.version]: 3, [RANGE.sampleType]: 0, [RANGE.sampleInfo]: "0 0.500000 0.500000", [RANGE.invert]: false });

/**
 * One component of a new correction, as captured for its kind (radial: 3_dump-1.json entry 1; feather
 * 50 is [inference]). An AI kind in Adobe's form: its AI_KINDS fields, ReferencePoint (a person's point,
 * else the centre), written "x y" with 6 decimals as Lightroom writes it ("0.539062 0.650000",
 * capture3-templates.json), and ErrorReason 0. The ids (MaskID here, CorrectionID in newCorrection) are
 * not in Adobe's presets, but the engine needs them to find the entry again, and Lightroom kept the
 * ids written in captures 1-3 [handle: docs\reports\phase6\masks-capture\capture3-4_landscape_1.json `written` and `after_write`
 * CorrectionID, MaskID].
 */
export function newComponent(kind: MaskKind, name: string, g: Geometry, point: Point | null, frame: CropFrame = IDENTITY): Component {
  const base: Component = { [M.id]: newMaskId(), [M.syncId]: newSyncId(), [M.name]: name, [M.active]: true, [M.inverted]: false, [M.blend]: 0, [M.value]: 1 };
  if (isAiKind(kind)) {
    const at = point ?? { x: 0.5, y: 0.5 };
    // One person's kinds start as the probe, Entire Person of instance 0 (mask-person.ts); the pass then writes the kind itself.
    const fields = AI_KINDS[kind].point ? personFields("person_entire", 0) : AI_KINDS[kind].fields;
    return { ...base, [M.what]: WHAT.image, ...fields, [IMAGE.referencePoint]: `${at.x.toFixed(6)} ${at.y.toFixed(6)}`, [IMAGE.errorReason]: 0 };
  }
  if (kind === "brush") return { ...base, [M.what]: WHAT.aggregate, ...brushFields(g.strokes, frame) };
  if (kind === "color_range") return { ...base, [M.what]: WHAT.range, ...colorFields(g.sample ?? [0, 0, 0], point ?? { x: 0.5, y: 0.5 }, g.color_amount) };
  if (kind === "depth_range") return { ...base, [M.what]: WHAT.range, ...depthFields(g.depth_range) };
  const what = kind === "linear" ? WHAT.linear : kind === "radial" ? WHAT.radial : WHAT.range;
  const fixed = kind === "radial" ? { [RADIAL.angle]: 0, [RADIAL.feather]: 50, [RADIAL.midpoint]: 50, [RADIAL.roundness]: 0, [RADIAL.flipped]: true, [RADIAL.version]: 2 } : {};
  return { ...base, [M.what]: what, ...fixed, ...geometryFields(kind, g, null, frame) };
}

/** Kinds Claude may ask for that are refused, each with its reason (the reasons are [inference]). */
export const REFUSED_KINDS: Readonly<Record<string, string>> = {
  people: "name the part: people_<part> for every person in the photo (people_face_skin, people_hair, ...), or person_entire / person_face_skin with a point on one person",
  landscape: "name the category: landscape_<category> (landscape_sky, landscape_vegetation, landscape_water, ...), one mask each",
  objects: "Select Objects needs a stroke or a box drawn in Lightroom",
};

const KINDS: readonly MaskKind[] = ["linear", "radial", "luminance", "color_range", "depth_range", "brush", ...(Object.keys(AI_KINDS) as MaskKind[])];

/** The kind asked for, or why it is refused. */
export function checkKind(kind: string): MaskKind {
  if ((KINDS as readonly string[]).includes(kind)) return kind as MaskKind;
  const why = REFUSED_KINDS[kind];
  throw new MaskError("MASK_KIND_NOT_SUPPORTED", why ? `A ${kind} mask is not offered: ${why}.` : `Unknown mask kind "${kind}" (kinds: ${KINDS.join(", ")}).`, { kind });
}
