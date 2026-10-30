// Perceptual measurements (src/metrics/perceptual.ts, bands.ts, wheel-fit.ts; Phase 10 row 7) on
// generated pixels with known values: greys and a grey ramp for L* and the zones, tinted cards for the
// casts, a hue wheel for the HSL bands.

import { describe, expect, it } from "vitest";
import { computeMetrics, deltaMetrics } from "../src/metrics/index.js";
import { HSL_BANDS } from "../src/metrics/bands.js";
import { labToRgb } from "../src/metrics/perceptual.js";
import { wheelFromMeasured } from "../src/metrics/wheel-fit.js";

/** A width x height RGB image, each pixel from `pixel(x, y)`. */
function image(width: number, height: number, pixel: (x: number, y: number) => readonly number[]) {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y).map((v) => Math.round(v)), (y * width + x) * 3);
  return computeMetrics(data, width, height, 3).perceptual;
}
const flat = (rgb: readonly number[]) => image(8, 8, () => rgb);

/** HSV (h in degrees, s and v 0-1) to 8-bit RGB. */
function hsv(h: number, s: number, v: number): number[] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return 255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1)));
  };
  return [f(5), f(3), f(1)];
}

describe("L* and the zones", () => {
  it("puts sRGB grey 128 at L* 53.6 (53.585 by the CIELAB formula), in zone V, with no spread", () => {
    const p = flat([128, 128, 128]);
    expect(p.L).toEqual({ p2: 53.6, p5: 53.6, p20: 53.6, p50: 53.6, p80: 53.6, p95: 53.6, p98: 53.6 });
    expect(p.zones).toEqual([0, 0, 0, 0, 0, 100, 0, 0, 0, 0, 0]);
    expect(p.rms).toBe(0);
    expect(p.cf).toBe(0);
  });

  it("puts black in zone 0 and white in zone X", () => {
    expect(flat([0, 0, 0]).zones[0]).toBe(100);
    expect(flat([0, 0, 0]).L.p50).toBe(0);
    expect(flat([255, 255, 255]).zones[10]).toBe(100);
    expect(flat([255, 255, 255]).L.p98).toBe(100);
  });

  it("measures a 256-level grey ramp: zone 0 holds levels 0-10 (L* < 3), the median is level 127, the shares add to 100", () => {
    const p = image(256, 1, (x) => [x, x, x]);
    // Level 10 is L* 2.74 and level 11 L* 3.01 [inference: L* = 903.3 * (v / 255 / 12.92) below level 11].
    expect(p.zones[0]).toBeCloseTo((11 / 256) * 100, 1);
    expect(p.L.p50).toBe(53.2); // level 127: L* 53.19
    expect(p.zones.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 0);
    expect(p.L.p2).toBeLessThan(p.L.p20);
    expect(p.L.p80).toBeLessThan(p.L.p98);
  });

  it("gives half black, half white an RMS contrast of 0.5 (std of L* 0 and 100, / 100)", () => {
    expect(image(2, 1, (x) => (x === 0 ? [0, 0, 0] : [255, 255, 255])).rms).toBe(0.5);
  });
});

describe("casts", () => {
  it("reads a tinted midtone card back as its a* and b*, with the Lab hue", () => {
    const p = flat(labToRgb(50, 0, 20));
    const mid = p.cast.mid;
    expect(mid?.a).toBeCloseTo(0, 0);
    expect(mid?.b).toBeCloseTo(20, 0);
    expect(mid?.C).toBeCloseTo(20, 0);
    expect(mid?.h).toBeGreaterThanOrEqual(88);
    expect(mid?.h).toBeLessThanOrEqual(92);
    expect(p.cast.sh).toBeNull(); // no pixel in L* 5-35
    expect(p.cast.hi).toBeNull();
  });

  it("puts shadow and highlight cards in their ranges", () => {
    const sh = flat(labToRgb(20, 15, 0)).cast.sh;
    expect(sh?.a).toBeCloseTo(15, 0);
    const hi = flat(labToRgb(80, -10, -10)).cast.hi;
    expect(hi?.b).toBeCloseTo(-10, 0);
    expect(hi?.h).toBeGreaterThan(220);
    expect(hi?.h).toBeLessThan(230);
  });

  it("gives a grey no cast hue and no wheel hue (chroma under 1)", () => {
    expect(flat([128, 128, 128]).cast.mid).toEqual({ a: 0, b: 0, C: 0, h: null, wheel: null });
  });

  it("maps a tint to the grading wheel through S14's 12 pairs, interpolating between them", () => {
    expect(wheelFromMeasured("shadows", 352)).toBe(0);
    expect(wheelFromMeasured("shadows", 139)).toBe(120);
    expect(wheelFromMeasured("shadows", 20)).toBe(30);
    expect(wheelFromMeasured("shadows", 35.5)).toBe(45); // half way from 20 (30) to 51 (60)
    expect(wheelFromMeasured("shadows", 340)).toBe(343); // between 331 (330) and 352 (360)
    expect(wheelFromMeasured("midtones", 177)).toBe(180);
  });

  it("gives a red-tinted shadow card a wheel hue near 0 and a blue one near 230", () => {
    const red = flat(labToRgb(25, 20, 8)).cast.sh?.wheel ?? -1;
    expect(Math.min(red, 360 - red)).toBeLessThan(25);
    const blue = flat(labToRgb(25, 5, -25)).cast.sh?.wheel ?? -1;
    expect(blue).toBeGreaterThan(220);
    expect(blue).toBeLessThan(270);
  });
});

describe("HSL bands and colourfulness", () => {
  it("splits a full hue wheel among the 8 bands by the S14 centres and widths", () => {
    const p = image(360, 4, (x) => hsv(x + 0.5, 1, 1));
    const total = Object.values(p.bands).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 0);
    // Green runs from 67.6 (yellow-green edge: 53 + 57 * 31 / 121) to 151.8 (110 + 58 * 90 / 125) degrees.
    expect(p.bands.green).toBeCloseTo(((151.76 - 67.6) / 360) * 100, 0);
    expect(p.bands.magenta).toBeGreaterThan(0);
    expect(Object.keys(p.bands)).toEqual(HSL_BANDS.map((b) => b.band));
  });

  it("puts each band's centre hue in that band", () => {
    for (const { band, centre } of HSL_BANDS) {
      const p = flat(hsv(centre, 0.8, 0.9));
      expect(p.bands[band], band).toBe(100);
    }
  });

  it("gives no band shares to a grey (no chromatic pixel)", () => {
    expect(Object.values(flat([90, 90, 90]).bands)).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("measures half red, half green as Hasler and Suesstrunk's M: sigma_rg 255, mu_yb 127.5, so 255 + 0.3 * 127.5", () => {
    expect(image(2, 1, (x) => (x === 0 ? [255, 0, 0] : [0, 255, 0])).cf).toBe(293.3);
  });
});

describe("deltas", () => {
  it("adds a perceptual delta, hues as the shortest turn", () => {
    const before = computeMetrics(new Uint8Array(labToRgb(50, 20, -3.5).map(Math.round)), 1, 1, 3);
    const after = computeMetrics(new Uint8Array(labToRgb(55, 20, 3.5).map(Math.round)), 1, 1, 3);
    const d = deltaMetrics(before, after).perceptual;
    expect(d.L.p50).toBeCloseTo(5, 0);
    const turn = d.cast.mid?.h ?? 0;
    expect(turn).toBeGreaterThan(0); // 350 -> 10 degrees is +20, not -340
    expect(turn).toBeLessThan(30);
  });
});
