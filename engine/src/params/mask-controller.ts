// A mask's local curves and Point Color swatches as LrDevelopController names them (GitHub issue #217 row 3 and the
// Point Color fix): the plugin's mask_controller (plugin\LrC-AVG.lrplugin\MaskControl.lua) sets and reads them on the
// mask selected in Develop, with the names and values built here (rule 03: no other module writes them).
//
// Names. The parameters "local_Maincurve", "local_Redcurve", "local_Greencurve", "local_Bluecurve" and
// "local_PointColors" are in the reference's "Localized Adjustments" lists (Version 5 and 6), and the swatch fields
// SrcHue, SrcSat, SrcLum (hue 0-6, the others 0-1), HueShift, SatScale, LumScale (-1..1), RangeAmount (0-1) and the
// HueRange, SatRange, LumRange tables of LowerNone, LowerFull, UpperFull, UpperNone (0-1) are addPointColorSwatch's
// [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\LrDevelopController.html, SDK 15.2]. They are
// from documentation, not from a live dump: candidates under rule 03 as amended [stated: Jim, 2026-10-28], trusted once
// `npm run masks:parity` (part controller, docs\reports\phase11\MASK-CONTROLLER.md) has round-tripped them in Lightroom.
//
// Curves. A curve is a flat list of input/output pairs, 0-255, 2-32 pairs, inputs rising from 0 to 255 [upstream claim:
// Automaat/lightroom-mcp 581ad7c (#328), MaskCurves.lua at 1040453; the reference documents setValue's value only as a
// number]. The tools give pairs ([[0, 0], [128, 150], [255, 255]]) and get pairs back.

import { MaskError } from "./mask-table.js";
import { MAX_SWATCHES, precheckPointColors, type PointColorsOp, type SwatchPatch } from "./mask-point-colors.js";

export const CURVE_CHANNELS = ["main", "red", "green", "blue"] as const;
export type CurveChannel = (typeof CURVE_CHANNELS)[number];
/** [input, output] pairs (each checked to be two numbers: the tools' schema avoids tuples, which some MCP clients refuse [inference]). */
export type CurvePoints = number[][];
export type Curves = { [K in CurveChannel]?: CurvePoints | undefined };

const CURVE_PARAMS: Record<CurveChannel, string> = { main: "local_Maincurve", red: "local_Redcurve", green: "local_Greencurve", blue: "local_Bluecurve" };
export const POINT_COLORS_PARAM = "local_PointColors";
/** 2-32 pairs, each number 0-255 [upstream claim: MaskCurves.lua MIN_PAIRS, MAX_PAIRS, CURVE_MAX]. */
export const CURVE_LIMITS = { pairs: [2, 32], top: 255 } as const;
/** Every parameter mask_controller reads for a mask's live state. */
export const CONTROLLER_PARAMS: readonly string[] = [...CURVE_CHANNELS.map((k) => CURVE_PARAMS[k]), POINT_COLORS_PARAM];

const SCALARS = { src_hue: "SrcHue", src_sat: "SrcSat", src_lum: "SrcLum", hue_shift: "HueShift", sat_scale: "SatScale", lum_scale: "LumScale", range_amount: "RangeAmount" } as const;
const RANGES = { hue_range: "HueRange", sat_range: "SatRange", lum_range: "LumRange" } as const;
const EDGES = ["LowerNone", "LowerFull", "UpperFull", "UpperNone"] as const;

const invalid = (message: string): never => {
  throw new MaskError("INVALID_ARGUMENTS", message);
};

