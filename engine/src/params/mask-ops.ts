// Mask operations on the table (GitHub issue #59, PR C step 2), pure: summaries in panel units, a new
// correction of each kind, and create / edit / delete applied to a copy of the corrections. Field names
// come only from mask-table.ts (rule 03). A new entry is built in the captured shape: every correction
// field the captures show, its sliders at 0 but those asked for, and one component of its kind
// [handle: docs\reports\phase6\masks-capture\3_dump-1.json] (mask-build.ts); an AI component in Adobe's own
// form (mask-table.ts AI_KINDS). A part added to a mask, and an edit of one part, are mask-combine.ts's (issue
// #131): written only in the forms verified in Lightroom. Inverting or reshaping a mask of several parts as a
// whole is refused: name the part. One person's mask is placed by a point on the person (its
// ReferencePoint, as both captured people masks carry one [handle:
// docs\reports\phase6\masks-capture\capture3-templates.json]); every other AI kind gets the photo's
// centre, "0.500000 0.500000", as in every Adobe adaptive preset (mask-ai-kinds.ts).

import { IDENTITY, photoPoint, type CropFrame } from "./crop-frame.js";
import { checkKind, geometryFields, newComponent, unit, type Geometry, type Point } from "./mask-build.js";
import { brushPin } from "./mask-brush.js";
import { aiPart, editParts, precheckParts, type Combine } from "./mask-combine.js";
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
  WHAT,
  componentKind,
  components,
  isAiKind,
  newMaskId,
  newSyncId,
  type AiKind,
  type Component,
  type Correction,
  type MaskKind,
} from "./mask-table.js";
import { summarize, type MaskSummary } from "./mask-summary.js";
import { copiedSample, type CopySample } from "./mask-range.js";
import { invertedCopy } from "./mask-copy.js";
import { applyPointColors, precheckPointColors, type PointColorsOp } from "./mask-point-colors.js";

export type { Geometry, Point } from "./mask-build.js";
/** An edit: one mask's name, visibility, sliders, inversion and geometry; `combine` adds a part, `part` (1 = the first) edits one part (mask-combine.ts). */
export type EditOp = {
  op: "edit";
  mask_id: string;
  name?: string | undefined;
  active?: boolean | undefined;
  inverted?: boolean | undefined;
  geometry?: Geometry | undefined;
  sliders?: Record<string, number> | undefined;
  combine?: Combine | undefined;
  part?: number | undefined;
  remove_part?: true | undefined;
  /** With inverted: true, a new inverted copy of the mask; the mask itself stays (mask-copy.ts, issue #217 row 2). */
  copy?: true | undefined;
  /** One change to the mask's Point Color swatches (mask-point-colors.ts, issue #217 row 4). */
  point_colors?: PointColorsOp | undefined;
};
/** A new mask; a colour range's `copy_sample_from` is resolved to its sample and point (withCopiedSample) before applyOp. */
export type CreateOp = { op: "create"; kind: string; name?: string | undefined; geometry?: Geometry | undefined; point?: Point | undefined; sliders?: Record<string, number> | undefined; copy_sample_from?: CopySample | undefined };
export type MaskOp = CreateOp | EditOp | { op: "delete"; mask_id: string };

/** `ai`: an added part of an AI kind, which Lightroom must compute (session\mask-parts.ts). */
export type OpResult = { entries: Correction[]; id: string; kind: string; before: MaskSummary | null; after: MaskSummary | null; ai?: AiKind };

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

/**
 * Where the panel's pin goes, in the photo: the written geometry's centre (as on every captured gradient; a
 * radial's corners' midpoint is its centre at any Angle), a person's point (as on both captured people masks,
 * CorrectionReferenceX/Y = ReferencePoint), else the photo's centre [inference].
 */
function pin(m: Component, point: Point | null): Point {
  if (point) return point;
  const mid = (a: string, b: string): number => (Number(m[a]) + Number(m[b])) / 2;
  if (m[M.what] === WHAT.linear) return { x: mid(LINEAR.zeroX, LINEAR.fullX), y: mid(LINEAR.zeroY, LINEAR.fullY) };
  if (m[M.what] === WHAT.radial) return { x: mid(RADIAL.left, RADIAL.right), y: mid(RADIAL.top, RADIAL.bottom) };
  return brushPin(m) ?? { x: 0.5, y: 0.5 };
}

