// The mask table of getDevelopSettings() (GitHub issue #59, PR C step 2): the only file that names
// its fields (rule 03). Every field and type string below comes from Jim's masks captures on LrC
// 15.6, never from documentation [handle: docs\reports\phase6\masks-capture\3_dump-1.json, the
// five-entry table (linear, radial, sky, subject, luminance); capture2-templates.json, the background
// entry]; engine\tests\params-mask-table.test.ts checks that each constant appears in those files.
//
// What the captures established [handle: docs\reports\phase6\masks-capture.md "Numbers"; check.json]:
//   - the table is an array of corrections, each with its components in CorrectionMasks; two reads
//     give identical tables, ids included, and the unchanged table written back reads back identical;
//   - new entries with fresh ids in the captured formats are taken; geometry, CorrectionName and
//     CorrectionActive write and read back; writing the array without an entry deletes just it;
//   - a photo without masks may have no table at all [inference: the S5 dump of a photo without masks
//     has none, masks-capture.md pre-run finding 2]: absent, [] and {} count as the same here.
// The local sliders' scales are capture 2's [handle: capture2-calibration.json `fields`]: the panel
// shows scale x stored, offset 0. LocalToningHue is pinned 1:1 in degrees [stated: Jim, 2026-10-03,
// "Pin 1:1, verify in final check (Recommended)"]; that it is 1:1 is [inference] (capture 2 flagged it).

import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AI_KIND_DATA, type AiKind } from "./mask-ai-kinds.js";

export type { AiKind } from "./mask-ai-kinds.js";

/** The top-level key [handle: docs\reports\phase6\masks-capture\check.json `3_dumps.mask_key`]. */
export const MASK_TABLE_KEY = "MaskGroupBasedCorrections";

/** A correction's fields, and its `What`. */
export const C = {
  what: "What",
  id: "CorrectionID",
  syncId: "CorrectionSyncID",
  name: "CorrectionName",
  active: "CorrectionActive",
  amount: "CorrectionAmount",
  refX: "CorrectionReferenceX",
  refY: "CorrectionReferenceY",
  masks: "CorrectionMasks",
  refineSaturation: "LocalCurveRefineSaturation",
} as const;
export const CORRECTION = "Correction";
/** Older-process sliders every captured correction carries at 0: kept as they are, never offered. */
export const CARRIED = ["LocalExposure", "LocalContrast", "LocalClarity", "LocalBrightness"] as const;

/** A component's fields (CorrectionMasks entries). */
export const M = { what: "What", id: "MaskID", syncId: "MaskSyncID", name: "MaskName", active: "MaskActive", inverted: "MaskInverted", blend: "MaskBlendMode", value: "MaskValue" } as const;
export const WHAT = { linear: "Mask/Gradient", radial: "Mask/CircularGradient", image: "Mask/Image", range: "Mask/RangeMask" } as const;
export const LINEAR = { zeroX: "ZeroX", zeroY: "ZeroY", fullX: "FullX", fullY: "FullY" } as const;
export const RADIAL = { top: "Top", left: "Left", bottom: "Bottom", right: "Right", angle: "Angle", feather: "Feather", midpoint: "Midpoint", roundness: "Roundness", flipped: "Flipped", version: "Version" } as const;
/**
 * ErrorReason: Lightroom added it, 0, to every AI entry written in capture 3 [handle: docs\reports\phase6\masks-capture\capture3-4_people_entire.json `after_write`].
 * InstanceIDs, InstanceID, InstanceBounds: one person's Entire Person, made by hand on a photo of two
 * people, names its person as InstanceIDs [{ InstanceID: 0 | 1 }] and carries the boxes of every person
 * Lightroom found [handle: docs\reports\phase6\masks-capture\capture4-row6_people_by_hand.json].
 */
export const IMAGE = {
  subType: "MaskSubType",
  subCategory: "MaskSubCategoryID",
  maskVersion: "MaskVersion",
  digest: "MaskDigest",
  referencePoint: "ReferencePoint",
  errorReason: "ErrorReason",
  instanceIds: "InstanceIDs",
  instanceId: "InstanceID",
  instanceBounds: "InstanceBounds",
} as const;
/** An InstanceBounds box, in 0-1 of the photo [handle: same file]. */
export const BOX = { top: "Top", left: "Left", bottom: "Bottom", right: "Right" } as const;
export const RANGE = { holder: "CorrectionRangeMask", lumRange: "LumRange", type: "Type", version: "Version", sampleType: "SampleType", sampleInfo: "LuminanceDepthSampleInfo", invert: "Invert" } as const;
/**
 * Fields Lightroom computes for an AI component: the digests (new ones appeared after
 * update_ai_settings [handle: docs\reports\phase6\masks-capture\check.json `7_sky.new_digests`]) and,
 * by [inference], the photo's own fields that differ between photos (capture3-templates.json against
 * 3_dump-1.json). They are left out of the table's fingerprint and of the read-back check, so a mask
 * computing does not read as a change.
 */
