// Masks of several parts (GitHub issue #131), pure: a part added to a mask in a mode (add, subtract,
// intersect), one part of a mask reshaped, inverted, set to another mode or removed, and which tables the
// tools may write back. Field names come only from mask-table.ts (rule 03); a new part is built exactly as a
// new mask's component of its kind (mask-build.ts newComponent), and only the fields of its mode differ.
//
// Lightroom stored the three combinations Jim made by hand (a linear, then a radial added, subtracted or
// intersected) with these fields on the radial part, read back unchanged twice [handle: docs\reports\
// phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json `table_before[0..2]`, `shapes`, `diff_lines`]:
//   - add: MaskBlendMode 0, MaskInverted false, MaskValue 1;
//   - subtract: MaskBlendMode 1, MaskInverted false, MaskValue 0;
//   - intersect: MaskBlendMode 1, MaskInverted true, MaskValue 0 (and the radial's Flipped false, as on an
//     inverted radial, issue #79).
// Every other form (an AI part, other kinds, a radial first, three parts, any edit of one part) is built
// here the same way but written only once VERIFIED_FORMS lists it: `npm run masks:combine` writes each
// candidate, reads it back and asks Jim (docs\reports\phase8.5\mask-combine.md); until then it is refused
// with MASK_OP_NOT_CAPTURED naming the form.

import type { CropFrame } from "./crop-frame.js";
import { checkKind, geometryFields, newComponent, type Geometry } from "./mask-build.js";
import type { EditOp } from "./mask-ops.js";
import { AI_KINDS, C, KIND_LABELS, M, MaskError, RADIAL, WHAT, aiError, componentKind, components, computed, isAiKind, untrusted, type AiKind, type Component, type Correction, type MaskKind } from "./mask-table.js";

export const MODE_NAMES = ["add", "subtract", "intersect"] as const;
export type CombineMode = (typeof MODE_NAMES)[number];
/** A part to add (`kind`, with its geometry) or, with `part`, the part's new mode only. */
export type Combine = { mode: string; kind?: string | undefined; geometry?: Geometry | undefined };

/** The fields of each mode, as Lightroom stored them on the second part (the header). */
const MODES: Readonly<Record<CombineMode, { blend: number; inverted: boolean; value: number }>> = {
  add: { blend: 0, inverted: false, value: 1 },
  subtract: { blend: 1, inverted: false, value: 0 },
  intersect: { blend: 1, inverted: true, value: 0 },
};

/**
 * The forms the tools write, in one place: a mask's parts as formOf names them, and a part edit as
 * "<mask's form>: <edit>" (editParts). Lightroom's own three (the header), then the ten forms
 * `npm run masks:combine` wrote, read back as written twice and Jim saw as described, all ten YES [handle:
 * docs\reports\phase8.5\mask-combine\mask_combine_2026-10-12T04-29-26-642Z.json `forms`, headline WORKED]. A
 * part edit needs its mask's form listed too: an edit of a mask whose form is not listed is refused before it
 * (uncaptured).
 */
export const VERIFIED_FORMS = new Set<string>([
  "linear, add radial", "linear, subtract radial", "linear, intersect radial",
  "radial, add sky", "radial, subtract sky", "radial, intersect sky", "sky, add radial",
  "linear, subtract linear", "radial, subtract radial", "radial, intersect luminance",
  "radial, subtract radial: reshape part 2", "radial, subtract radial: part 2 to intersect", "radial, subtract radial: remove part 2",
  "radial, intersect radial", // what "part 2 to intersect" leaves, read back as written in the same run (`forms[8]`)
]);

// The run probed one AI kind, sky. Every AI kind writes the same Mask/Image component apart from its
// MaskSubType and MaskSubCategoryID (mask-build.ts newComponent) [inference], so a sky form stands for every
// AI kind in the same place [stated: Jim, 2026-10-12, "Every AI kind, same modes"]; the others are unprobed.
const AI_NAME = new RegExp(String.raw`(?<!\w)(${Object.keys(AI_KINDS).join("|")})(?!\w)`, "g");
/** Whether VERIFIED_FORMS lists `form`, an AI kind read as sky (the note above). */
export const listed = (form: string): boolean => VERIFIED_FORMS.has(form) || VERIFIED_FORMS.has(form.replace(AI_NAME, "sky"));

