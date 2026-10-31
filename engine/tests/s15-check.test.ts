import { describe, expect, it } from "vitest";
import type { Perceptual } from "../src/metrics/index.js";
import { edit, featureNames, features, nearest, predictionTest, standardise, stepMedians, verdict, type Edit } from "../src/devtools/s15-check.js";

const bands = { red: 0.1, orange: 0.2, yellow: 0.1, green: 0.3, aqua: 0, blue: 0.2, purple: 0.05, magenta: 0.05 };
function perceptual(p50: number, cf = 20, cast: Perceptual["cast"]["sh"] = { a: 1, b: 2, C: 2.2, h: 63, wheel: 50 }): Perceptual {
  return { L: { p2: p50 - 40, p5: p50 - 30, p20: p50 - 15, p50, p80: p50 + 15, p95: p50 + 30, p98: p50 + 40 }, zones: [], cast: { sh: cast, mid: null, hi: cast }, bands, cf, rms: 0.2 };
}

describe("s15 features", () => {
  it("names every feature, in vector order, and counts a tone range with no pixels as neutral", () => {
    const p = perceptual(50);
    const v = features(p);
    expect(featureNames(p)).toHaveLength(v.length);
    expect(v).toHaveLength(7 + 6 + 8 + 2);
    expect(featureNames(p).slice(9, 11)).toEqual(["cast.mid.a", "cast.mid.b"]);
    expect(v.slice(9, 11)).toEqual([0, 0]);
  });
});

describe("s15 standardise and nearest", () => {
  it("gives z-scores per column and 0 for a column with no spread", () => {
    const z = standardise([[1, 5], [3, 5]]);
    expect(z).toEqual([[-1, 0], [1, 0]]);
  });

  it("leaves each photo out of its own list, nearest first, ties to the lower index", () => {
    const z = [[0], [1], [3], [10], [1]];
    const n = nearest(z, 3);
    expect(n[0]?.map((x) => x.index)).toEqual([1, 4, 2]);
    expect(n[1]?.map((x) => x.index)).toEqual([4, 0, 2]);
    expect(n[1]?.[0]?.distance).toBe(0);
    expect(n[3]?.map((x) => x.index)).toEqual([2, 1, 4]);
    expect(n.every((row, i) => row.every((x) => x.index !== i))).toBe(true);
  });
});

describe("s15 edit test", () => {
  it("measures the edit as final minus as-shot", () => {
    expect(edit(perceptual(60, 30), perceptual(50, 20))).toEqual({ "L.p50": 10, "L.p5": 10, "L.p95": 10, cf: 10 });
  });

  it("finds kNN better when neighbours share the edit, and not better when they do not", () => {
    // Two clusters: photos 0-3 brightened by 10, photos 4-7 darkened by 10; neighbours are within a cluster.
    const z = [0, 0.1, 0.2, 0.3, 10, 10.1, 10.2, 10.3].map((x) => [x]);
    const e = (d: number): Edit => ({ "L.p50": d, "L.p5": d, "L.p95": d, cf: 0 });
    const edits = [10, 10, 10, 10, -10, -10, -10, -10].map(e);
    const t = predictionTest(edits, nearest(z, 3));
    const p50 = t.find((x) => x.key === "L.p50");
    expect(p50).toMatchObject({ mae_knn: 0, knn_better: true });
    expect(p50?.mae_mean).toBeCloseTo(80 / 7, 3);
    // cf is 0 everywhere: both predictions are exact, so kNN is not better.
    expect(t.find((x) => x.key === "cf")).toMatchObject({ mae_knn: 0, mae_mean: 0, knn_better: false });
    // Shuffled edits: the neighbours carry no information.
    const crossed = [10, -10, 10, -10, 10, -10, 10, -10].map(e);
    expect(predictionTest(crossed, nearest(z, 3)).find((x) => x.key === "L.p50")?.knn_better).toBe(false);
  });
});

describe("s15 timings and verdict", () => {
  it("takes the median of each step and of the as-shot total over complete photos only", () => {
    const m = stepMedians([
      { final: 2000, create: 300, reset: 400, render: 2100, remove: 500 },
      { final: 3000, create: 100, reset: 200, render: 2500, remove: 700 },
      { final: 2500, create: 200 },
    ]);
    expect(m).toEqual({ final: 2500, create: 200, reset: 200, render: 2100, remove: 500, as_shot_total: 3300 });
  });

  it("WORKED needs every photo measured, every answer y or n, every copy gone, the masters and selection as they were", () => {
    const base = { photos: 5, measured: 5, copiesLeft: 0, mastersChanged: [], selectionBack: true, answers: ["y", "n", "y", "y", "n"] };
    expect(verdict(base)).toMatchObject({ worked: true, putBack: true });
    expect(verdict(base).lines.join("\n")).toContain("3 of 5 sensible");
    expect(verdict({ ...base, answers: ["y", "y", "y", "y", "no answer"] }).worked).toBe(false);
    expect(verdict({ ...base, copiesLeft: 1 })).toMatchObject({ worked: false, putBack: false });
    expect(verdict({ ...base, mastersChanged: ["a.NEF"] })).toMatchObject({ worked: false, putBack: false });
    expect(verdict({ ...base, measured: 4, answers: ["y", "y", "y", "y"] })).toMatchObject({ worked: false, putBack: true });
    expect(verdict({ ...base, photos: 0, measured: 0, answers: [] })).toMatchObject({ worked: false, putBack: true });
  });
});