export const RECOMPUTED: readonly string[] = ["MaskDigest", "InputDigest", "LocalInputDigest", "InputDigestVersion", "LocalInputDigestVersion", "ModelVersion", "Origin", "FullMaskSize", "WholeImageArea", "InstanceBounds"];
const recomputed = new Set(RECOMPUTED);
/**
 * Fields left out of the read-back check only: right after the write of capture 3's copies, Lightroom
 * read back ReferencePoint "0.500000 0.500000" and CorrectionReferenceX/Y 0.5 for a person's point,
 * and the written values again once the mask had computed; it added ErrorReason 0 [handle:
 * docs\reports\phase6\masks-capture\capture3-4_people_entire.json `written`, `after_write`, `final`].
 * ErrorReason is Lightroom's answer, which session\ai-update.ts reads.
 */
const settling = new Set<string>(["ReferencePoint", "ErrorReason", "CorrectionReferenceX", "CorrectionReferenceY"]);

/** A local slider: its stored field, the panel's scale (panel = scale x stored) and the panel's range. */
export type LocalParam = { field: string; scale: number; min: number; max: number };
const local = (field: string, scale: number, min = -100, max = 100): LocalParam => ({ field, scale, min, max });

/** Canonical local names -> the stored field; never the same names as CANONICAL_PARAMS (a test checks it). */
export const LOCAL_PARAMS: ReadonlyMap<string, LocalParam> = new Map([
  ["local.temperature", local("LocalTemperature", 100)],
  ["local.tint", local("LocalTint", 100)],
  ["local.exposure", local("LocalExposure2012", 4, -4, 4)],
  ["local.contrast", local("LocalContrast2012", 100)],
  ["local.highlights", local("LocalHighlights2012", 100)],
  ["local.shadows", local("LocalShadows2012", 100)],
  ["local.whites", local("LocalWhites2012", 100)],
  ["local.blacks", local("LocalBlacks2012", 100)],
  ["local.texture", local("LocalTexture", 100)],
  ["local.clarity", local("LocalClarity2012", 100)],
  ["local.dehaze", local("LocalDehaze", 100)],
  ["local.hue", local("LocalHue", 180, -180, 180)],
  ["local.saturation", local("LocalSaturation", 100)],
  ["local.sharpness", local("LocalSharpness", 100)],
  ["local.noise", local("LocalLuminanceNoise", 100)],
  ["local.moire", local("LocalMoire", 100)],
  ["local.defringe", local("LocalDefringe", 100)],
  ["local.toning_hue", local("LocalToningHue", 1, 0, 360)],
  ["local.toning_saturation", local("LocalToningSaturation", 100, 0, 100)],
  ["local.grain", local("LocalGrain", 100)],
]);

const componentSchema = z.looseObject({ [M.what]: z.string() });
export const correctionSchema = z.looseObject({
  [C.what]: z.literal(CORRECTION),
  [C.id]: z.string().min(1),
  [C.masks]: z.array(componentSchema),
});
export type Correction = z.infer<typeof correctionSchema> & Record<string, unknown>;
export type Component = Record<string, unknown>;

/** A mask table the engine cannot read safely: never treated as empty, so nothing of it is written over. */
export class MaskError extends Error {
  readonly code: string;
  readonly details: unknown;
  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "MaskError";
    this.code = code;
    this.details = details;
  }
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || (typeof v === "object" && Object.keys(v).length === 0);

/** The corrections of a getDevelopSettings() table: absent, [] and {} are none; anything else not an array of corrections throws MASK_TABLE_UNREADABLE. */
export function readTable(sdk: Readonly<Record<string, unknown>>): Correction[] {
  const raw = sdk[MASK_TABLE_KEY];
  if (isEmpty(raw)) return [];
  const parsed = z.array(correctionSchema).safeParse(raw);
  if (!parsed.success) {
    throw new MaskError("MASK_TABLE_UNREADABLE", `The photo's mask table is not in the form the masks captures recorded (${parsed.error.issues[0]?.message ?? "not an array"}); nothing was written.`);
  }
  return structuredClone(parsed.data) as Correction[];
}

