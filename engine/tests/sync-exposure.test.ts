// Adaptive exposure's search (src/sync/exposure.ts), on made-up responses of luma to exposure: these
// test the search, not how Lightroom renders.

import { describe, expect, it } from "vitest";
import { roundForSlider } from "../src/session/index.js";
import { LUMA_TOLERANCE, MAX_RENDERS, solveExposure } from "../src/sync/index.js";

const RANGE = { min: -5, max: 5 };

/** A measure that records the exposures it was asked for. */
function recording(response: (e: number) => number): { measure: (e: number) => Promise<number>; asked: number[] } {
  const asked: number[] = [];
  return { asked, measure: async (e) => (asked.push(e), response(e)) };
}

describe("sync: adaptive exposure search", () => {
  it("finds a linear response in at most three renders (the start included)", async () => {
    const linear = (e: number): number => 118 + 40 * e;
    for (const start of [-1, 0.5, 1]) {
      const { measure } = recording(linear);
      const out = await solveExposure({ exposure: start, luma: linear(start) }, 118, measure, RANGE);
      expect(out.met).toBe(true);
      expect(Math.abs(out.best.luma - 118)).toBeLessThanOrEqual(LUMA_TOLERANCE);
      expect(out.trail.length).toBeLessThanOrEqual(3);
    }
  });

  it("finds a gamma-encoded response with a clipped top within the render cap", async () => {
    const encoded = (e: number): number => 255 * Math.min(1, 0.18 * 2 ** e) ** (1 / 2.2);
    const goal = encoded(1.3);
    const out = await solveExposure({ exposure: -0.7, luma: encoded(-0.7) }, goal, recording(encoded).measure, RANGE);
    expect(out.met).toBe(true);
    expect(out.trail.length).toBeLessThanOrEqual(MAX_RENDERS);
  });

  it("renders nothing more when the start is already within tolerance", async () => {
    const { measure, asked } = recording(() => 0);
    const out = await solveExposure({ exposure: 0.2, luma: 119.5 }, 118, measure, RANGE);
    expect(out).toEqual({ best: { exposure: 0.2, luma: 119.5 }, trail: [{ exposure: 0.2, luma: 119.5 }], met: true });
    expect(asked).toEqual([]);
  });

  it("stops at the range's end, or when a flat response gives nothing new, and says the goal was not met", async () => {
    const weak = await solveExposure({ exposure: 4, luma: 140 }, 250, recording((e) => 100 + 10 * e).measure, RANGE);
    expect(weak.met).toBe(false);
    expect(weak.best.exposure).toBe(5);
    expect(weak.trail.map((p) => p.exposure)).toEqual([4, 5]);
    const flat = await solveExposure({ exposure: 0, luma: 255 }, 118, recording(() => 255).measure, RANGE);
    expect(flat.met).toBe(false);
    expect(flat.trail.length).toBeLessThanOrEqual(MAX_RENDERS);
    expect(flat.best).toEqual({ exposure: 0, luma: 255 });
  });

  it("keeps the best try when a later one moves away from the goal", async () => {
    // The model's first guess from (0, 100) to 118, then a secant that lands on a worse render.
    const first = roundForSlider("exposure", 2.2 * Math.log2(118 / 100));
    const table: Record<string, number> = { [first.toFixed(2)]: 121, "0.45": 125 };
    const { measure, asked } = recording((e) => table[e.toFixed(2)] ?? 100 + 40 * e);
    const out = await solveExposure({ exposure: 0, luma: 100 }, 118, measure, RANGE);
    expect(asked).toEqual([first, 0.45]);
    expect(out.best).toEqual({ exposure: first, luma: 121 });
    expect(out.trail[out.trail.length - 1]).toEqual({ exposure: 0.45, luma: 125 });
    expect(out.met).toBe(false);
  });

  it("writes exposures at the slider's 0.01 EV precision, inside the range", async () => {
    const { measure, asked } = recording((e) => 60 + 33.3 * e);
    await solveExposure({ exposure: -4.9, luma: 60 - 33.3 * 4.9 }, 200, measure, RANGE);
    for (const e of asked) {
      expect(e).toBe(roundForSlider("exposure", e));
      expect(e).toBeGreaterThanOrEqual(-5);
      expect(e).toBeLessThanOrEqual(5);
    }
  });
});