/** A new correction of `kind`, named `name`, with the sliders asked for (stored values); `g` in the preview's frame, `point` in the photo's (pointFor). */
export function newCorrection(kind: MaskKind, name: string, g: Geometry, point: Point | null, stored: Record<string, number>, existing: readonly Correction[], frame: CropFrame = IDENTITY): Correction {
  const label = KIND_LABELS[kind];
  const same = existing.flatMap(components).filter((m) => componentKind(m) === kind).length;
  const m = newComponent(kind, `${label} ${same + 1}`, g, point, frame);
  const at = pin(m, point);
  const out: Record<string, unknown> = { [C.what]: CORRECTION, [C.id]: newMaskId(), [C.syncId]: newSyncId(), [C.name]: name, [C.active]: true, [C.amount]: 1, [C.refX]: at.x, [C.refY]: at.y, [C.refineSaturation]: 100 };
  for (const f of CARRIED) out[f] = 0;
  for (const p of LOCAL_PARAMS.values()) out[p.field] = 0;
  Object.assign(out, stored, { [C.masks]: [m] });
  return out as Correction;
}

/**
 * A colour range sampled from the preview at its point is refused (Jim's decision, 2026-10-28): in `npm run masks:verify`
 * the engine's point sample selected the red asked for on one photo and not on the other, while a copy of Lightroom's
 * own sample worked, and Lightroom's sample for red (l 0.79, a 0.84, b 0.66) is on another scale than the preview's
 * sRGB at that place [handle: docs\reports\phase11\MASKS-VERIFY.md "Observed"; inference: the scale].
 */
export const COLOR_SAMPLE_NEEDED =
  "A color_range mask needs its colour as Lightroom stores it, given one of two ways: copy_sample_from (the mask_id of a colour range made in " +
  "Lightroom: Tools > Create New Mask > Color Range in Develop, click the colour; lr_list_masks shows its id), or geometry.sample (l, a, b as " +
  "lr_list_masks shows them for a colour range). A colour taken from the preview at point is not written: it did not select the colour asked for in a " +
  "Lightroom check. Nothing was written.";

/** A person's point, or a colour range's (the colour to select): required for those kinds, refused for the others; given in the preview's frame, returned in the photo's. */
function pointFor(kind: MaskKind, point: Point | undefined, frame: CropFrame): Point | null {
  const needs = kind === "color_range" || (isAiKind(kind) && AI_KINDS[kind].point);
  if (needs && !point) throw new MaskError("INVALID_ARGUMENTS", kind === "color_range" ? "A color_range mask needs point: {x, y} in 0-1 on the colour to select." : `A ${kind} mask needs point: {x, y} in 0-1 on the person (the face, for face skin).`);
  if (!needs && point) throw new MaskError("INVALID_ARGUMENTS", `A ${kind} mask takes no point.`);
  return point ? photoPoint(frame, { x: unit(point.x, "point.x"), y: unit(point.y, "point.y") }, "point") : null;
}

function find(entries: readonly Correction[], id: string): number {
  const i = entries.findIndex((e) => e[C.id] === id);
  if (i < 0) throw new MaskError("MASK_NOT_FOUND", `No mask has id ${id} on this photo; call lr_list_masks for the current ids.`, { mask_id: id });
  return i;
}

/** Refuse what can be refused without the photo's table (before a pass waits for its approval): kinds, sliders, a part's arguments, an empty edit. */
export function precheck(op: MaskOp): void {
  if (op.op === "create") applyOp([], op.copy_sample_from ? placeholderCopy(op) : op);
  if (op.op !== "edit") return;
  precheckParts(op);
  if (op.copy) precheckCopy(op);
  if (op.point_colors) precheckPointColors(op.point_colors);
  const fields = [op.name, op.active, op.inverted, op.geometry, op.sliders, op.combine, op.remove_part, op.point_colors];
  if (fields.every((f) => f === undefined)) throw new MaskError("INVALID_ARGUMENTS", "Name at least one change: name, active, inverted, geometry, sliders, point_colors, combine or remove_part.");
  if (op.sliders) storedSliders(op.sliders);
}

