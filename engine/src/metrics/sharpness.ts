// Sharpness of a rendered preview (issue #216): the variance of the four-neighbour Laplacian of the
// luma, after area resampling to a SHARPNESS_LONG_EDGE (512) px long edge. The reference definition is
// Automaat's get_photo_stats [upstream claim: Automaat/lightroom-mcp 1040453, server/src/photo-stats.ts
// photoStats]; this is the same arithmetic on the pixels sharp decoded (rule 01: no jpeg-js):
//   luma       Rec. 709 weights on the 8-bit values (LUMA_WEIGHTS, the luma of compute.ts too)
//   resampling every output pixel is the area-weighted mean of the source pixels its box covers
//              (box widths width / out_width and height / out_height; out_* = round(size * 512 / long
//              edge), at least 3); smaller images are enlarged the same way
//   laplacian  L = up + down + left + right - 4 * centre, on every output pixel that has all four
//              neighbours; sharpness = mean(L^2) - mean(L)^2
// Higher is sharper (more fine detail, or more noise: noise raises it too [inference: noise is
// high-frequency energy, which the Laplacian measures]). Fixing the long edge makes the number
// independent of the preview's size; comparing two renders of one photo is what it is for.
// A region's sharpness is measured on the same 512 px grid, over the grid pixels its box covers, so it
// compares with the frame's; null when the box covers no grid pixel with four neighbours.

import type { PixelRect } from "./regions.js";

export const SHARPNESS_LONG_EDGE = 512;
/** Rec. 709 luma weights, the luma of stats.ts too (they live here so this file imports nothing from it). */
export const LUMA_WEIGHTS = { r: 0.2126, g: 0.7152, b: 0.0722 } as const;

/** The resampled luma plane, and the scale from source pixels to it. */
export type LumaGrid = { data: Float64Array; width: number; height: number; sx: number; sy: number };

const at = (data: Uint8Array, i: number): number =>
  LUMA_WEIGHTS.r * (data[i] as number) + LUMA_WEIGHTS.g * (data[i + 1] as number) + LUMA_WEIGHTS.b * (data[i + 2] as number);

/** One axis's source span per output index: the first source index, and the weight of each source index it covers. */
function spans(size: number, out: number): Array<{ first: number; weights: number[] }> {
  const d = size / out;
  return Array.from({ length: out }, (_, o) => {
    const lo = o * d;
    const hi = (o + 1) * d;
    const weights: number[] = [];
    for (let s = Math.floor(lo); s < Math.ceil(hi); s++) weights.push(Math.min(s + 1, hi) - Math.max(s, lo));
    return { first: Math.floor(lo), weights };
  });
}

/** Area-resample the luma of interleaved 8-bit pixels (3 or 4 channels) to `longEdge`. */
export function resampleLuma(data: Uint8Array, width: number, height: number, channels: number, longEdge = SHARPNESS_LONG_EDGE): LumaGrid {
  const scale = longEdge / Math.max(width, height);
  const ow = Math.max(3, Math.round(width * scale));
  const oh = Math.max(3, Math.round(height * scale));
  const xs = spans(width, ow);
  const ys = spans(height, oh);
  const area = (width / ow) * (height / oh);
  const out = new Float64Array(ow * oh);
  for (let y = 0; y < oh; y++) {
    const { first: y0, weights: wy } = ys[y]!;
    for (let x = 0; x < ow; x++) {
      const { first: x0, weights: wx } = xs[x]!;
      let total = 0;
      for (let j = 0; j < wy.length; j++) {
        const rowStart = Math.min(height - 1, y0 + j) * width;
        let line = 0;
        for (let i = 0; i < wx.length; i++) line += at(data, (rowStart + Math.min(width - 1, x0 + i)) * channels) * wx[i]!;
        total += line * wy[j]!;
      }
      out[y * ow + x] = total / area;
    }
  }
  return { data: out, width: ow, height: oh, sx: ow / width, sy: oh / height };
}

/**
 * Laplacian variance over the grid pixels that `rect` (in source pixels; the whole image when absent)
 * covers and that have four neighbours; rounded to 3 decimals. Null when there is no such pixel.
 */
export function laplacianVariance(grid: LumaGrid, rect?: PixelRect): number | null {
  const { data, width: w, height: h } = grid;
  const x0 = Math.max(1, rect ? Math.floor(rect.left * grid.sx) : 1);
  const y0 = Math.max(1, rect ? Math.floor(rect.top * grid.sy) : 1);
  const x1 = Math.min(w - 1, rect ? Math.ceil((rect.left + rect.width) * grid.sx) : w - 1);
  const y1 = Math.min(h - 1, rect ? Math.ceil((rect.top + rect.height) * grid.sy) : h - 1);
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      const l = data[i - 1]! + data[i + 1]! + data[i - w]! + data[i + w]! - 4 * data[i]!;
      sum += l;
      squares += l * l;
      count++;
    }
  }
  if (count === 0) return null;
  return Math.round(Math.max(0, squares / count - (sum / count) ** 2) * 1000) / 1000;
}
