// Metrics (src/metrics/compute.ts, regions.ts): exact values on hand-made pixel buffers.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { boxProblem, boxToRect, computeMetrics, deltaMetrics, measureImage, summarize, type Metrics } from "../src/metrics/index.js";

type Px = [number, number, number];
/** An RGB buffer from a list of pixels. */
const rgb = (...pixels: Px[]): Uint8Array => Uint8Array.from(pixels.flat());
const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);
/** Metrics of a one-row image made of `pixels`. */
const row = (...pixels: Px[]): Metrics => computeMetrics(rgb(...pixels), pixels.length, 1, 3);

describe("metrics: luma, histograms and clipping", () => {
  it("measures a white image as fully clipped high, with luma 255 and no colour", () => {
    const m = row([255, 255, 255], [255, 255, 255]);
    expect(m.pixels).toBe(2);
    expect(m.luma_mean).toBe(255);
    expect(m.luma_std).toBe(0);
    expect(m.histograms.luma[255]).toBe(2);
    expect(sum(m.histograms.luma)).toBe(2);
    expect(m.histograms.r[255]).toBe(2);
    expect(m.luma_percentiles).toEqual({ p1: 255, p5: 255, p50: 255, p95: 255, p99: 255 });
    expect(m.dynamic_range).toBe(0);
    expect(m.clip_high_pct).toBe(100);
    expect(m.clip_low_pct).toBe(0);
    expect(m.rb_ratio).toBe(1);
    expect(m.saturation_mean).toBe(0);
    expect(m.chromatic_pct).toBe(0);
    expect(m.hue_mean).toBeNull();
    expect(m.hue_histogram).toEqual(new Array(12).fill(0));
    expect(m.regions).toEqual([]);
  });

  it("counts high clipping when any channel reaches 253, and low clipping only when all channels are <= 2", () => {
    const m = computeMetrics(rgb([253, 0, 0], [2, 2, 2], [2, 2, 3], [252, 128, 128]), 2, 2, 3);
    expect(m.clip_high_pct).toBe(25);
    expect(m.clip_high_pct_by_channel).toEqual({ r: 25, g: 0, b: 0 });
    expect(m.clip_low_pct).toBe(25); // [2, 2, 3] has one channel above 2
    expect(m.clip_low_pct_by_channel).toEqual({ r: 50, g: 75, b: 50 });
  });

  it("weighs luma with Rec. 709 coefficients", () => {
    const m = row([255, 0, 0], [0, 255, 0], [0, 0, 255]);
    // 0.2126 * 255 = 54.2, 0.7152 * 255 = 182.4, 0.0722 * 255 = 18.4
    expect(m.histograms.luma[54]).toBe(1);
    expect(m.histograms.luma[182]).toBe(1);
    expect(m.histograms.luma[18]).toBe(1);
    expect(m.luma_mean).toBe(85);
  });

  it("gives nearest-rank percentiles, the standard deviation and the dynamic range", () => {
    // 100 grey pixels with luma 0, 1, ..., 99.
    const m = row(...Array.from({ length: 100 }, (_, v): Px => [v, v, v]));
    expect(m.luma_percentiles).toEqual({ p1: 0, p5: 4, p50: 49, p95: 94, p99: 98 });
    expect(m.luma_mean).toBe(49.5);
    expect(m.luma_std).toBe(28.866); // sqrt((100^2 - 1) / 12)
    expect(m.dynamic_range).toBe(0.3843); // (98 - 0) / 255
  });

  it("gives per-channel means and the red/blue ratio, null when blue is 0", () => {
    const m = row([200, 100, 50], [100, 100, 100]);
    expect(m.channel_mean).toEqual({ r: 150, g: 100, b: 75 });
    expect(m.rb_ratio).toBe(2);
    expect(row([10, 10, 0]).rb_ratio).toBeNull();
  });

  it("ignores alpha in RGBA buffers", () => {
    const m = computeMetrics(Uint8Array.from([10, 10, 10, 0, 10, 10, 10, 255]), 2, 1, 4);
    expect(m.luma_mean).toBe(10);
    expect(m.histograms.luma[10]).toBe(2);
  });

  it("refuses a buffer that does not match its size", () => {
    expect(() => computeMetrics(rgb([1, 2, 3]), 2, 1, 3)).toThrow(/needs 6/);
    expect(() => computeMetrics(rgb([1, 2, 3]), 1, 1, 2)).toThrow(/3 or 4 channels/);
  });
});

