// Spike S14, part a: the tone curve (#187; s14-config.ts has the plan). Issue #187's write of
// ToneCurvePV2012 alone read back linear [handle: issue #187, logs\20261019-d8e4fc.json]. Each
// variant below starts from the photo's snapshot, is written and read back, and the photo is
// exported: on the grey wedge the 21 column levels show whether the render follows the curve, on the
// raw NEF the change from the unedited render shows whether anything happened. ToneCurveName2012
// "Custom" is the guess in #187 [unverified]; the pinned dumps hold "Linear" and "" [handle:
// engine\src\params\sdk-keys.lrc15.json, camera-profiles.lrc15.json]. The Parametric sliders are the
// fallback if no point curve is taken (PHASE10_PLAN risks).

import type { SdkSettings } from "../params/index.js";
import type { Json } from "./phase3-config.js";
import { WEDGE, type Rgb } from "./s14-charts.js";
import { history, readOf, renderGrid, takenAll, toSnapshot } from "./s14-config.js";
import { write, type Ctx, type Photo } from "./s10-config.js";

/** Issue #187's curve: [x0, y0, x1, y1, ...] in 0-255. */
const C187 = [0, 0, 64, 56, 128, 128, 192, 200, 255, 255];
/** The midtones lifted by 32 levels: easy to see on the wedge. */
const LIFT3 = [0, 0, 128, 160, 255, 255];
/** A strong S in 16 points (16 = 0, 17, 34 ... 255; y pulled away from x by up to 24 levels). */
const S16 = Array.from({ length: 16 }, (_, i) => {
  const x = i * 17;
  return [x, Math.round(Math.min(255, Math.max(0, x - 24 * Math.sin((2 * Math.PI * x) / 255))))];
}).flat();

export const CURVE_VARIANTS: ReadonlyArray<{ label: string; settings: SdkSettings }> = [
  { label: "issue187 (curve alone)", settings: { ToneCurvePV2012: C187 } },
  { label: "issue187 + name Custom", settings: { ToneCurveName2012: "Custom", ToneCurvePV2012: C187 } },
  { label: "issue187 + name Custom + EnableToneCurve", settings: { ToneCurveName2012: "Custom", ToneCurvePV2012: C187, EnableToneCurve: true } },
  { label: "3 points + name Custom", settings: { ToneCurveName2012: "Custom", ToneCurvePV2012: LIFT3 } },
  { label: "16 points + name Custom", settings: { ToneCurveName2012: "Custom", ToneCurvePV2012: S16 } },
  { label: "red channel, 3 points + name Custom", settings: { ToneCurveName2012: "Custom", ToneCurvePV2012Red: LIFT3 } },
  { label: "parametric darks -30, lights +30", settings: { ParametricDarks: -30, ParametricLights: 30 } },
];

const luma = ([r, g, b]: Rgb): number => 0.2126 * r + 0.7152 * g + 0.0722 * b;
/** The mean absolute change in column luma from the unedited render. */
const delta = (a: Rgb[], b: Rgb[]): number => Math.round((a.reduce((s, p, i) => s + Math.abs(luma(p) - luma(b[i] as Rgb)), 0) / a.length) * 10) / 10;
/** A render counts as changed when its columns moved by more than this many levels on average [inference: JPEG noise on a flat patch stays well under it]. */
export const CHANGED_LEVELS = 1.5;

export async function curveProbe(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const h = history("curve");
  const base = await renderGrid(ctx, photo, WEDGE.cols, WEDGE.rows);
  const variants: Json[] = [];
  for (const [i, v] of CURVE_VARIANTS.entries()) {
    await toSnapshot(ctx, photo, out);
    const w: Json = { label: v.label, written: v.settings };
    variants.push(w);
    const rb = await write(ctx, photo, v.settings, h(i + 1, CURVE_VARIANTS.length), w);
    if (!rb) continue;
    const levels = await renderGrid(ctx, photo, WEDGE.cols, WEDGE.rows);
    const moved = delta(levels, base);
    Object.assign(w, { read_back: readOf(v.settings, rb), name_read: rb["ToneCurveName2012"] ?? null, taken: takenAll(v.settings, rb), render_delta: moved, render_changed: moved > CHANGED_LEVELS, levels });
    ctx.deps.say(`  curve ${v.label}: taken ${String(w["taken"])}, render changed ${String(w["render_changed"])} (${moved} levels)`);
  }
  await toSnapshot(ctx, photo, out);
  return { base_levels: base, variants, completed: variants.length === CURVE_VARIANTS.length && variants.every((v) => typeof v["render_changed"] === "boolean") };
}

/** The first variant taken with a changed render: rewritten for Jim's question, or null. */
export function firstWorking(curve: Json): (typeof CURVE_VARIANTS)[number] | null {
  const ok = ((curve["variants"] as Json[] | undefined) ?? []).find((v) => v["taken"] === true && v["render_changed"] === true);
  return CURVE_VARIANTS.find((v) => v.label === ok?.["label"]) ?? null;
}
