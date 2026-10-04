// The mask table of getDevelopSettings() (GitHub issue #59, PR C step 2): the only file that names
// its fields (rule 03). Every field and type string below comes from Jim's two masks captures on LrC
// 15.6, never from documentation [handle: docs\reports\phase6\masks-capture\3_dump-1.json, the
// five-entry table (linear, radial, sky, subject, luminance); capture2-templates.json, the background
// entry]; engine\tests\params-mask-table.test.ts checks that each constant appears in those files.
//
// What the captures established [handle: docs\reports\phase6\masks-capture.md "Numbers"; check.json]:
//   - the table is an array of corrections, each with its components in CorrectionMasks; two reads
//     give identical tables, ids included, and the unchanged table written back reads back identical;
//   - new entries with fresh ids in the captured formats are taken; geometry, CorrectionName and
//     CorrectionActive write and read back; writing the array without an entry deletes just it;
//   - a photo without masks may have no table at all: absent, [] and {} count as the same here.
// The local sliders' scales are capture 2's [handle: capture2-calibration.json `fields`]: the panel
// shows scale x stored, offset 0. LocalToningHue is pinned 1:1 in degrees [stated: Jim, 2026-10-03,
// "Pin 1:1, verify in final check (Recommended)"]; that it is 1:1 is [inference] (capture 2 flagged it).

import { randomUUID } from "node:crypto";
import { z } from "zod";

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
export const IMAGE = { subType: "MaskSubType", subCategory: "MaskSubCategoryID", maskVersion: "MaskVersion", digest: "MaskDigest", referencePoint: "ReferencePoint" } as const;
export const RANGE = { holder: "CorrectionRangeMask", lumRange: "LumRange", type: "Type", version: "Version", sampleType: "SampleType", sampleInfo: "LuminanceDepthSampleInfo", invert: "Invert" } as const;

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

/** JSON with object keys sorted, so two reads of the same table give the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v) ?? "null";
}

/** How many corrections the table holds, and its fingerprint (equal tables, equal text; absent = [] = {}). Never throws. */
export function tableInfo(sdk: Readonly<Record<string, unknown>>): { count: number; fingerprint: string } {
  const raw = sdk[MASK_TABLE_KEY];
  if (isEmpty(raw)) return { count: 0, fingerprint: "[]" };
  return { count: Array.isArray(raw) ? raw.length : 0, fingerprint: stable(raw) };
}