/** JSON with object keys sorted and RECOMPUTED fields left out, so two reads of the same table give the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const keys = Object.keys(v).filter((k) => !recomputed.has(k)).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/** How many corrections the table holds, and its fingerprint (equal tables, equal text, RECOMPUTED fields aside; absent = [] = {}). Never throws. */
export function tableInfo(sdk: Readonly<Record<string, unknown>>): { count: number; fingerprint: string } {
  const raw = sdk[MASK_TABLE_KEY];
  if (isEmpty(raw)) return { count: 0, fingerprint: "[]" };
  return { count: Array.isArray(raw) ? raw.length : 0, fingerprint: stable(raw) };
}

/** `written`'s fields all in `got` with equal values (numbers within 1e-6); fields Lightroom adds or recomputes are its own. */
function covers(written: unknown, got: unknown): boolean {
  if (typeof written === "number" && typeof got === "number") return Math.abs(written - got) <= 1e-6;
  if (written && typeof written === "object" && got && typeof got === "object") {
    if (isEmpty(written) || isEmpty(got)) return isEmpty(written) && isEmpty(got);
    if (Array.isArray(written) && (!Array.isArray(got) || written.length !== got.length)) return false;
    return Object.entries(written).every(([k, x]) => recomputed.has(k) || settling.has(k) || (k in got && covers(x, (got as Record<string, unknown>)[k])));
  }
  return written === got;
}

/** What differs between the corrections written and the table read back (matched by CorrectionID); [] when it took. */
export function verifyTable(written: readonly Correction[], readBack: Readonly<Record<string, unknown>>): string[] {
  let back: Correction[];
  try {
    back = readTable(readBack);
  } catch (err) {
    return [(err as Error).message];
  }
  const problems: string[] = [];
  if (back.length !== written.length) problems.push(`${written.length} masks written, ${back.length} read back`);
  for (const w of written) {
    const got = back.find((b) => b[C.id] === w[C.id]);
    if (!got) problems.push(`mask ${String(w[C.name] ?? w[C.id])} is missing from the read-back`);
    else if (!covers(w, got)) problems.push(`mask ${String(w[C.name] ?? w[C.id])} reads back different`);
  }
  return problems;
}

/**
 * The AI kinds (mask-ai-kinds.ts has the numbers and where each comes from): the fields that tell a
 * kind (MaskSubType, MaskSubCategoryID, MaskVersion 1), LrDevelopController's subtype when that route
 * made it, and whether it needs a point on the photo. mask-ops.ts writes a new component in Adobe's
 * own form, as Lightroom's adaptive presets carry it: these fields, ReferencePoint, ErrorReason 0; no
 * digests and none of the photo's own fields (ModelVersion, Origin, FullMaskSize, WholeImageArea).
 */
export type MaskKind = "linear" | "radial" | "luminance" | AiKind;
type AiSpec = { dc: string | null; label: string; point: boolean; fields: Readonly<Record<string, number>> };
export const AI_KINDS = Object.fromEntries(
  Object.entries(AI_KIND_DATA).map(([k, d]) => [
    k,
    { dc: d.dc, label: d.label, point: d.point, fields: { [IMAGE.subType]: d.subType, ...(d.subCategory !== null ? { [IMAGE.subCategory]: d.subCategory } : {}), [IMAGE.maskVersion]: 1 } },
  ]),
) as unknown as Readonly<Record<AiKind, AiSpec>>;
export const isAiKind = (k: string): k is AiKind => k in AI_KINDS;
export const KIND_LABELS: Readonly<Record<MaskKind, string>> = {
  linear: "Linear Gradient",
  radial: "Radial Gradient",
  luminance: "Luminance Range",
  ...(Object.fromEntries(Object.entries(AI_KINDS).map(([k, v]) => [k, v.label])) as Record<AiKind, string>),
};