/** Refuse a curve Lightroom would not take: 2-32 pairs of whole numbers 0-255, inputs strictly rising from 0 to 255. */
export function checkCurves(c: Curves): void {
  const given = CURVE_CHANNELS.filter((k) => c[k] !== undefined);
  if (given.length === 0) invalid(`curves needs at least one of ${CURVE_CHANNELS.join(", ")}.`);
  for (const k of given) {
    const pts = c[k] as CurvePoints;
    const [lo, hi] = CURVE_LIMITS.pairs;
    if (pts.length < lo || pts.length > hi) invalid(`curves.${k} needs ${lo}-${hi} points.`);
    if (pts.some((p) => p.length !== 2)) invalid(`curves.${k}: each point is [input, output].`);
    if (!pts.flat().every((v) => Number.isInteger(v) && v >= 0 && v <= CURVE_LIMITS.top)) invalid(`curves.${k}: every input and output is a whole number 0-${CURVE_LIMITS.top}.`);
    if (pts[0]?.[0] !== 0 || pts.at(-1)?.[0] !== CURVE_LIMITS.top) invalid(`curves.${k} starts at input 0 and ends at input ${CURVE_LIMITS.top}.`);
    if (pts.some((p, i) => i > 0 && (p[0] as number) <= (pts[i - 1]?.[0] as number))) invalid(`curves.${k}: inputs must rise from point to point.`);
  }
}

/** The curves as mask_controller sets them. */
export const curveWrites = (c: Curves): Array<{ param: string; points: number[] }> =>
  CURVE_CHANNELS.filter((k) => c[k] !== undefined).map((k) => ({ param: CURVE_PARAMS[k], points: (c[k] as CurvePoints).flat() }));

/** The curves among values read through the controller, as pairs; a channel that did not read as numbers is left out. */
export function curvesOf(values: Readonly<Record<string, unknown>>): Curves {
  const out: Curves = {};
  for (const k of CURVE_CHANNELS) {
    const v = values[CURVE_PARAMS[k]];
    if (!Array.isArray(v) || v.length % 2 !== 0 || !v.every((n) => typeof n === "number")) continue;
    out[k] = Array.from({ length: v.length / 2 }, (_, i) => [v[2 * i] as number, v[2 * i + 1] as number]);
  }
  return out;
}

/** A swatch in the controller's field names: only the fields given. */
export function toController(w: SwatchPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(SCALARS)) if (w[k as keyof typeof SCALARS] !== undefined) out[f] = w[k as keyof typeof SCALARS];
  for (const [k, f] of Object.entries(RANGES)) {
    const e = w[k as keyof typeof RANGES];
    if (e !== undefined) out[f] = Object.fromEntries(EDGES.map((edge, i) => [edge, e[i]]));
  }
  return out;
}

/** A swatch read through the controller, in the tools' names (fields it lacks left out). */
export function fromController(raw: unknown): SwatchPatch {
  const r = (raw ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(SCALARS)) if (typeof r[f] === "number") out[k] = r[f];
  for (const [k, f] of Object.entries(RANGES)) {
    const t = r[f] as Record<string, unknown> | undefined;
    if (t && EDGES.every((e) => typeof t[e] === "number")) out[k] = EDGES.map((e) => t[e]);
  }
  return out as SwatchPatch;
}

/** The swatch list read through the controller (Lua's empty table reads as [] or {}). */
export const swatchesOf = (values: Readonly<Record<string, unknown>>): SwatchPatch[] => {
  const v = values[POINT_COLORS_PARAM];
  return Array.isArray(v) ? v.map(fromController) : [];
};

/** One Point Color change as mask_controller makes it; `max`: the most swatches a mask holds. */
export function swatchRequest(op: PointColorsOp): { param: string; action: PointColorsOp["action"]; index?: number; swatch?: Record<string, unknown>; max: number } {
  precheckPointColors(op);
  return { param: POINT_COLORS_PARAM, action: op.action, ...(op.index !== undefined ? { index: op.index } : {}), ...(op.swatch ? { swatch: toController(op.swatch) } : {}), max: MAX_SWATCHES };
}

/** The undo of a Point Color change: the list Lightroom gave before it, written back as it was given. */
export const swatchRestore = (values: Readonly<Record<string, unknown>>): { param: string; action: "set"; list: unknown[] } => {
  const v = values[POINT_COLORS_PARAM];
  return { param: POINT_COLORS_PARAM, action: "set", list: Array.isArray(v) ? v : [] };
};

/** The undo of curve writes: each written curve's value before. */
export const curveRestore = (values: Readonly<Record<string, unknown>>, written: readonly string[]): Array<{ param: string; points: number[] }> =>
  written.filter((p) => p !== POINT_COLORS_PARAM && Array.isArray(values[p])).map((p) => ({ param: p, points: values[p] as number[] }));
