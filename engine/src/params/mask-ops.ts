// Mask operations on the table (GitHub issue #59, PR C step 2), pure: summaries in panel units, a new
// correction of each kind, and create / edit / delete applied to a copy of the corrections. Field names
// come only from mask-table.ts (rule 03). A new entry is built in the captured shape: every correction
// field the captures show, its sliders at 0 but those asked for, and one component of its kind
// [handle: docs\reports\phase6\masks-capture\3_dump-1.json]. Combining components (add, subtract,
// intersect), inverting a mask of several components, and the kinds below are refused with a reason:
// the captures saw only single-component masks, each with MaskBlendMode 0. A person's mask is placed by
// a point on the person (its ReferencePoint, as both captured people masks carry one [handle:
// docs\reports\phase6\masks-capture\capture3-templates.json]).

import {
  AI_KINDS,
  C,
  CARRIED,
  CORRECTION,
  IMAGE,
  KIND_LABELS,
  LINEAR,
  LOCAL_PARAMS,
  M,
  MASK_TABLE_KEY,
  MaskError,
  RADIAL,
  RANGE,
  WHAT,
  summarize,
  componentKind,
  components,
  isAiKind,
  newMaskId,
  newSyncId,
  type Component,
  type Correction,
  type MaskKind,
  type MaskSummary,
} from "./mask-table.js";

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
export type MaskOp =
  | { op: "create"; kind: string; name?: string | undefined; geometry?: Geometry | undefined; point?: Point | undefined; sliders?: Record<string, number> | undefined }
  | {
      op: "edit";
      mask_id: string;
      name?: string | undefined;
      active?: boolean | undefined;
      inverted?: boolean | undefined;
      geometry?: Geometry | undefined;
      sliders?: Record<string, number> | undefined;
      combine?: { mode: string } | undefined;
    }
  | { op: "delete"; mask_id: string };

export type OpResult = { entries: Correction[]; id: string; kind: string; before: MaskSummary | null; after: MaskSummary | null };

/** Kinds Claude may ask for that are refused, each with its reason (none was captured; the reasons are [inference]). */
export const REFUSED_KINDS: Readonly<Record<string, string>> = {
  people: "name the part: people_entire or people_face_skin, with the person's point (other parts were not captured on this Lightroom yet)",
  landscape: "name the category: landscape_vegetation or landscape_sky (other categories were not captured on this Lightroom yet)",
  brush: "brush painting needs strokes, which the mask table cannot be given",
  objects: "Select Objects needs a stroke or a box drawn in Lightroom",
  color_range: "colour range needs a colour sampled on the photo in Lightroom",
  depth_range: "depth range needs depth data sampled in Lightroom",
};
const COMBINE_REFUSED = "combining components (add, subtract, intersect) was not captured: every captured mask has one component, with MaskBlendMode 0";


/** Panel values -> stored fields; unknown names and values outside the panel's range are refused. */
export function storedSliders(sliders: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [name, value] of Object.entries(sliders)) {
    const p = LOCAL_PARAMS.get(name);
    if (!p) throw new MaskError("UNKNOWN_PARAMETER", `Unknown local slider "${name}" (local sliders: ${[...LOCAL_PARAMS.keys()].join(", ")}).`, { parameter: name });
    if (!Number.isFinite(value) || value < p.min || value > p.max) throw new MaskError("OUT_OF_RANGE", `${name} = ${value} is outside ${p.min}..${p.max}.`, { parameter: name });
    out[p.field] = value / p.scale;
  }
  return out;
}

const unit = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1) throw new MaskError("INVALID_ARGUMENTS", `${what} must be a number in 0-1 of the image.`);
  return v;
};

