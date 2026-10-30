// The pure parts of `npm run s15:check` (Phase 10 row 11, spike S15 "style memory"): the as-shot feature vector of
// a photo, z-scores over the set, each photo's nearest neighbours left out of its own list, and the test of whether
// the neighbours' edit predicts a photo's edit better than the mean of all the others. Also the step-time medians and
// the verdict lines. The command line is s15-check-cli.ts. Report: docs\reports\phase10\S15.md.

import type { Perceptual } from "../metrics/index.js";
import { percentile } from "./perf-check.js";

export const MIN_PHOTOS = 4;
export const MAX_PHOTOS = 20;
export const K = 3;
/** The timed Lightroom steps per photo; `final` is the render of Jim's edit, the rest make the as-shot one. */
export const STEPS = ["final", "create", "reset", "render", "remove"] as const;
export type StepName = (typeof STEPS)[number];

const TONES = ["sh", "mid", "hi"] as const;
const L_KEYS = ["p2", "p5", "p20", "p50", "p80", "p95", "p98"] as const;

/** The feature names, in vector order. */
export function featureNames(p: Perceptual): string[] {
  return [...L_KEYS.map((k) => `L.${k}`), ...TONES.flatMap((t) => [`cast.${t}.a`, `cast.${t}.b`]), ...Object.keys(p.bands).map((b) => `bands.${b}`), "cf", "rms"];
}

/**
 * The as-shot features: L* percentiles, each tone range's cast as a* and b*, the 8 band shares, colourfulness and rms
 * contrast. A tone range with no pixels counts as neutral (a* = b* = 0). Seven L* percentiles weigh tone more than
 * colour [inference]; ponytail: unweighted, add per-group weights if the neighbours look tone-only.
 */
export function features(p: Perceptual): number[] {
  return [...L_KEYS.map((k) => p.L[k]), ...TONES.flatMap((t) => [p.cast[t]?.a ?? 0, p.cast[t]?.b ?? 0]), ...Object.values(p.bands), p.cf, p.rms];
}

/** Each column as z-scores over the rows (population std); a column with no spread becomes 0 everywhere. */
export function standardise(rows: readonly number[][]): number[][] {
  const n = rows.length;
  const dims = rows[0]?.length ?? 0;
  const mean = Array.from({ length: dims }, (_, j) => rows.reduce((s, r) => s + (r[j] ?? 0), 0) / n);
  const std = mean.map((m, j) => Math.sqrt(rows.reduce((s, r) => s + ((r[j] ?? 0) - m) ** 2, 0) / n));
  return rows.map((r) => r.map((v, j) => ((std[j] ?? 0) > 1e-12 ? (v - (mean[j] ?? 0)) / (std[j] as number) : 0)));
}

const distance = (a: readonly number[], b: readonly number[]): number => Math.sqrt(a.reduce((s, v, j) => s + (v - (b[j] ?? 0)) ** 2, 0));
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export type Neighbour = { index: number; distance: number };

/** Each row's `k` nearest other rows (Euclidean on the z-scores), nearest first; ties keep the lower index. */
export function nearest(z: readonly number[][], k = K): Neighbour[][] {
  return z.map((row, i) =>
    z
      .map((other, index) => ({ index, distance: distance(row, other) }))
      .filter((n) => n.index !== i)
      .sort((a, b) => a.distance - b.distance || a.index - b.index)
      .slice(0, k)
      .map((n) => ({ index: n.index, distance: r3(n.distance) })),
  );
}

/** The edit measured: final minus as-shot on these. */
export const EDIT_KEYS = ["L.p50", "L.p5", "L.p95", "cf"] as const;
export type EditKey = (typeof EDIT_KEYS)[number];
export type Edit = Record<EditKey, number>;

export function edit(final: Perceptual, asShot: Perceptual): Edit {
  return { "L.p50": r3(final.L.p50 - asShot.L.p50), "L.p5": r3(final.L.p5 - asShot.L.p5), "L.p95": r3(final.L.p95 - asShot.L.p95), cf: r3(final.cf - asShot.cf) };
}