/** `written`'s fields all in `got` with equal values (numbers within 1e-6); fields Lightroom adds are its own. */
function covers(written: unknown, got: unknown): boolean {
  if (typeof written === "number" && typeof got === "number") return Math.abs(written - got) <= 1e-6;
  if (written && typeof written === "object" && got && typeof got === "object") {
    if (isEmpty(written) || isEmpty(got)) return isEmpty(written) && isEmpty(got);
    if (Array.isArray(written) && (!Array.isArray(got) || written.length !== got.length)) return false;
    return Object.entries(written).every(([k, x]) => k in got && covers(x, (got as Record<string, unknown>)[k]));
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
 * The AI kinds as data, one entry per kind: the fields that tell it (MaskSubType, MaskSubCategoryID),
 * LrDevelopController's subtype when that route made it, and whether it needs a point on the photo.
 *   - subject 1, sky 2, background 0 + 22 [handle: docs\reports\phase6\masks-capture\3_dump-1.json
 *     entries 2-3; capture2-templates.json `background`]; LrDevelopController made all three
 *     [handle: 12_probe_dc.json; capture2-templates.json];
 *   - people (Entire Person 0 + 20036, Face Skin 0 + 2) and landscape (Vegetation 0 + 50005, Sky 0 +
 *     50006), each in its own correction [handle: capture3-templates.json, _DSC0028.NEF]. Capture 2's
 *     createNewMask made no people or landscape mask [handle: capture2-transcript.txt], so they have
 *     no fallback. 20036 is one person on one photo: that it holds for every person is [unverified];
 *     other people parts and landscape categories were not offered on that photo, so they are refused.
 * A component is written with these fields only, plus a person's point (ReferencePoint, as captured
 * "x y" in 0-1): digests and the photo's own fields (ModelVersion, Origin, FullMaskSize,
 * WholeImageArea) are left out. Copies on the same photo computed after update_ai_settings
 * [handle: check.json `7_sky`; capture3-check.json]; that a stripped entry computes on another photo is
 * [unverified] (Jim's mask tools check tries it; a mask that does not compute falls back, ai-masks.ts).
 */
export type AiKind = "subject" | "sky" | "background" | "people_entire" | "people_face_skin" | "landscape_vegetation" | "landscape_sky";
export type MaskKind = "linear" | "radial" | "luminance" | AiKind;
type AiSpec = { dc: string | null; label: string; point: boolean; fields: Readonly<Record<string, number>> };
const ai = (subType: number, subCategory: number | null, label: string, dc: string | null, point = false): AiSpec => ({
  dc,
  label,
  point,
  fields: { [IMAGE.subType]: subType, ...(subCategory !== null ? { [IMAGE.subCategory]: subCategory } : {}), [IMAGE.maskVersion]: 1 },
});
export const AI_KINDS: Readonly<Record<AiKind, AiSpec>> = {
  subject: ai(1, null, "Subject", "subject"),
  sky: ai(2, null, "Sky", "sky"),
  background: ai(0, 22, "Background", "background"),
  people_entire: ai(0, 20036, "Person", null, true),
  people_face_skin: ai(0, 2, "Person - Facial Skin", null, true),
  landscape_vegetation: ai(0, 50005, "Vegetation", null),
  landscape_sky: ai(0, 50006, "Landscape Sky", null),
};
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

/** A new id in the captured formats: CorrectionID / MaskID as an upper-case UUID, the sync ids as 32 upper-case hex digits. */
export const newMaskId = (): string => randomUUID().toUpperCase();
export const newSyncId = (): string => randomUUID().replace(/-/g, "").toUpperCase();

/** Whether an AI component has computed: Lightroom writes its digest once it has [handle: check.json `7_sky.new_digests`]. */
export const computed = (m: Component): boolean => typeof m[IMAGE.digest] === "string" && m[IMAGE.digest] !== "";

// ---- summaries: a correction as the tools show it (mask-ops.ts, session\masks.ts, the session log)

export type MaskSummary = {
  id: string;
  name: string;
  kind: string;
  active: boolean;
  inverted: boolean;
  components: number;
  /** Local sliders not at 0, in the panel's units. */
  sliders: Record<string, number>;
  geometry?: Record<string, unknown>;
  /** AI kinds: whether Lightroom has computed the mask. */
  computed?: boolean;
};

const round = (v: number): number => Math.round(v * 100) / 100;
export const components = (e: Correction): Component[] => e[C.masks] as Component[];
const nameOf = (e: Correction): string => (typeof e[C.name] === "string" ? (e[C.name] as string) : String(e[C.id]));

function geometryOf(m: Component): Record<string, unknown> | undefined {
  const kind = componentKind(m);
  if (kind === "linear") return { zero: { x: m[LINEAR.zeroX], y: m[LINEAR.zeroY] }, full: { x: m[LINEAR.fullX], y: m[LINEAR.fullY] } };
  if (kind === "radial") return { left: m[RADIAL.left], top: m[RADIAL.top], right: m[RADIAL.right], bottom: m[RADIAL.bottom], feather: m[RADIAL.feather] };
  if (kind === "luminance") {
    const lum = (m[RANGE.holder] as Record<string, unknown>)[RANGE.lumRange];
    return { lum_range: typeof lum === "string" ? lum.split(/\s+/).map(Number) : lum };
  }
  const at = m[IMAGE.referencePoint];
  if (typeof at === "string") {
    const [x, y] = at.split(/\s+/).map(Number);
    return { point: { x, y } };
  }
  return undefined;
}

/** A correction as the tools show it: id, name, kind, on/off, sliders in panel units, geometry. */
export function summarize(e: Correction): MaskSummary {
  const parts = components(e);
  const first = parts[0];
  const kinds = [...new Set(parts.map(componentKind))];
  const sliders: Record<string, number> = {};
  for (const [name, p] of LOCAL_PARAMS) {
    const v = e[p.field];
    if (typeof v === "number" && v !== 0) sliders[name] = round(v * p.scale);
  }
  const geometry = parts.length === 1 && first ? geometryOf(first) : undefined;
  const ai = parts.filter((m) => m[M.what] === WHAT.image);
  return {
    id: String(e[C.id]),
    name: nameOf(e),
    kind: kinds.length === 1 ? (kinds[0] as string) : "mixed",
    active: e[C.active] !== false,
    inverted: parts.length > 0 && parts.every((m) => m[M.inverted] === true),
    components: parts.length,
    sliders,
    ...(geometry ? { geometry } : {}),
    ...(ai.length > 0 ? { computed: ai.every(computed) } : {}),
  };
}

