// Spike S14, part c: the HSL bands (s14-config.ts has the plan). On the hue chart each band's
// saturation is set to -100 in turn (the other seven at the photo's own value); each patch's loss of
// HSV saturation against the unedited render gives the band's centre (circular mean of the hues
// losing at least half the peak), its width at half the peak (FWHM, in degrees: one patch per
// degree) and its extent (hues losing more than EXTENT_LOSS). The bands are measured in the sRGB of
// the export, which is what the engine measures [inference: Lightroom's own band space is unknown].

import { circularMean, HUE_CHART, HUE_CHART_SV, rgbToHs, type Rgb } from "./s14-charts.js";
import type { Json } from "./phase3-config.js";
import { history, readOf, renderGrid, takenAll, toSnapshot } from "./s14-config.js";
import { write, type Ctx, type Photo } from "./s10-config.js";

export const BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"] as const;
export const EXTENT_LOSS = 0.1;

/** A band from the patches' saturation before and after (index = hue in degrees); null when nothing lost saturation. */
export function bandOf(base: Rgb[], after: Rgb[]): Json | null {
  const loss = base.map((b, i) => {
    const s0 = rgbToHs(b).sat;
    return s0 > 0.05 ? Math.max(0, 1 - rgbToHs(after[i] as Rgb).sat / s0) : 0;
  });
  const peak = Math.max(...loss);
  if (peak < EXTENT_LOSS) return null;
  const half = loss.map((l, h) => [h, l] as const).filter(([, l]) => l >= peak / 2);
  return {
    centre_deg: Math.round(circularMean(half.map(([h]) => h), half.map(([, l]) => l))),
    fwhm_deg: half.length,
    extent_deg: loss.filter((l) => l > EXTENT_LOSS).length,
    peak_loss: Math.round(peak * 1000) / 1000,
    loss_by_degree: loss.map((l) => Math.round(l * 100) / 100),
  };
}

export async function hslProbe(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const keys = BANDS.map((b) => ctx.deps.map.spec(`hsl.${b}.sat`, photo.pipeline === "raw" ? "raw" : "rendered")?.sdkKey);
  if (keys.some((k) => k === undefined)) throw new Error("the params map lacks an hsl.<band>.sat");
  const start = Object.fromEntries((keys as string[]).map((k) => [k, photo.start[k] ?? 0]));
  const cells = HUE_CHART.cols * HUE_CHART.rows;
  const base = (await renderGrid(ctx, photo, HUE_CHART.cols, HUE_CHART.rows)).slice(0, cells);
  const bands: Json[] = [];
  for (const [i, band] of BANDS.entries()) {
    const key = keys[i] as string;
    const settings = { ...start, [key]: -100 };
    const b: Json = { band, key };
    bands.push(b);
    const rb = await write(ctx, photo, settings, history("hsl")(i + 1, BANDS.length), b);
    if (!rb) continue;
    const found = bandOf(base, await renderGrid(ctx, photo, HUE_CHART.cols, HUE_CHART.rows));
    Object.assign(b, { read_back: readOf({ [key]: -100 }, rb), taken: takenAll({ [key]: -100 }, rb), measured: found });
    ctx.deps.say(`  hsl ${band}: ${found ? `centre ${String(found["centre_deg"])} deg, FWHM ${String(found["fwhm_deg"])} deg, extent ${String(found["extent_deg"])} deg` : "no saturation lost"}`);
  }
  await toSnapshot(ctx, photo, out);
  return { chart_sv: HUE_CHART_SV, bands, completed: bands.every((b) => b["measured"] !== undefined) };
}