describe("metrics: saturation and hue", () => {
  it("measures HSV saturation over every pixel and bins the hue of the chromatic ones", () => {
    const m = row([255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128]);
    expect(m.saturation_mean).toBe(75);
    expect(m.chromatic_pct).toBe(75);
    const bins = new Array(12).fill(0);
    bins[0] = 33.3333; // red, 0 degrees
    bins[4] = 33.3333; // green, 120
    bins[8] = 33.3333; // blue, 240
    expect(m.hue_histogram).toEqual(bins);
    expect(m.hue_mean).toBeNull(); // three hues 120 degrees apart have no mean direction
  });

  it("leaves out dark and nearly grey pixels from the hue, but not from the saturation mean", () => {
    // [20, 0, 0]: saturation 1 but value 0.08; [255, 240, 240]: saturation 0.06.
    const m = row([20, 0, 0], [255, 240, 240]);
    expect(m.chromatic_pct).toBe(0);
    expect(m.hue_mean).toBeNull();
    expect(m.saturation_mean).toBe(52.941); // (1 + 15 / 255) / 2
  });

  it("takes the circular mean, so hues either side of red average to red, not cyan", () => {
    // Hue 10.1 degrees (g = 43) and 349.9 degrees (b = 43): 1-degree bins 10 and 349.
    const m = row([255, 43, 0], [255, 0, 43]);
    expect(m.hue_mean).toBe(0);
    expect(m.hue_histogram[0]).toBe(100);
  });
});

