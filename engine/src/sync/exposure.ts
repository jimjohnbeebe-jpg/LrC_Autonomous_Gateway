// Adaptive exposure for lr_sync_series (PRD 6.10): move a target's exposure until its mean luma is
// within ±2/255 of the source's (PHASES Phase 4 acceptance). Exposure is not copied: the target
// starts from its own, as PHASE4_PLAN decision 5's test needs (copies at -1.0, +0.5, +1.0 EV must be
// found) [stated: Jim, 2026-09-27, "go with recommendations" on the row 8 plan, decision 2].
//
// Each try is a write and an export; a whole pass took 3.1-3.6 s in Phase 2 [handle:
// docs\reports\phase2\PHASE2.md:239-240, run 2 `passes[*].timings.total_ms`], so the search is short: at most
// MAX_RENDERS renders per target, the first of the photo as synced [inference: the cap,
// PHASE4_PLAN assumptions]. The first guess models the render's luma as scaling by 2^(1/2.2) per EV
// [inference: an sRGB-like 2.2 encoding of a linear sensor response, not measured in Lightroom];
// after that, a secant through the last two tries, which needs no model. The best try is kept.
// Tested against the Lightroom sim [handle: tests\sync-exposure.test.ts]; how luma answers exposure
// in Lightroom is [unverified] until PHASE4_PLAN row 10.

import { roundForSlider } from "../session/rules.js";

export const LUMA_TOLERANCE = 2;
export const MAX_RENDERS = 4;
const GAMMA = 2.2;

export type Point = { exposure: number; luma: number };
export type Solved = {
  /** The try closest to the goal; the caller writes it back when the last try was not it. */
  best: Point;
  /** Every try, the start first. */
  trail: Point[];
  met: boolean;
};

/** The next exposure to try, before rounding and clamping. */
function guess(trail: readonly Point[], best: Point, goal: number): number {
  const b = trail[trail.length - 1] as Point;
  const a = trail[trail.length - 2];
  // Secant, when the last two tries moved luma the way exposure moves it.
  if (a && b.exposure !== a.exposure) {
    const slope = (b.luma - a.luma) / (b.exposure - a.exposure);
    if (slope > 1e-3) return b.exposure + (goal - b.luma) / slope;
  }
  // The model, from the best try so far; a black render gets a 1 EV step in the right direction.
  if (best.luma < 0.5 || goal < 0.5) return best.exposure + Math.sign(goal - best.luma);
  return best.exposure + GAMMA * Math.log2(goal / best.luma);
}

/**
 * Search from `start` (the target as synced, already rendered) for an exposure whose render's mean
 * luma is within `tolerance` of `goal`. `measure(e)` writes exposure `e`, renders, and returns the
 * mean luma. Stops when within tolerance, after `maxRenders` renders (start included), or when the
 * next try would repeat one (at the slider's 0.01 EV precision, or clamped at the range's end).
 */
export async function solveExposure(
  start: Point,
  goal: number,
  measure: (exposure: number) => Promise<number>,
  options: { min: number; max: number; tolerance?: number; maxRenders?: number },
): Promise<Solved> {
  const tolerance = options.tolerance ?? LUMA_TOLERANCE;
  const maxRenders = options.maxRenders ?? MAX_RENDERS;
  const within = (p: Point): boolean => Math.abs(p.luma - goal) <= tolerance;
  const trail: Point[] = [start];
  let best = start;
  while (!within(best) && trail.length < maxRenders) {
    const next = roundForSlider("exposure", Math.min(options.max, Math.max(options.min, guess(trail, best, goal))));
    if (trail.some((p) => p.exposure === next)) break;
    const point = { exposure: next, luma: await measure(next) };
    trail.push(point);
    if (Math.abs(point.luma - goal) < Math.abs(best.luma - goal)) best = point;
  }
  return { best, trail, met: within(best) };
}
