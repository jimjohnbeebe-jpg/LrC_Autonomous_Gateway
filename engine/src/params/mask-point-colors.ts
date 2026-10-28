// A mask's Point Color swatches (GitHub issue #217 row 4; upstream's edit_mask_point_colors / get_mask_point_colors,
// which drive LrDevelopController's *PointColorSwatch calls [upstream claim: Automaat/lightroom-mcp 581ad7c, #328]),
// here on the mask table, so a change goes through the session's pass. Field names come only from mask-table.ts
// (rule 03): the correction's LocalPointColors, an array of one string per swatch, as Lightroom stored two swatches
// Jim set on his "Mountains" mask [handle: docs\reports\phase8\probes\kinds.json, `.-Rendered.dng.settings.
// MaskGroupBasedCorrections[0].LocalPointColors`; the same entry in engine\src\params\sdk-keys.lrc15.rendered.json].
//
// Each string is 19 numbers, "%.6f" joined by ", " [handle: same capture]. Which number is which is not stored:
// ORDER below is upstream's swatch field order (MaskPointColors.lua SCALARS then RANGES, each range LowerNone,
// LowerFull, UpperFull, UpperNone) [upstream claim: MaskPointColors.lua:9-21 at 1040453], and it fits the capture
// [inference: numbers 8-11 are 0, 0.33, 0.67, 1, the HueRange the global PointColors of the same dump stores by
// name; numbers 4-6 sit in -1..1 and 7 in 0..1]. Writing a new swatch in this form is [unverified] until Jim's
// `npm run masks:parity`. Swatches the call does not touch are written back as the strings Lightroom stored.

import { C, MaskError, type Correction } from "./mask-table.js";

/** Four edges, each 0-1 and at least the one before (checked, not typed). */
export type Edges = number[];
/** A swatch in the tools' names: the source colour (hue 0-6, saturation and luminance 0-1), its shifts (-1..1), the range amount (0-1) and three ranges. */
export type Swatch = {
  src_hue: number;
  src_sat: number;
  src_lum: number;
  hue_shift: number;
  sat_scale: number;
  lum_scale: number;
  range_amount: number;
  hue_range: Edges;
  sat_range: Edges;
  lum_range: Edges;
};
export type SwatchPatch = { [K in keyof Swatch]?: Swatch[K] | undefined };
export type PointColorsOp = { action: "add" | "update" | "delete" | "clear"; index?: number | undefined; swatch?: SwatchPatch | undefined };

const SCALARS = [
  ["src_hue", 0, 6],
  ["src_sat", 0, 1],
  ["src_lum", 0, 1],
  ["hue_shift", -1, 1],
  ["sat_scale", -1, 1],
  ["lum_scale", -1, 1],
  ["range_amount", 0, 1],
] as const;
const RANGES = ["hue_range", "sat_range", "lum_range"] as const;
/** Up to 8 swatches on a mask [upstream claim: MaskPointColors.lua:6, MAX_SWATCHES]. */
export const MAX_SWATCHES = 8;
/**
 * What a new swatch takes when not given: no shift, range amount 0.5 and each range 0, 0.33, 0.67, 1 [inference:
 * the global swatch of the same dump has RangeAmount 0.5 and that HueRange, and both local swatches that HueRange;
 * Lightroom's own defaults for the other two ranges are not captured].
 */
const DEFAULTS = { hue_shift: 0, sat_scale: 0, lum_scale: 0, range_amount: 0.5, hue_range: [0, 0.33, 0.67, 1], sat_range: [0, 0.33, 0.67, 1], lum_range: [0, 0.33, 0.67, 1] } as const;

const invalid = (message: string): never => {
  throw new MaskError("INVALID_ARGUMENTS", message);
};

/** A stored swatch string as a Swatch, or null when it is not 19 numbers. */
export function parseSwatch(s: unknown): Swatch | null {
  if (typeof s !== "string") return null;
  const n = s.split(",").map((t) => Number(t.trim()));
  if (n.length !== 19 || !n.every(Number.isFinite)) return null;
  const out: Record<string, unknown> = Object.fromEntries(SCALARS.map(([k], i) => [k, n[i]]));
  RANGES.forEach((k, r) => (out[k] = n.slice(7 + r * 4, 11 + r * 4)));
  return out as Swatch;
}

/** A Swatch in Lightroom's stored form. */
export const formatSwatch = (w: Swatch): string => [...SCALARS.map(([k]) => w[k]), ...RANGES.flatMap((k) => w[k])].map((v) => v.toFixed(6)).join(", ");