/** The geometry fields to write into a component of `kind`, checked; `old`: the component's current ones (an edit). */
function geometryFields(kind: string, g: Geometry, old: Component | null): Record<string, unknown> {
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

/** The captured luminance range's fixed fields; the sample point at the photo's centre is [inference]. */
const rangeTemplate = (): Record<string, unknown> => ({ [RANGE.type]: 2, [RANGE.version]: 3, [RANGE.sampleType]: 0, [RANGE.sampleInfo]: "0 0.500000 0.500000", [RANGE.invert]: false });

/**
 * One component of a new correction, as captured for its kind (radial: 3_dump-1.json entry 1; feather
 * 50 is [inference]). An AI kind gets its AI_KINDS fields and, for a person, the point as its
 * ReferencePoint, written "x y" with 6 decimals as captured ("0.539062 0.650000", capture3-templates.json).
 */
function newComponent(kind: MaskKind, name: string, g: Geometry, point: Point | null): Component {
  const base: Component = { [M.id]: newMaskId(), [M.syncId]: newSyncId(), [M.name]: name, [M.active]: true, [M.inverted]: false, [M.blend]: 0, [M.value]: 1 };
  if (isAiKind(kind)) return { ...base, [M.what]: WHAT.image, ...AI_KINDS[kind].fields, ...(point ? { [IMAGE.referencePoint]: `${point.x.toFixed(6)} ${point.y.toFixed(6)}` } : {}) };
  const what = kind === "linear" ? WHAT.linear : kind === "radial" ? WHAT.radial : WHAT.range;
  const fixed = kind === "radial" ? { [RADIAL.angle]: 0, [RADIAL.feather]: 50, [RADIAL.midpoint]: 50, [RADIAL.roundness]: 0, [RADIAL.flipped]: true, [RADIAL.version]: 2 } : {};
  return { ...base, [M.what]: what, ...fixed, ...geometryFields(kind, g, null) };
}

/**
 * Where the panel's pin goes: the geometry's centre (as on every captured gradient), a person's point
 * (as on both captured people masks, CorrectionReferenceX/Y = ReferencePoint), else the photo's centre [inference].
 */
function pin(kind: MaskKind, g: Geometry, point: Point | null): Point {
  if (point) return point;
  if (kind === "linear" && g.zero && g.full) return { x: (g.zero.x + g.full.x) / 2, y: (g.zero.y + g.full.y) / 2 };
  if (kind === "radial") return { x: ((g.left ?? 0) + (g.right ?? 1)) / 2, y: ((g.top ?? 0) + (g.bottom ?? 1)) / 2 };
  return { x: 0.5, y: 0.5 };
}

/** A new correction of `kind`, named `name`, with the sliders asked for (stored values). */
export function newCorrection(kind: MaskKind, name: string, g: Geometry, point: Point | null, stored: Record<string, number>, existing: readonly Correction[]): Correction {
  const label = KIND_LABELS[kind];
  const same = existing.flatMap(components).filter((m) => componentKind(m) === kind).length;
  const at = pin(kind, g, point);
  const out: Record<string, unknown> = { [C.what]: CORRECTION, [C.id]: newMaskId(), [C.syncId]: newSyncId(), [C.name]: name, [C.active]: true, [C.amount]: 1, [C.refX]: at.x, [C.refY]: at.y, [C.refineSaturation]: 100 };
  for (const f of CARRIED) out[f] = 0;
  for (const p of LOCAL_PARAMS.values()) out[p.field] = 0;
  Object.assign(out, stored, { [C.masks]: [newComponent(kind, `${label} ${same + 1}`, g, point)] });
  return out as Correction;
}

const KINDS: readonly MaskKind[] = ["linear", "radial", "luminance", ...(Object.keys(AI_KINDS) as MaskKind[])];

/** A person's point, required for people kinds and refused for the others. */
function pointFor(kind: MaskKind, point: Point | undefined): Point | null {
  const needs = isAiKind(kind) && AI_KINDS[kind].point;
  if (needs && !point) throw new MaskError("INVALID_ARGUMENTS", `A ${kind} mask needs point: {x, y} in 0-1 on the person (the face, for face skin).`);
  if (!needs && point) throw new MaskError("INVALID_ARGUMENTS", `A ${kind} mask takes no point.`);
  return point ? { x: unit(point.x, "point.x"), y: unit(point.y, "point.y") } : null;
}

/** The kind asked for, or why it is refused. */
export function checkKind(kind: string): MaskKind {
  if ((KINDS as readonly string[]).includes(kind)) return kind as MaskKind;
  const why = REFUSED_KINDS[kind];
  throw new MaskError("MASK_KIND_NOT_SUPPORTED", why ? `A ${kind} mask is not offered: ${why}.` : `Unknown mask kind "${kind}" (kinds: ${KINDS.join(", ")}).`, { kind });
}

function find(entries: readonly Correction[], id: string): number {
  const i = entries.findIndex((e) => e[C.id] === id);
  if (i < 0) throw new MaskError("MASK_NOT_FOUND", `No mask has id ${id} on this photo; call lr_list_masks for the current ids.`, { mask_id: id });
  return i;
}

/** Refuse what can be refused without the photo's table (before a pass waits for its approval): kinds, sliders, combining, an empty edit. */
export function precheck(op: MaskOp): void {
  if (op.op === "create") applyOp([], op);
  if (op.op !== "edit") return;
  if (op.combine) throw new MaskError("MASK_OP_NOT_CAPTURED", `Not offered: ${COMBINE_REFUSED}.`);
  const fields = [op.name, op.active, op.inverted, op.geometry, op.sliders];
  if (fields.every((f) => f === undefined)) throw new MaskError("INVALID_ARGUMENTS", "Name at least one change: name, active, inverted, geometry or sliders.");
  if (op.sliders) storedSliders(op.sliders);
}

function edit(entries: Correction[], op: Extract<MaskOp, { op: "edit" }>): OpResult {
  const i = find(entries, op.mask_id);
  const e = entries[i] as Correction;
  const before = summarize(e);
  precheck(op);
  const parts = components(e);
  const only = parts.length === 1 ? (parts[0] as Component) : null;
  if ((op.inverted !== undefined || op.geometry) && !only) throw new MaskError("MASK_OP_NOT_CAPTURED", "Inverting or reshaping a mask of several components was not captured; edit it in Lightroom.");
  if (op.name !== undefined) e[C.name] = op.name;
  if (op.active !== undefined) e[C.active] = op.active;
  if (only && op.inverted !== undefined) only[M.inverted] = op.inverted;
  if (only && op.geometry) Object.assign(only, geometryFields(String(componentKind(only)), op.geometry, only));
  if (op.sliders) Object.assign(e, storedSliders(op.sliders));
  return { entries, id: op.mask_id, kind: before.kind, before, after: summarize(e) };
}

/** Apply one operation to a copy of the corrections (create: `ai` kinds too; the caller computes them). */
export function applyOp(current: readonly Correction[], op: MaskOp): OpResult {
  const entries = structuredClone(current) as Correction[];
  if (op.op === "delete") {
    const i = find(entries, op.mask_id);
    const before = summarize(entries[i] as Correction);
    entries.splice(i, 1);
    return { entries, id: op.mask_id, kind: before.kind, before, after: null };
  }
  if (op.op === "edit") return edit(entries, op);
  const kind = checkKind(op.kind);
  if (isAiKind(kind) && op.geometry) throw new MaskError("INVALID_ARGUMENTS", `A ${kind} mask is found by Lightroom's AI; it takes no geometry.`);
  const entry = newCorrection(kind, op.name ?? `AVG ${KIND_LABELS[kind]}`, op.geometry ?? {}, pointFor(kind, op.point), storedSliders(op.sliders ?? {}), entries);
  entries.push(entry);
  return { entries, id: String(entry[C.id]), kind, before: null, after: summarize(entry) };
}

/**
 * The settings that write `entries` as the whole table. An empty table is written only to delete the
 * last mask or to undo a pass whose table was empty before it (`emptyOk`): an empty array from any
 * other path would be a bug about to wipe the user's masks.
 */
export function tableSettings(entries: readonly Correction[], emptyOk: boolean): Record<string, unknown> {
  if (entries.length === 0 && !emptyOk) throw new MaskError("INTERNAL_ERROR", "Refused to write an empty mask table outside a delete or an undo.");
  return { [MASK_TABLE_KEY]: entries };
}

/** The component of correction `id` (its first), for the AI route's checks. */
export function firstComponent(entries: readonly Correction[], id: string): Component | null {
  const e = entries.find((x) => x[C.id] === id);
  return e ? (components(e)[0] ?? null) : null;
}

/** Set name and stored sliders on correction `id` (after Lightroom made it through LrDevelopController). */
export function named(entries: readonly Correction[], id: string, name: string, stored: Record<string, number>): Correction[] {
  const out = structuredClone(entries) as Correction[];
  const e = out[find(out, id)] as Correction;
  Object.assign(e, { [C.name]: name }, stored);
  return out;
}

export const correctionIds = (entries: readonly Correction[]): string[] => entries.map((e) => String(e[C.id]));
