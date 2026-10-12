// One component of each kind and its geometry fields (GitHub issue #59, PR C step 2), shared by a new mask
// (mask-ops.ts newCorrection) and a part added to a mask (mask-combine.ts, issue #131). Moved out of
// mask-ops.ts in issue #131 so mask-combine.ts can build parts without an import cycle (module size, rule 01).
// Field names come only from mask-table.ts (rule 03).

import { AI_KINDS, IMAGE, LINEAR, M, MaskError, RADIAL, RANGE, WHAT, isAiKind, newMaskId, newSyncId, type Component, type MaskKind } from "./mask-table.js";
import { personFields } from "./mask-person.js";

export type Point = { x: number; y: number };
/**
 * Image-normalised 0-1 coordinates from the top-left of the uncropped photo [handle:
 * docs\reports\phase6\masks-capture\check.json `8_geometry_plan`; Jim's y, y]; on a cropped or rotated
 * photo the frame is [unverified].
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
};

export const unit = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new MaskError("INVALID_ARGUMENTS", `${what} must be a number in 0-1 of the image.`);
  return v;
};

/** The geometry fields to write into a component of `kind`, checked; `old`: the component's current ones (an edit). */
export function geometryFields(kind: string, g: Geometry, old: Component | null): Record<string, unknown> {
  const has = (k: keyof Geometry): boolean => g[k] !== undefined;
  const refuse = (msg: string): never => {
    throw new MaskError("INVALID_ARGUMENTS", msg);
  };
  if (kind === "linear") {
    if (!old && !(g.zero && g.full)) refuse("A linear gradient needs geometry.zero and geometry.full ({x, y} in 0-1).");
    const out: Record<string, unknown> = {};
    if (g.zero) Object.assign(out, { [LINEAR.zeroX]: unit(g.zero.x, "zero.x"), [LINEAR.zeroY]: unit(g.zero.y, "zero.y") });
    if (g.full) Object.assign(out, { [LINEAR.fullX]: unit(g.full.x, "full.x"), [LINEAR.fullY]: unit(g.full.y, "full.y") });
    return out;
  }
  if (kind === "radial") {
    const sides = ["left", "top", "right", "bottom"] as const;
    if (!old && !sides.every(has)) refuse("A radial gradient needs geometry.left, top, right and bottom (0-1).");
    const v = (k: (typeof sides)[number], field: string): number => (g[k] !== undefined ? unit(g[k], k) : (old?.[field] as number));
    const box = { left: v("left", RADIAL.left), top: v("top", RADIAL.top), right: v("right", RADIAL.right), bottom: v("bottom", RADIAL.bottom) };
    if (!(box.left < box.right && box.top < box.bottom)) refuse("A radial gradient needs left < right and top < bottom.");
    const out: Record<string, unknown> = { [RADIAL.left]: box.left, [RADIAL.top]: box.top, [RADIAL.right]: box.right, [RADIAL.bottom]: box.bottom };
    if (has("feather")) out[RADIAL.feather] = feather(g.feather);
    return out;
  }
  if (kind === "luminance") {
    const r = g.lum_range;
    if (!r || r.length !== 4 || r.some((x, i) => unit(x, `lum_range[${i}]`) < (i > 0 ? (r[i - 1] as number) : 0))) refuse("lum_range needs 4 numbers in 0-1, each at least the one before.");
    return { [RANGE.holder]: { ...((old?.[RANGE.holder] as object | undefined) ?? rangeTemplate()), [RANGE.lumRange]: (r as number[]).map((x) => x.toFixed(6)).join(" ") } };
  }
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
export function newComponent(kind: MaskKind, name: string, g: Geometry, point: Point | null): Component {
  const base: Component = { [M.id]: newMaskId(), [M.syncId]: newSyncId(), [M.name]: name, [M.active]: true, [M.inverted]: false, [M.blend]: 0, [M.value]: 1 };
  if (isAiKind(kind)) {
    const at = point ?? { x: 0.5, y: 0.5 };
    // One person's kinds start as the probe, Entire Person of instance 0 (mask-person.ts); the pass then writes the kind itself.
    const fields = AI_KINDS[kind].point ? personFields("person_entire", 0) : AI_KINDS[kind].fields;
    return { ...base, [M.what]: WHAT.image, ...fields, [IMAGE.referencePoint]: `${at.x.toFixed(6)} ${at.y.toFixed(6)}`, [IMAGE.errorReason]: 0 };
  }
  const what = kind === "linear" ? WHAT.linear : kind === "radial" ? WHAT.radial : WHAT.range;
  const fixed = kind === "radial" ? { [RADIAL.angle]: 0, [RADIAL.feather]: 50, [RADIAL.midpoint]: 50, [RADIAL.roundness]: 0, [RADIAL.flipped]: true, [RADIAL.version]: 2 } : {};
  return { ...base, [M.what]: what, ...fixed, ...geometryFields(kind, g, null) };
}

/** Kinds Claude may ask for that are refused, each with its reason (the reasons are [inference]). */
export const REFUSED_KINDS: Readonly<Record<string, string>> = {
  people: "name the part: people_<part> for every person in the photo (people_face_skin, people_hair, ...), or person_entire / person_face_skin with a point on one person",
  landscape: "name the category: landscape_<category> (landscape_sky, landscape_vegetation, landscape_water, ...), one mask each",
  brush: "brush painting needs strokes, which the mask table cannot be given",
  objects: "Select Objects needs a stroke or a box drawn in Lightroom",
  color_range: "colour range needs a colour sampled on the photo in Lightroom",
  depth_range: "depth range needs depth data sampled in Lightroom",
};

const KINDS: readonly MaskKind[] = ["linear", "radial", "luminance", ...(Object.keys(AI_KINDS) as MaskKind[])];

/** The kind asked for, or why it is refused. */
export function checkKind(kind: string): MaskKind {
  if ((KINDS as readonly string[]).includes(kind)) return kind as MaskKind;
  const why = REFUSED_KINDS[kind];
  throw new MaskError("MASK_KIND_NOT_SUPPORTED", why ? `A ${kind} mask is not offered: ${why}.` : `Unknown mask kind "${kind}" (kinds: ${KINDS.join(", ")}).`, { kind });
}