/** A component's fields for `mode`; a radial's Flipped follows MaskInverted, as Lightroom stored it (issue #79). */
export function modeFields(mode: CombineMode, m: Component): Record<string, unknown> {
  const f = MODES[mode];
  return { [M.blend]: f.blend, [M.inverted]: f.inverted, [M.value]: f.value, ...(m[M.what] === WHAT.radial ? { [RADIAL.flipped]: !f.inverted } : {}) };
}

/** The mode a part after the first is stored in, or null when its fields are none of the three. */
export function modeOf(m: Component): CombineMode | null {
  return MODE_NAMES.find((k) => m[M.blend] === MODES[k].blend && m[M.inverted] === MODES[k].inverted && m[M.value] === MODES[k].value) ?? null;
}

const partLabel = (m: Component, i: number): string => {
  const kind = String(componentKind(m));
  if (i === 0) return `${m[M.inverted] === true ? "inverted " : ""}${kind}`;
  return `${modeOf(m) ?? `MaskBlendMode ${String(m[M.blend])} MaskInverted ${String(m[M.inverted])} MaskValue ${String(m[M.value])}`} ${kind}`;
};
/** A mask's form: its parts in order, each after the first with its mode ("linear, subtract radial"). */
export const formOf = (parts: readonly Component[]): string => parts.map(partLabel).join(", ");

/** Refuse a form VERIFIED_FORMS does not list: MASK_OP_NOT_CAPTURED, naming it and the forms written. */
export function checkForm(form: string): void {
  if (listed(form)) return;
  const names = [...VERIFIED_FORMS].map((f) => `"${f}"`).join(", ");
  throw new MaskError("MASK_OP_NOT_CAPTURED", `Nothing was written: "${form}" is not a mask form verified in Lightroom. The tools write only these forms (sky standing for every AI kind): ${names}. The pass is not used.`, { form, verified: [...VERIFIED_FORMS] });
}

const invalid = (message: string): never => {
  throw new MaskError("INVALID_ARGUMENTS", message);
};

/** The kind of a part to add, with its geometry checked. One person's kinds need Lightroom to find the person first (session\person-masks.ts), so they are a mask of their own. */
function partKind(c: Combine): MaskKind {
  if (c.kind === undefined) return invalid("combine needs kind: the new part's kind (linear, radial, luminance or an AI kind), or name the part to change its mode (part).");
  const kind = checkKind(c.kind);
  if (isAiKind(kind) && AI_KINDS[kind].point) invalid(`A ${kind} part is not offered: one person's mask needs Lightroom to find the person first; make it a mask of its own (lr_create_mask).`);
  if (isAiKind(kind) && c.geometry) invalid(`A ${kind} part is found by Lightroom's AI; it takes no geometry.`);
  if (!isAiKind(kind)) geometryFields(kind, c.geometry ?? {}, null);
  return kind;
}

/** What an edit with `combine` or `part` asks, checked without the photo's table (mask-ops.ts precheck). */
export function precheckParts(op: EditOp): void {
  const { combine: c, part } = op;
  if (part !== undefined && (!Number.isInteger(part) || part < 1)) invalid("part is a part's number, 1 for the first (lr_list_masks `parts`).");
  if (op.remove_part !== undefined && part === undefined) invalid("remove_part needs part: the number of the part to remove.");
  if (c && !(MODE_NAMES as readonly string[]).includes(c.mode)) invalid("combine.mode is add, subtract or intersect.");
  if (c && part !== undefined && (c.kind !== undefined || c.geometry !== undefined)) invalid("With part, combine takes only mode: the part's new mode.");
  if (c && part === undefined && (op.inverted !== undefined || op.geometry !== undefined)) invalid("combine adds a part; invert or reshape in a separate edit, or name the part.");
  if (c && part === undefined) partKind(c);
  if (part === undefined) return;
  if ([op.geometry, op.inverted, c, op.remove_part].filter((x) => x !== undefined).length !== 1) invalid("With part, name one change of that part: geometry, inverted, combine (its mode) or remove_part.");
  if (part === 1 && (c || op.remove_part)) invalid("Part 1 is the mask's first part: it has no mode, and it cannot be removed (delete the mask, or remove its other parts).");
}