/** The swatch fields given, checked against their ranges; `full` needs the source colour. */
function checkSwatch(w: SwatchPatch | undefined, full: boolean): SwatchPatch {
  if (!w || Object.keys(w).length === 0) return invalid("point_colors needs swatch with at least one field.");
  for (const [k, lo, hi] of SCALARS) {
    const v = w[k];
    if (v === undefined) {
      if (full && k.startsWith("src_")) invalid(`point_colors add needs swatch.${k}.`);
    } else if (!Number.isFinite(v) || v < lo || v > hi) invalid(`swatch.${k} = ${v} is outside ${lo}..${hi}.`);
  }
  for (const k of RANGES) {
    const e = w[k];
    if (e !== undefined && (e.length !== 4 || !e.every((v, i) => Number.isFinite(v) && v >= 0 && v <= 1 && (i === 0 || v >= (e[i - 1] as number))))) invalid(`swatch.${k} needs four numbers in 0-1, each at least the one before.`);
  }
  return w;
}

/** Refuse what can be refused without the photo's table. */
export function precheckPointColors(op: PointColorsOp): void {
  if (op.action === "add") checkSwatch(op.swatch, true);
  if (op.action === "update") checkSwatch(op.swatch, false);
  if ((op.action === "update" || op.action === "delete") && (op.index === undefined || !Number.isInteger(op.index) || op.index < 1)) invalid(`point_colors ${op.action} needs index (1 = the first swatch).`);
  if ((op.action === "clear" || op.action === "delete") && op.swatch !== undefined) invalid(`point_colors ${op.action} takes no swatch.`);
}

/** The correction's stored swatch strings, each read; MASK_TABLE_UNREADABLE when one is not in the captured form. */
export function storedSwatches(e: Correction): Array<{ raw: string; swatch: Swatch }> {
  const raw = e[C.pointColors];
  if (raw === undefined || (Array.isArray(raw) && raw.length === 0)) return [];
  const list = Array.isArray(raw) ? raw.map((s) => ({ raw: s as string, swatch: parseSwatch(s) })) : [];
  if (!Array.isArray(raw) || list.some((x) => x.swatch === null)) throw new MaskError("MASK_TABLE_UNREADABLE", "This mask's Point Color swatches are not in the form Lightroom stored in the captures; nothing was written.");
  return list as Array<{ raw: string; swatch: Swatch }>;
}

/** The fields a patch gives, without those left undefined. */
const given = (p: SwatchPatch | undefined): SwatchPatch => Object.fromEntries(Object.entries(p ?? {}).filter(([, v]) => v !== undefined));

const sameSource = (a: Swatch, b: SwatchPatch): boolean => (["src_hue", "src_sat", "src_lum"] as const).every((k) => Math.abs(a[k] - (b[k] ?? NaN)) <= 0.01);

/** `op` applied to correction `e` (in place): its LocalPointColors written, untouched swatches as stored. */
export function applyPointColors(e: Correction, op: PointColorsOp): void {
  precheckPointColors(op);
  const list = storedSwatches(e);
  const at = (op.index ?? 0) - 1;
  if ((op.action === "update" || op.action === "delete") && !list[at]) invalid(`This mask has ${list.length} Point Color swatches; there is no swatch ${op.index}.`);
  if (op.action === "clear") list.length = 0;
  if (op.action === "delete") list.splice(at, 1);
  if (op.action === "update") {
    const w = { ...(list[at] as { swatch: Swatch }).swatch, ...given(op.swatch) } as Swatch;
    list[at] = { raw: formatSwatch(w), swatch: w };
  }
  if (op.action === "add") {
    if (list.length >= MAX_SWATCHES) invalid(`A mask holds up to ${MAX_SWATCHES} Point Color swatches; delete one first.`);
    if (list.some((x) => sameSource(x.swatch, op.swatch as SwatchPatch))) invalid("This mask already has a swatch of that source colour: update it instead.");
    const w = { ...DEFAULTS, ...given(op.swatch) } as Swatch;
    list.push({ raw: formatSwatch(w), swatch: w });
  }
  e[C.pointColors] = list.map((x) => x.raw);
}

/** The swatches as lr_list_masks shows them (1 = the first), or the stored strings when they do not read. */
export function pointColorsOf(e: Correction): Array<Swatch | string> | undefined {
  try {
    const list = storedSwatches(e);
    return list.length > 0 ? list.map((x) => x.swatch) : undefined;
  } catch {
    return e[C.pointColors] as string[];
  }
}
