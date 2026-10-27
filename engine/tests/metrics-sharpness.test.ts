// Sharpness (src/metrics/sharpness.ts, issue #216): the Laplacian variance at a 512 px long edge, on
// synthetic images sharp builds, against blurred copies; a fixed fixture's value; regions and deltas.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { computeMetrics, deltaMetrics, measureImage } from "../src/metrics/index.js";
import { laplacianVariance, resampleLuma } from "../src/metrics/sharpness.js";

/** A grey checkerboard of `cell` px squares, w x h, RGB. */
function checker(w: number, h: number, cell: number): Uint8Array {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.fill((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 200 : 50, (y * w + x) * 3, (y * w + x) * 3 + 3);
  return data;
}

/** A horizontal ramp with a hard step in the middle, w x h, RGB. */
function rampStep(w: number, h: number): Uint8Array {
  const data = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.fill(Math.round((x / w) * 100) + (x >= w / 2 ? 120 : 0), (y * w + x) * 3, (y * w + x) * 3 + 3);
  return data;
}

const raw = (data: Uint8Array, w: number, h: number) => sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 3 } });
const png = (data: Uint8Array, w: number, h: number): Promise<Buffer> => raw(data, w, h).png().toBuffer();
const blurredPng = (data: Uint8Array, w: number, h: number, sigma: number): Promise<Buffer> => raw(data, w, h).blur(sigma).png().toBuffer();

describe("sharpness", () => {
  it("is lower on a blurred copy, for a checkerboard and for a ramp with a step", async () => {
    for (const [data, w, h] of [[checker(1024, 683, 8), 1024, 683], [rampStep(1600, 1067), 1600, 1067]] as const) {
      const sharpM = await measureImage(await png(data, w, h));
      const soft = await measureImage(await blurredPng(data, w, h, 3));
      expect(sharpM.sharpness).toBeGreaterThan(0);
      expect(soft.sharpness).toBeLessThan(sharpM.sharpness as number);
    }
  });

  it("is 0 on a flat image", () => {
    expect(computeMetrics(new Uint8Array(600 * 400 * 3).fill(90), 600, 400, 3).sharpness).toBe(0);
  });

  it("gives a fixed value on a fixed image (the definition does not drift)", () => {
    // A 1024 x 512 checkerboard of 16 px cells resamples to 512 x 256 with 8 px cells, values exactly 50 or 200.
    // Per cell, 24 pixels have one neighbour across an edge (L = +-150) and 4 have two (+-300): on an unbounded
    // board mean(L^2) = (24 * 150^2 + 4 * 300^2) / 64 = 14062.5 and mean(L) = 0. Leaving out the outer grid
    // pixels (no four neighbours), most of them on cell edges, lowers it to the value below. A change here is a
    // change of the metric, which every stored session record compares with.
    const m = computeMetrics(checker(1024, 512, 16), 1024, 512, 3);
    expect(m.sharpness).toBe(13764.706);
  });

  it("resamples to a 512 px long edge whatever the size, so two sizes of one image measure alike", async () => {
    const data = checker(2048, 1366, 32);
    expect(resampleLuma(data, 2048, 1366, 3)).toMatchObject({ width: 512, height: 342 });
    const big = computeMetrics(data, 2048, 1366, 3).sharpness as number;
    const small = await raw(data, 2048, 1366).resize(1024, null, { kernel: "nearest" }).raw().toBuffer({ resolveWithObject: true });
    const half = computeMetrics(small.data, small.info.width, small.info.height, 3).sharpness as number;
    expect(Math.abs(half - big) / big).toBeLessThan(0.05);
  });

  it("measures regions on the same grid; a box too small for a neighbour is null", () => {
    // Left half flat, right half a checkerboard.
    const w = 1024;
    const h = 512;
    const data = checker(w, h, 16);
    for (let y = 0; y < h; y++) data.fill(120, y * w * 3, (y * w + w / 2) * 3);
    const m = computeMetrics(data, w, h, 3, [
      { label: "flat", box: { x: 0.05, y: 0.1, w: 0.4, h: 0.8 } },
      { label: "busy", box: { x: 0.55, y: 0.1, w: 0.4, h: 0.8 } },
      { label: "speck", box: { x: 0, y: 0, w: 0.0001, h: 0.0001 } },
    ]);
    const [flat, busy, speck] = m.regions;
    expect(flat?.sharpness).toBe(0);
    expect(busy?.sharpness).toBeGreaterThan(m.sharpness as number);
    expect(speck?.sharpness).toBeNull();
    expect(laplacianVariance(resampleLuma(data, w, h, 3), { left: 0, top: 0, width: 1, height: 1 })).toBeNull();
  });

  it("has a delta, after - before, and null when a side is null", () => {
    const before = computeMetrics(checker(512, 512, 4), 512, 512, 3, [{ label: "speck", box: { x: 0, y: 0, w: 0.0001, h: 0.0001 } }]);
    const after = { ...before, sharpness: (before.sharpness as number) - 100 };
    const d = deltaMetrics(before, after);
    expect(d.sharpness).toBe(-100);
    expect(d.regions[0]?.sharpness).toBeNull();
  });
});