/** A copy takes inverted: true, and name and sliders for the copy; nothing that reshapes or names a part. */
function precheckCopy(op: EditOp): void {
  if (op.inverted !== true) throw new MaskError("INVALID_ARGUMENTS", "copy: true makes an inverted copy: give inverted: true with it.");
  const other = (["active", "geometry", "combine", "part", "remove_part", "point_colors"] as const).filter((k) => op[k] !== undefined);
  if (other.length > 0) throw new MaskError("INVALID_ARGUMENTS", `copy: true takes only inverted, name and sliders (for the copy), not ${other.join(", ")}.`);
}

function edit(entries: Correction[], op: EditOp, frame: CropFrame): OpResult {
  const i = find(entries, op.mask_id);
  const e = entries[i] as Correction;
  const before = summarize(e, frame);
  precheck(op);
  if (op.copy) {
    const c = invertedCopy(e, op.name, storedSliders(op.sliders ?? {}));
    entries.push(c.entry);
    return { entries, id: String(c.entry[C.id]), kind: before.kind, before: null, after: summarize(c.entry, frame), ...(c.ai ? { ai: c.ai } : {}) };
  }
  const parts = components(e);
  const only = parts.length === 1 ? (parts[0] as Component) : null;
  // `part` 1 of a one-part mask is the mask itself; any other `part`, and `combine`, go to mask-combine.ts.
  const byPart = op.combine !== undefined || (op.part !== undefined && !(op.part === 1 && only));
  const ai = byPart ? editParts(e, op, frame) : null;
  if (!byPart && (op.inverted !== undefined || op.geometry) && !only) throw new MaskError("MASK_OP_NOT_CAPTURED", "This mask has several parts: name the part to invert or reshape (part, 1 for the first; lr_list_masks `parts`).");
  if (op.name !== undefined) e[C.name] = op.name;
  if (op.active !== undefined) e[C.active] = op.active;
  // An inverted radial reads back MaskInverted true with Flipped false [handle: docs\reports\phase8\S10\census\
  // s10__DSC0103.NEF__Copy 1.json "AVG vignette"], so write that form (issue #79); Flipped true when un-inverted is [inference].
  if (!byPart && only && op.inverted !== undefined) Object.assign(only, { [M.inverted]: op.inverted }, only[M.what] === WHAT.radial ? { [RADIAL.flipped]: !op.inverted } : {});
  if (!byPart && only && op.geometry) Object.assign(only, geometryFields(String(componentKind(only)), op.geometry, only, frame));
  if (op.sliders) Object.assign(e, storedSliders(op.sliders));
  if (op.point_colors) applyPointColors(e, op.point_colors);
  return { entries, id: op.mask_id, kind: before.kind, before, after: summarize(e, frame), ...(ai ? { ai } : {}) };
}

/**
 * Apply one operation to a copy of the corrections (create: `ai` kinds too; the caller computes them).
 * `frame`: the photo's crop frame (crop-frame.ts, issue #179); the op's geometry and point, and the
 * summaries, are in the preview's frame.
 */
export function applyOp(current: readonly Correction[], op: MaskOp, frame: CropFrame = IDENTITY): OpResult {
  const entries = structuredClone(current) as Correction[];
  if (op.op === "delete") {
    const i = find(entries, op.mask_id);
    const before = summarize(entries[i] as Correction, frame);
    entries.splice(i, 1);
    return { entries, id: op.mask_id, kind: before.kind, before, after: null };
  }
  if (op.op === "edit") return edit(entries, op, frame);
  const kind = checkKind(op.kind);
  if (op.copy_sample_from) throw new MaskError("INTERNAL_ERROR", "copy_sample_from is resolved (withCopiedSample) before the mask is built.");
  if (isAiKind(kind) && op.geometry) throw new MaskError("INVALID_ARGUMENTS", `A ${kind} mask is found by Lightroom's AI; it takes no geometry.`);
  if (kind === "color_range" && !op.geometry?.sample) throw new MaskError("INVALID_ARGUMENTS", COLOR_SAMPLE_NEEDED);
  const entry = newCorrection(kind, op.name ?? `AVG ${KIND_LABELS[kind]}`, op.geometry ?? {}, pointFor(kind, op.point, frame), storedSliders(op.sliders ?? {}), entries, frame);
  entries.push(entry);
  return { entries, id: String(entry[C.id]), kind, before: null, after: summarize(entry, frame) };
}

