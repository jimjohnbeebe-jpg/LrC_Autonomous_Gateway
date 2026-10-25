// Spike S14, part b: the grading wheels (s14-config.ts has the plan). The params map writes the
// shadow and highlight wheels' hue and saturation as SplitToning* keys, which is [inference]
// (engine\src\params\canonical.ts:101-104): the dump has no ColorGrade hue/saturation keys for them.
// Each wheel is swept through GRADE_HUES at GRADE_SAT on the grey wedge, from the snapshot each
// time; the cast of the wheel's own columns against the unedited render gives the sRGB hue each
// wheel hue lands on, and fitConvention says how Lightroom's hue maps to it (direction and offset).
// The midtones wheel (ColorGradeMidtone*, native keys) is swept too, as the control.

import { angleDiff, castOf, circularMean, WEDGE, type Rgb } from "./s14-charts.js";
import type { Json } from "./phase3-config.js";
import { history, readOf, renderGrid, takenAll, toSnapshot } from "./s14-config.js";
import { write, type Ctx, type Photo } from "./s10-config.js";

export const GRADE_HUES = Array.from({ length: 12 }, (_, i) => i * 30);
export const GRADE_SAT = 60;
/** Each wheel's keys and the wedge columns of its tonal range (0 black ... 20 white). */
export const WHEELS = [
  { wheel: "shadows", hue: "SplitToningShadowHue", sat: "SplitToningShadowSaturation", cols: [3, 4, 5, 6] },
  { wheel: "midtones", hue: "ColorGradeMidtoneHue", sat: "ColorGradeMidtoneSat", cols: [9, 10, 11] },
  { wheel: "highlights", hue: "SplitToningHighlightHue", sat: "SplitToningHighlightSaturation", cols: [14, 15, 16, 17] },
] as const;
/** A cast weaker than this (of full scale) is not measured [inference: about 5 levels, above JPEG noise]. */
export const MIN_STRENGTH = 0.02;

type Pair = { set: number; hue: number; strength: number };

/** measured = direction * set + offset (degrees), fitted on the pairs strong enough to read; null when fewer than half are. */
export function fitConvention(pairs: Pair[]): Json | null {
  const used = pairs.filter((p) => p.strength >= MIN_STRENGTH);
  if (used.length < pairs.length / 2) return null;
  const fits = [1, -1].map((direction) => {
    const offsets = used.map((p) => (p.hue - direction * p.set + 720) % 360);
    const offset = circularMean(offsets);
    const rms = Math.sqrt(offsets.reduce((s, o) => s + angleDiff(o, offset) ** 2, 0) / offsets.length);
    return { direction, offset_deg: Math.round(offset * 10) / 10, rms_deg: Math.round(rms * 10) / 10, pairs_used: used.length };
  });
  return fits[0]!.rms_deg <= fits[1]!.rms_deg ? fits[0]! : fits[1]!;
}

const mean = (cells: Rgb[], cols: readonly number[]): Rgb =>
  [0, 1, 2].map((k) => cols.reduce((s, c) => s + (cells[c] as Rgb)[k]!, 0) / cols.length) as Rgb;

export async function gradingProbe(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const base = await renderGrid(ctx, photo, WEDGE.cols, WEDGE.rows);
  const wheels: Json[] = [];
  for (const w of WHEELS) {
    await toSnapshot(ctx, photo, out);
    const steps: Json[] = [];
    const pairs: Pair[] = [];
    for (const [i, hue] of GRADE_HUES.entries()) {
      const settings = { [w.hue]: hue, [w.sat]: GRADE_SAT };
      const step: Json = { set_hue: hue };
      steps.push(step);
      const rb = await write(ctx, photo, settings, history(`grade ${w.wheel}`)(i + 1, GRADE_HUES.length), step);
      if (!rb) continue;
      const cells = await renderGrid(ctx, photo, WEDGE.cols, WEDGE.rows);
      const cast = castOf(mean(cells, w.cols), mean(base, w.cols));
      pairs.push({ set: hue, ...cast });
      Object.assign(step, { read_back: readOf(settings, rb), taken: takenAll(settings, rb), hue: Math.round(cast.hue), strength: Math.round(cast.strength * 1000) / 1000,
        column_strengths: cells.map((c, k) => Math.round(castOf(c, base[k] as Rgb).strength * 1000) / 1000) });
    }
    const convention = fitConvention(pairs);
    wheels.push({ wheel: w.wheel, keys: [w.hue, w.sat], columns: w.cols, steps, convention, completed: pairs.length === GRADE_HUES.length });
    ctx.deps.say(`  grading ${w.wheel}: ${convention ? `measured hue = ${String(convention["direction"])} x set + ${String(convention["offset_deg"])} deg (rms ${String(convention["rms_deg"])})` : "no convention (casts too weak or writes failed)"}`);
  }
  await toSnapshot(ctx, photo, out);
  return { sat: GRADE_SAT, base_levels: base, wheels, completed: wheels.every((w) => w["completed"] === true) };
}