const mean = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

export type Prediction = { key: EditKey; mae_knn: number; mae_mean: number; knn_better: boolean };

/**
 * Per edit key: the mean absolute error over the photos of two predictions of each photo's edit, the mean of its
 * neighbours' edits (kNN) and the mean of every other photo's edit. kNN is better where its error is lower.
 */
export function predictionTest(edits: readonly Edit[], neighbours: readonly Neighbour[][]): Prediction[] {
  return EDIT_KEYS.map((key) => {
    const errs = edits.map((e, i) => {
      const knn = mean((neighbours[i] ?? []).map((n) => (edits[n.index] as Edit)[key]));
      const others = mean(edits.filter((_, j) => j !== i).map((o) => o[key]));
      return { knn: Math.abs(knn - e[key]), mean: Math.abs(others - e[key]) };
    });
    const [knn, all] = [r3(mean(errs.map((x) => x.knn))), r3(mean(errs.map((x) => x.mean)))];
    return { key, mae_knn: knn, mae_mean: all, knn_better: knn < all };
  });
}

/** One photo's step times in ms; a step not reached is absent. */
export type StepTimes = Partial<Record<StepName, number>>;
export type StepMedians = Record<StepName, number | null> & { as_shot_total: number | null };

/** The median (nearest rank) of each step over the photos, and of the as-shot total (create + reset + render + remove). */
export function stepMedians(times: readonly StepTimes[]): StepMedians {
  const med = (xs: number[]): number | null => {
    const m = percentile([...xs].sort((a, b) => a - b), 0.5);
    return m === null ? null : Math.round(m);
  };
  const of = (s: StepName): number[] => times.flatMap((t) => (t[s] === undefined ? [] : [t[s] as number]));
  const totals = times.flatMap((t) => (STEPS.slice(1).every((s) => t[s] !== undefined) ? [STEPS.slice(1).reduce((sum, s) => sum + (t[s] as number), 0)] : []));
  return { ...(Object.fromEntries(STEPS.map((s) => [s, med(of(s))])) as Record<StepName, number | null>), as_shot_total: med(totals) };
}

export type Verdict = { worked: boolean; putBack: boolean; lines: string[] };

/**
 * WORKED when every photo was measured both ways, the analysis ran and every question got y or n; put back when every
 * copy is gone and every master's settings read back as they started. Jim's n is a result, not a failure.
 */
export function verdict(r: { photos: number; measured: number; copiesLeft: number; mastersChanged: string[]; selectionBack: boolean; answers: readonly string[] }): Verdict {
  const yes = r.answers.filter((a) => a === "y").length;
  const answered = r.answers.length === r.measured && r.answers.every((a) => a === "y" || a === "n");
  const lines = [
    `${r.measured === r.photos ? "YES" : "NO "} measured final and as-shot: ${r.measured} of ${r.photos} photos`,
    `${r.measured >= MIN_PHOTOS ? "YES" : "NO "} nearest neighbours and the edit test ran (needs ${MIN_PHOTOS} photos measured)`,
    `${answered ? "YES" : "NO "} Jim answered every composite: ${yes} of ${r.answers.length} sensible`,
    `${r.copiesLeft === 0 ? "YES" : "NO "} every virtual copy removed${r.copiesLeft === 0 ? "" : ` (${r.copiesLeft} left)`}`,
    `${r.mastersChanged.length === 0 ? "YES" : "NO "} every edited photo's settings as they started${r.mastersChanged.length === 0 ? "" : ` (changed: ${r.mastersChanged.join(", ")})`}`,
    `${r.selectionBack ? "YES" : "NO "} the selection is as it was`,
  ];
  const putBack = r.copiesLeft === 0 && r.mastersChanged.length === 0;
  return { worked: r.measured === r.photos && r.measured >= MIN_PHOTOS && answered && putBack && r.selectionBack, putBack, lines };
}
