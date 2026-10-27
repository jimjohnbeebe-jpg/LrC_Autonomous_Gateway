import { describe, expect, it } from "vitest";
import { percentile, sample, summarize } from "../src/devtools/perf-check.js";

describe("perf-check statistics", () => {
  it("takes nearest-rank percentiles", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(xs, 0.5)).toBe(10);
    expect(percentile(xs, 0.95)).toBe(19);
    expect(percentile([], 0.5)).toBeNull();
  });

  it("counts failed runs and leaves them out of the numbers", () => {
    const t = summarize("x", "", [30, null, 10, 20]);
    expect(t).toMatchObject({ runs: 4, failed: 1, p50: 20, min: 10, max: 30 });
  });

  it("times a function and records a throw as failed", async () => {
    let n = 0;
    let clock = 0;
    const out = await sample(3, 1, () => (++n === 3 ? Promise.reject(new Error("x")) : Promise.resolve()), () => (clock += 5));
    expect(out).toEqual([5, null, 5]);
  });
});