/** The checks of a copy that need no photo; then the op with a stand-in sample, for precheck's dry build. */
function placeholderCopy(op: CreateOp): CreateOp {
  if (op.kind !== "color_range") throw new MaskError("INVALID_ARGUMENTS", `copy_sample_from only applies to a color_range mask, not ${op.kind}.`);
  if (op.geometry?.sample) throw new MaskError("INVALID_ARGUMENTS", "geometry.sample and copy_sample_from both give the colour; use one of them.");
  return { ...op, copy_sample_from: undefined, point: op.point ?? { x: 0.5, y: 0.5 }, geometry: { ...op.geometry, sample: { l: 0, a: 0, b: 0 } } };
}

/**
 * `op` with its copy_sample_from resolved (Automaat PR #341): the l, a, b Lightroom stored in that colour range, its
 * amount unless geometry.color_amount is given, and its pin unless `point` is given; `source` is the table and
 * crop frame of the photo copied from (the same photo or another target). An op without a copy comes back as is.
 */
export function withCopiedSample(op: CreateOp, source: { entries: readonly Correction[]; frame: CropFrame }): CreateOp {
  if (!op.copy_sample_from) return op;
  placeholderCopy(op);
  const got = copiedSample(source.entries, source.frame, op.copy_sample_from);
  return { ...op, copy_sample_from: undefined, point: op.point ?? got.point, geometry: { ...op.geometry, sample: got.sample, color_amount: op.geometry?.color_amount ?? got.amount } };
}

/**
 * The settings that write `entries` as the whole table. An empty table is written only to delete the
 * last mask or to undo a pass whose table was empty before it (`emptyOk`): an empty array from any
 * other path would be a bug about to wipe the user's masks. That Lightroom takes an empty array as "no
 * masks" is [unverified]: the captures deleted down to 7 entries, never to 0 (check.json `10_delete`).
 */
export function tableSettings(entries: readonly Correction[], emptyOk: boolean): Record<string, unknown> {
  if (entries.length === 0 && !emptyOk) throw new MaskError("INTERNAL_ERROR", "Refused to write an empty mask table outside a delete or an undo.");
  return { [MASK_TABLE_KEY]: entries };
}

/**
 * update_ai_settings' `watch` (plugin 0.16.0, Pending.lua): the entries `ids` and the field names the
 * plugin's guard reads them by. `what` and `image` (plugin 0.21.0, issue #131): the guard waits for every
 * part whose What is Mask/Image, as an AI part may be any part of a combined mask; a plugin before 0.21.0
 * reads the first part only.
 */
export const aiWatch = (ids: string[]) => ({ ids, table: MASK_TABLE_KEY, id: C.id, masks: C.masks, digest: IMAGE.digest, error: IMAGE.errorReason, what: M.what, image: WHAT.image });

/** The part of correction `id` the AI route's checks read (mask-combine.ts aiPart: an AI part wherever it is), or null. */
export function firstComponent(entries: readonly Correction[], id: string): Component | null {
  const e = entries.find((x) => x[C.id] === id);
  return e ? aiPart(components(e)) : null;
}

/** Set name and stored sliders on correction `id` (after Lightroom made it through LrDevelopController). */
export function named(entries: readonly Correction[], id: string, name: string, stored: Record<string, number>): Correction[] {
  const out = structuredClone(entries) as Correction[];
  const e = out[find(out, id)] as Correction;
  Object.assign(e, { [C.name]: name }, stored);
  return out;
}

export const correctionIds = (entries: readonly Correction[]): string[] => entries.map((e) => String(e[C.id]));