/** A new part of `c.kind` in `c.mode` at the end of `parts`, once its form is verified; the AI kind Lightroom must compute, or null. */
function addPart(parts: Component[], c: Combine, frame?: CropFrame): AiKind | null {
  const kind = partKind(c);
  const same = parts.filter((m) => componentKind(m) === kind).length;
  const m = newComponent(kind, `${KIND_LABELS[kind]} ${same + 1}`, c.geometry ?? {}, null, frame);
  parts.push(Object.assign(m, modeFields(c.mode as CombineMode, m)));
  checkForm(formOf(parts));
  return isAiKind(kind) ? kind : null;
}

/**
 * An edit with `combine` (add a part) or `part` (that part reshaped, inverted, set to a mode, or removed), applied
 * to correction `e` (a copy), once its form is verified; geometry through `frame`, the photo's crop frame (issue
 * #179). Returns the AI kind of an added part Lightroom must compute, or null.
 */
export function editParts(e: Correction, op: EditOp, frame?: CropFrame): AiKind | null {
  precheckParts(op);
  const parts = components(e);
  if (op.part === undefined) return addPart(parts, op.combine as Combine, frame);
  const i = op.part - 1;
  const m = parts[i];
  if (!m) return invalid(`Mask ${String(e[C.id])} has ${parts.length} part(s): there is no part ${op.part} (lr_list_masks \`parts\`).`);
  const change = op.geometry ? `reshape part ${op.part}` : op.inverted !== undefined ? `part ${op.part} inverted ${op.inverted}` : op.combine ? `part ${op.part} to ${op.combine.mode}` : `remove part ${op.part}`;
  checkForm(`${formOf(parts)}: ${change}`);
  if (op.geometry) Object.assign(m, geometryFields(String(componentKind(m)), op.geometry, m, frame));
  else if (op.inverted !== undefined) Object.assign(m, { [M.inverted]: op.inverted }, m[M.what] === WHAT.radial ? { [RADIAL.flipped]: !op.inverted } : {});
  else if (op.combine) Object.assign(m, modeFields(op.combine.mode as CombineMode, m));
  else parts.splice(i, 1);
  return null;
}

/**
 * The part the AI route reads (mask-ops.ts firstComponent: session\ai-update.ts, ai-masks.ts): an AI part
 * may be any part of a combined mask, so the first AI part without Lightroom's answer, else the first with an
 * ErrorReason, else the first AI part; the first part when none is AI. Pending.lua waits for every AI part alike.
 */
export function aiPart(parts: readonly Component[]): Component | null {
  const ai = parts.filter((m) => m[M.what] === WHAT.image);
  return ai.find((m) => !computed(m) && aiError(m) === null) ?? ai.find((m) => aiError(m) !== null) ?? ai[0] ?? parts[0] ?? null;
}

/**
 * The first correction the tools must not edit, and why: an untrusted part (mask-table.ts untrusted), a first
 * part with a MaskBlendMode other than 0 (every captured mask's first part: blend 0 [handle: 3_dump-1.json;
 * capture2-templates.json; capture3-templates.json; capture4-row6_people_by_hand.json; the mask-carry run
 * above]), or several parts whose form VERIFIED_FORMS does not list. session\masks.ts checks the edited one
 * only: others are carried unchanged, as Add, Subtract, Intersect, Brush and Color read back twice beside a
 * new radial [handle: the mask-carry run above, `diff_lines`, issue #121]. A brush inside an AI mask, a Depth
 * Range: [unverified] (mask-carry.md "Consequences").
 */
export function uncaptured(entries: readonly Correction[]): { name: string; why: string } | null {
  for (const e of entries) {
    const parts = components(e);
    const name = typeof e[C.name] === "string" ? (e[C.name] as string) : String(e[C.id]);
    const first = parts[0];
    if (!first) return { name, why: "it has 0 components" };
    if (first[M.blend] !== undefined && first[M.blend] !== 0) return { name, why: `its MaskBlendMode is ${String(first[M.blend])}` };
    const why = parts.map(untrusted).find((w) => w !== null);
    if (why) return { name, why };
    if (parts.length > 1 && !listed(formOf(parts))) return { name, why: `its ${parts.length} components ("${formOf(parts)}") are not a form verified in Lightroom` };
  }
  return null;
}