describe("metrics: regions", () => {
  // 4 x 2: the left half black, the right half white.
  const halves = rgb([0, 0, 0], [0, 0, 0], [255, 255, 255], [255, 255, 255], [0, 0, 0], [0, 0, 0], [255, 255, 255], [255, 255, 255]);

  it("measures each region inside its box, with the same set as the whole image", () => {
    const m = computeMetrics(halves, 4, 2, 3, [{ label: "right", box: { x: 0.5, y: 0, w: 0.5, h: 1 } }]);
    expect(m.clip_high_pct).toBe(50);
    expect(m.clip_low_pct).toBe(50);
    expect(m.regions).toHaveLength(1);
    const right = m.regions[0]!;
    expect(right).toMatchObject({ label: "right", rect: { left: 2, top: 0, width: 2, height: 2 }, pixels: 4, luma_mean: 255, clip_high_pct: 100, clip_low_pct: 0 });
    expect(right).not.toHaveProperty("histograms");
  });

  it("turns a normalised box into the pixels it touches, at least one", () => {
    expect(boxToRect({ x: 0, y: 0, w: 1, h: 1 }, 1600, 1067)).toEqual({ left: 0, top: 0, width: 1600, height: 1067 });
    expect(boxToRect({ x: 0.7, y: 0.5, w: 0.3, h: 0.5 }, 10, 10)).toEqual({ left: 7, top: 5, width: 3, height: 5 });
    expect(boxToRect({ x: 0.25, y: 0.25, w: 0.0001, h: 0.0001 }, 8, 8)).toEqual({ left: 2, top: 2, width: 1, height: 1 });
    expect(boxToRect({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, 15, 15)).toEqual({ left: 1, top: 1, width: 4, height: 4 }); // 1.5 to 4.5
  });

  it("refuses boxes outside the image or without area", () => {
    expect(boxProblem({ x: 0.2, y: 0.2, w: 0.5, h: 0.5 })).toBeNull();
    expect(boxProblem({ x: -0.1, y: 0, w: 0.5, h: 0.5 })).toMatch(/x and y/);
    expect(boxProblem({ x: 1, y: 0, w: 0.1, h: 0.5 })).toMatch(/x and y/);
    expect(boxProblem({ x: 0, y: 0, w: 0, h: 0.5 })).toMatch(/greater than 0/);
    expect(boxProblem({ x: 0.6, y: 0, w: 0.5, h: 0.5 })).toMatch(/end inside/);
    expect(boxProblem({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 })).toMatch(/finite/);
    expect(() => computeMetrics(halves, 4, 2, 3, [{ label: "bad", box: { x: 0.9, y: 0, w: 0.5, h: 1 } }])).toThrow(RangeError);
  });
});

describe("metrics: deltas and summaries", () => {
  it("gives deltas as after minus before, for every scalar", () => {
    const before = row([100, 100, 100], [0, 0, 0]);
    const after = row([120, 120, 120], [255, 255, 255]);
    const d = deltaMetrics(before, after);
    expect(d.luma_mean).toBe(137.5);
    expect(d.clip_high_pct).toBe(50);
    expect(d.clip_low_pct).toBe(-50);
    expect(d.luma_percentiles).toEqual({ p1: 120, p5: 120, p50: 120, p95: 155, p99: 155 });
    expect(d.channel_mean).toEqual({ r: 137.5, g: 137.5, b: 137.5 });
    expect(d.rb_ratio).toBe(0);
    expect(d.hue_mean).toBeNull();
    expect(d).not.toHaveProperty("hue_histogram");
  });

  it("gives the hue change as the shortest turn, across 0 degrees", () => {
    const before = row([255, 0, 43]); // 349.5 degrees (bin centre)
    const after = row([255, 43, 0]); // 10.5 degrees
    expect(deltaMetrics(before, after).hue_mean).toBe(21);
    expect(deltaMetrics(after, before).hue_mean).toBe(-21);
  });

  it("matches regions by label and leaves out a region measured on one side only", () => {
    const px = rgb([0, 0, 0], [255, 255, 255]);
    const box = { x: 0.5, y: 0, w: 0.5, h: 1 };
    const before = computeMetrics(px, 2, 1, 3, [{ label: "sky", box }]);
    const after = computeMetrics(px, 2, 1, 3, [{ label: "sky", box }, { label: "face", box }]);
    const d = deltaMetrics(before, after);
    expect(d.regions.map((r) => r.label)).toEqual(["sky"]);
    expect(d.regions[0]?.luma_mean).toBe(0);
  });

  it("summarises without histograms or size, and deltas work on summaries too", () => {
    const m = row([10, 20, 30]);
    const s = summarize(m);
    expect(s).not.toHaveProperty("histograms");
    expect(s).not.toHaveProperty("pixels");
    expect(s.luma_mean).toBe(m.luma_mean);
    expect(deltaMetrics(s, summarize(row([20, 30, 40]))).luma_mean).toBe(10);
  });
});

describe("metrics: decoding", () => {
  it("decodes an image with sharp and measures it, also when it carries an sRGB ICC profile", async () => {
    const make = (icc: boolean) => {
      const img = sharp({ create: { width: 30, height: 20, channels: 3, background: { r: 0, g: 0, b: 0 } } }).png();
      return (icc ? img.withIccProfile("srgb") : img).toBuffer();
    };
    const plain = await measureImage(await make(false));
    const tagged = await measureImage(await make(true));
    expect(plain).toMatchObject({ width: 30, height: 20, pixels: 600, clip_low_pct: 100 });
    expect(tagged).toEqual(plain);
  });

  it("measures regions of a decoded image", async () => {
    const png = await sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 0, g: 0, b: 255 } } }).png().toBuffer();
    const m = await measureImage(png, [{ label: "all", box: { x: 0, y: 0, w: 1, h: 1 } }]);
    expect(m.regions[0]).toMatchObject({ label: "all", pixels: 800, hue_mean: 240.5, chromatic_pct: 100 });
  });

  it("measures a 1600 x 1067 image in well under the pass budget", () => {
    const width = 1600;
    const height = 1067;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) % 251; // varied colours
    const started = performance.now();
    computeMetrics(data, width, height, 3, [{ label: "sky", box: { x: 0, y: 0, w: 1, h: 0.4 } }]);
    const elapsed = performance.now() - started;
    // Phase 2's basic metrics took ~40 ms in the pass [handle: docs\reports\phase2\PHASE2.md "Numbers"];
    // this bound only catches a gross slowdown against the ~3.5 s pass budget.
    expect(elapsed).toBeLessThan(1500);
  });
});
