// Basic metrics (src/metrics/basic.ts): exact values on hand-made pixel buffers.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { computeBasicMetrics, deltaMetrics, measureImage, summarize } from "../src/metrics/index.js";

/** An RGB buffer from a list of pixels. */
const rgb = (...pixels: Array<[number, number, number]>): Uint8Array => Uint8Array.from(pixels.flat());

describe("metrics: basic", () => {
  it("counts a white image as fully clipped high, with luma 255", () => {
    const m = computeBasicMetrics(rgb([255, 255, 255], [255, 255, 255]), 2, 1, 3);
    expect(m.pixels).toBe(2);
    expect(m.luma.mean).toBe(255);
    expect(m.luma.histogram[255]).toBe(2);
    expect(m.luma.histogram.reduce((a, b) => a + b, 0)).toBe(2);
    expect(m.clip_high_pct).toBe(100);
    expect(m.clip_low_pct).toBe(0);
  });

  it("counts high clipping when any channel reaches 253, and low clipping only when all channels are <= 2", () => {
    const m = computeBasicMetrics(rgb([253, 0, 0], [2, 2, 2], [2, 2, 3], [252, 128, 128]), 2, 2, 3);
    expect(m.clip_high_pct).toBe(25);
    expect(m.clip_high_pct_by_channel).toEqual({ r: 25, g: 0, b: 0 });
    expect(m.clip_low_pct).toBe(25); // [2, 2, 3] has one channel above 2
    expect(m.clip_low_pct_by_channel).toEqual({ r: 50, g: 75, b: 50 });
  });

  it("weighs luma with Rec. 709 coefficients", () => {
    const m = computeBasicMetrics(rgb([255, 0, 0], [0, 255, 0], [0, 0, 255]), 3, 1, 3);
    // 0.2126 * 255 = 54.2, 0.7152 * 255 = 182.4, 0.0722 * 255 = 18.4
    expect(m.luma.histogram[54]).toBe(1);
    expect(m.luma.histogram[182]).toBe(1);
    expect(m.luma.histogram[18]).toBe(1);
    expect(m.luma.mean).toBe(85);
  });

  it("ignores alpha in RGBA buffers", () => {
    const m = computeBasicMetrics(Uint8Array.from([10, 10, 10, 0, 10, 10, 10, 255]), 2, 1, 4);
    expect(m.luma.mean).toBe(10);
    expect(m.luma.histogram[10]).toBe(2);
  });

  it("refuses a buffer that does not match its size", () => {
    expect(() => computeBasicMetrics(rgb([1, 2, 3]), 2, 1, 3)).toThrow(/needs 6/);
    expect(() => computeBasicMetrics(rgb([1, 2, 3]), 1, 1, 2)).toThrow(/3 or 4 channels/);
  });

  it("gives deltas as after minus before", () => {
    const before = computeBasicMetrics(rgb([100, 100, 100], [0, 0, 0]), 2, 1, 3);
    const after = computeBasicMetrics(rgb([120, 120, 120], [255, 255, 255]), 2, 1, 3);
    const d = deltaMetrics(before, after);
    expect(d.luma_mean).toBe(137.5);
    expect(d.clip_high_pct).toBe(50);
    expect(d.clip_low_pct).toBe(-50);
    expect(summarize(after)).not.toHaveProperty("luma");
  });

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
});
