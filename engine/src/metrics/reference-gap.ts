// The distance from a photo to a set of reference photos (Phase 10 row 8, PHASE10_PLAN "Third re-plan" R1,
// R4): for the key perceptual measures, the references' range (min, median, max) and where the photo's
// value lies against it. Reported to Claude, never a target and never a refusal.
// Hues (a cast's wheel hue) are circular: the set is unwrapped around its circular mean before the
// min, median and max are taken. The photo is within when it lies on the arc from the min through the
// median to the max (min <= median <= max as unwrapped, so that arc is the counter-clockwise turn from min
// to max, under 360 degrees), else below or above by the nearer end [inference] (Greptile, PR #276).

import { hueTurn } from "./delta.js";
import { round, type Perceptual } from "./types.js";

const sum = (values: readonly number[]): number => values.reduce((a, b) => a + b, 0);

/** The measures compared, by name: L* percentiles, RMS contrast, colourfulness, each tone range's cast, the dark and light shares. */
export const GAP_MEASURES: Readonly<Record<string, (p: Perceptual) => number | null>> = {
  "L.p5": (p) => p.L.p5,
  "L.p50": (p) => p.L.p50,
  "L.p95": (p) => p.L.p95,
  rms: (p) => p.rms,
  cf: (p) => p.cf,
  "sh.C": (p) => p.cast.sh?.C ?? null,
  "sh.wheel": (p) => p.cast.sh?.wheel ?? null,
  "mid.C": (p) => p.cast.mid?.C ?? null,
  "mid.wheel": (p) => p.cast.mid?.wheel ?? null,
  "hi.C": (p) => p.cast.hi?.C ?? null,
  "hi.wheel": (p) => p.cast.hi?.wheel ?? null,
  /** Zones 0-II, % of pixels. */
  dark: (p) => round(sum(p.zones.slice(0, 3)), 1),
  /** Zones VIII-X, % of pixels. */
  light: (p) => round(sum(p.zones.slice(8)), 1),
};
const isHue = (name: string): boolean => name.endsWith(".wheel");

/** One measure across the references: min, median and max, and how many references had a value. */
export type RefRange = { min: number; med: number; max: number; n: number };
export type ReferenceAggregate = Record<string, RefRange | null>;
export type GapEntry = { v: number; ref: [number, number, number]; at: "below" | "within" | "above" };

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Hues as turns from their circular mean, so a set across 0 degrees (350, 10) stays together. */
function unwrap(hues: readonly number[]): number[] {
  const rad = (d: number): number => (d * Math.PI) / 180;
  const mean = (Math.atan2(sum(hues.map((h) => Math.sin(rad(h)))), sum(hues.map((h) => Math.cos(rad(h))))) * 180) / Math.PI;
  return hues.map((h) => mean + hueTurn(mean, h));
}

/** Each measure's range over the references' perceptual sets; null where no reference has a value. */
export function aggregate(sets: readonly Perceptual[]): ReferenceAggregate {
  const out: ReferenceAggregate = {};
  for (const [name, read] of Object.entries(GAP_MEASURES)) {
    const values = sets.map(read).filter((v): v is number => v !== null);
    if (values.length === 0) {
      out[name] = null;
      continue;
    }
    const sorted = (isHue(name) ? unwrap(values) : values).sort((a, b) => a - b);
    const fix = (v: number): number => (isHue(name) ? Math.round(((v % 360) + 360) % 360) % 360 : round(v, 3));
    out[name] = { min: fix(sorted[0] as number), med: fix(median(sorted)), max: fix(sorted[sorted.length - 1] as number), n: values.length };
  }
  return out;
}

/** Where the photo lies against the references, per measure; a measure without a value on either side is left out. */
export function referenceGap(photo: Perceptual, refs: ReferenceAggregate): Record<string, GapEntry> {
  const out: Record<string, GapEntry> = {};
  for (const [name, read] of Object.entries(GAP_MEASURES)) {
    const v = read(photo);
    const r = refs[name];
    if (v === null || !r) continue;
    out[name] = { v, ref: [r.min, r.med, r.max], at: isHue(name) ? hueAt(v, r) : v < r.min ? "below" : v > r.max ? "above" : "within" };
  }
  return out;
}

const ccw = (from: number, to: number): number => (((to - from) % 360) + 360) % 360;

/** A hue against the references' arc min -> median -> max (aggregate's unwrapped order); outside it, by the nearer end, and when both ends are as near (one reference hue), by the turn's sign. */
function hueAt(v: number, r: RefRange): GapEntry["at"] {
  if (ccw(r.min, v) <= ccw(r.min, r.med) + ccw(r.med, r.max)) return "within";
  const toMin = Math.abs(hueTurn(r.min, v)), toMax = Math.abs(hueTurn(r.max, v));
  if (toMin === toMax) return hueTurn(r.min, v) < 0 ? "below" : "above";
  return toMin < toMax ? "below" : "above";
}

/** A range a look's method expects of one measure (intents schema `checks`). */
export type LookCheck = { measure: string; min?: number | undefined; max?: number | undefined; why: string };
export type CheckResult = { measure: string; v: number | null; min: number | null; max: number | null; met: boolean | null; why: string };

/** Each check against the photo: met, not met, or null when the photo has no value (a cast without a hue). A wheel range runs counter-clockwise from min to max. */
export function lookChecks(photo: Perceptual, checks: readonly LookCheck[]): CheckResult[] {
  return checks.map((c) => {
    const read = GAP_MEASURES[c.measure];
    const v = read ? read(photo) : null;
    const min = c.min ?? null, max = c.max ?? null;
    let met: boolean | null = null;
    if (v !== null) {
      if (isHue(c.measure) && min !== null && max !== null) met = ccw(min, v) <= ccw(min, max);
      else met = (min === null || v >= min) && (max === null || v <= max);
    }
    return { measure: c.measure, v, min, max, met, why: c.why };
  });
}
