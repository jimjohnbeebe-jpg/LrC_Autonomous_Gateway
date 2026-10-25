// Spike S14's test charts and the colour maths that reads them (s14-config.ts has the plan). Both
// charts are 8-bit sRGB PNGs made with sharp, so Lightroom develops them on the rendered pipeline
// [handle: docs\reports\phase8\S10.md, the census put the PNG on the rendered pipeline], and each
// export is read back as patch means of the same grid:
//   - the grey wedge: WEDGE.cols columns from black to white (curve and grading);
//   - the hue chart: 360 patches, one per degree of HSV hue at HUE_CHART_SV, row by row (HSL bands).

import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

export type Rgb = [number, number, number];

export const CHART_SIZE = { width: 1800, height: 1200 } as const;
export const WEDGE = { file: "S14-grey-wedge.png", cols: 21, rows: 1 } as const;
export const HUE_CHART = { file: "S14-hue-chart.png", cols: 24, rows: 15 } as const;
export const HUE_CHART_SV = { s: 0.7, v: 0.9 } as const;
/** The wedge's sRGB level of column i. */
export const wedgeLevel = (i: number): number => Math.round((255 * i) / (WEDGE.cols - 1));

export function hsvToRgb(h: number, s: number, v: number): Rgb {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
  };
  return [f(5), f(3), f(1)];
}

/** HSV hue in degrees (0 for a grey) and saturation 0-1. */
export function rgbToHs([r, g, b]: Rgb): { hue: number; sat: number } {
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return { hue: 0, sat: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, sat: d / max };
}

/** The hue (degrees) and strength (0-1 of full scale) of a colour shift, e.g. a toned patch minus the same patch untoned. */
export function castOf(toned: Rgb, base: Rgb): { hue: number; strength: number } {
  const [r, g, b] = toned.map((v, i) => v - (base[i] as number)) as Rgb;
  const x = r - (g + b) / 2;
  const y = (Math.sqrt(3) / 2) * (g - b);
  return { hue: ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, strength: Math.hypot(x, y) / 255 };
}

const chartPixels = (pixel: (col: number, row: number) => Rgb, cols: number, rows: number): Buffer => {
  const { width, height } = CHART_SIZE;
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) buf.set(pixel(Math.floor((x * cols) / width), Math.floor((y * rows) / height)), (y * width + x) * 3);
  }
  return buf;
};

/** Both charts in `dir`, each written only when missing (Lightroom keeps the imported file in place). */
export async function makeCharts(dir: string): Promise<{ wedge: string; hue: string }> {
  mkdirSync(dir, { recursive: true });
  const out = { wedge: path.join(dir, WEDGE.file), hue: path.join(dir, HUE_CHART.file) };
  const write = async (file: string, pixels: Buffer): Promise<void> => {
    if (existsSync(file)) return;
    await sharp(pixels, { raw: { ...CHART_SIZE, channels: 3 } }).withIccProfile("srgb").png().toFile(file);
  };
  await write(out.wedge, chartPixels((c) => [wedgeLevel(c), wedgeLevel(c), wedgeLevel(c)], WEDGE.cols, WEDGE.rows));
  await write(out.hue, chartPixels((c, r) => hsvToRgb(r * HUE_CHART.cols + c, HUE_CHART_SV.s, HUE_CHART_SV.v), HUE_CHART.cols, HUE_CHART.rows));
  return out;
}

/** The mean colour of the middle half (each way) of every cell of a cols x rows grid, row by row. */
export async function gridMeans(image: Buffer, cols: number, rows: number): Promise<Rgb[]> {
  const { data, info } = await sharp(image).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
  const means: Rgb[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const [x0, x1] = [Math.floor(((c + 0.25) * info.width) / cols), Math.floor(((c + 0.75) * info.width) / cols)];
      const [y0, y1] = [Math.floor(((r + 0.25) * info.height) / rows), Math.floor(((r + 0.75) * info.height) / rows)];
      const sum = [0, 0, 0];
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) for (let k = 0; k < 3; k++) (sum[k] as number) += data[(y * info.width + x) * info.channels + k] as number;
      }
      const n = Math.max(1, (x1 - x0) * (y1 - y0));
      means.push(sum.map((s) => Math.round((s / n) * 10) / 10) as Rgb);
    }
  }
  return means;
}

const rad = (d: number): number => (d * Math.PI) / 180;
/** The weighted circular mean of angles in degrees, 0-360. */
export function circularMean(angles: number[], weights: number[] = angles.map(() => 1)): number {
  const x = angles.reduce((s, a, i) => s + (weights[i] as number) * Math.cos(rad(a)), 0);
  const y = angles.reduce((s, a, i) => s + (weights[i] as number) * Math.sin(rad(a)), 0);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
/** The signed difference a - b in degrees, -180 to 180. */
export const angleDiff = (a: number, b: number): number => ((((a - b) % 360) + 540) % 360) - 180;