/** The kind of a component, read from its fields; "other" for anything the captures did not show. */
export function componentKind(m: Component): MaskKind | "ai" | "range" | "other" {
  if (m[M.what] === WHAT.linear) return "linear";
  if (m[M.what] === WHAT.radial) return "radial";
  if (m[M.what] === WHAT.range) return (m[RANGE.holder] as Record<string, unknown> | undefined)?.[RANGE.type] === 2 ? "luminance" : "range";
  if (m[M.what] !== WHAT.image) return "other";
  const tells = (k: AiKind): boolean => m[IMAGE.subType] === AI_KINDS[k].fields[IMAGE.subType] && m[IMAGE.subCategory] === AI_KINDS[k].fields[IMAGE.subCategory];
  return (Object.keys(AI_KINDS) as AiKind[]).find(tells) ?? "ai";
}

/**
 * Whether a component's structure was round-tripped (a table written back by apply_settings read back
 * unchanged): linear, radial and luminance, and every Mask/Image with MaskSubType 0, 1, 2 or 3 and
 * its category or InstanceIDs. Capture 1 wrote back sky (2) and subject (1) unchanged [handle:
 * docs\reports\phase6\masks-capture\check.json `4_write_back`]; capture 4's round trips read back
 * unchanged landscape vegetation, mountains and sky (0 + 50005, 50002, 50006), every person's face skin
 * and hair (3 + 2, 3 + 5), Entire Person with InstanceIDs (0 + 20036, two by hand) and a 3 + 13 entry
 * Lightroom made [handle: capture4-check.json `round_trip`, steps `row*_round_trip`]. Background
 * (0 + 22) had no round trip of its own; it shares SubType 0 [inference]. Brush strokes, Select
 * Objects, colour and depth ranges (any other What or RangeMask type) stay refused.
 */
function roundTripped(m: Component): boolean {
  const kind = componentKind(m);
  if (kind === "linear" || kind === "radial" || kind === "luminance") return true;
  return m[M.what] === WHAT.image && [0, 1, 2, 3].includes(m[IMAGE.subType] as number);
}

/**
 * The first correction the engine must not write back, and why: a component whose structure the captures
 * did not round-trip (roundTripped), more than one component, or a MaskBlendMode other than 0 (every
 * captured component had one component and MaskBlendMode 0 [handle: 3_dump-1.json;
 * capture2-templates.json; capture3-templates.json; capture4-row6_people_by_hand.json]). The mask tools
 * write the whole table, so such a mask would be written back in a form never shown to survive it
 * [inference]; they refuse instead (session\masks.ts).
 */
export function uncaptured(entries: readonly Correction[]): { name: string; why: string } | null {
  for (const e of entries) {
    const parts = e[C.masks] as Component[];
    const name = typeof e[C.name] === "string" ? (e[C.name] as string) : String(e[C.id]);
    if (parts.length !== 1) return { name, why: `it has ${parts.length} components` };
    const m = parts[0] as Component;
    if (m[M.blend] !== undefined && m[M.blend] !== 0) return { name, why: `its MaskBlendMode is ${String(m[M.blend])}` };
    const kind = componentKind(m);
    if (!roundTripped(m)) return { name, why: `its kind (${String(m[M.what])}${kind === "range" ? ", not a luminance range" : ""}) was not round-tripped in the masks captures` };
  }
  return null;
}

/** A new id in the captured formats: CorrectionID / MaskID as an upper-case UUID, the sync ids as 32 upper-case hex digits. */
export const newMaskId = (): string => randomUUID().toUpperCase();
export const newSyncId = (): string => randomUUID().replace(/-/g, "").toUpperCase();

/** Whether an AI component has computed: Lightroom writes its digest once it has [handle: check.json `7_sky.new_digests`]. */
export const computed = (m: Component): boolean => typeof m[IMAGE.digest] === "string" && m[IMAGE.digest] !== "";
/** A component's ReferencePoint as [x, y] in 0-1, or null. */
export function pointOf(m: Component | null | undefined): [number, number] | null {
  const at = m?.[IMAGE.referencePoint];
  if (typeof at !== "string") return null;
  const [x, y] = at.split(/\s+/).map(Number);
  return Number.isFinite(x) && Number.isFinite(y) ? [x as number, y as number] : null;
}
/** An AI component's ErrorReason when it is a number other than 0, else null: Snow and Water on a photo without them came back with ErrorReason 1, and no dialog [handle: docs\reports\phase6\masks-capture\capture4-check.json steps `row4_snow`, `row4_water`]. */
export function aiError(m: Component): number | null {
  const n = Number(m[IMAGE.errorReason] ?? 0);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export const components = (e: Correction): Component[] => e[C.masks] as Component[];
