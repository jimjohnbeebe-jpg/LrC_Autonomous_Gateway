// The numbers the session loop runs on (ARCHITECTURE section 4, PRD sections 6.2 and 6.5, AVG-009).
//
// The settings defaults are PRD 6.2's; the settings page (Phase 5, settings\) can replace them, and
// a session takes its values as settings\session.ts orders them.
// Where the docs leave a number open, the value here is Claude Code's proposal from the Phase 3
// plan, accepted by Jim 2026-09-26 [stated: "go with recommendations"], and marked [inference].

/**
 * PRD 6.2 defaults; AVG-009 for the guardrails, decay and convergence; the variant count 2-3
 * (PHASE5_PLAN decision 2a). settings\page.ts PAGE_SPECS starts from the same values (a test keeps
 * them equal).
 */
export const SESSION_DEFAULTS = {
  approval: "autonomous",
  maxPasses: 4,
  maxPassesLimit: 8,
  variantCount: 3,
  clipHighPct: 0.5,
  clipLowPct: 1.0,
  decay: [1.0, 0.6, 0.4, 0.25] as readonly number[],
  longEdge: 1600,
  quality: 75,
} as const;

import type { Pipeline } from "../params/index.js";

/**
 * Base maximum |change| per pass for each numeric slider, in canonical units (ARCHITECTURE section 4).
 * Sharpening and noise have no base maximum there: 30 per pass (0.5 for the radius) [inference]. On
 * the rendered pipeline temperature is relative, -100..100 like tint, and takes tint's 30 [inference].
 */
export function baseMaxStep(name: string, pipeline: Pipeline = "raw"): number | null {
  if (name === "temperature" && pipeline === "rendered") return 30;
  const fixed: Record<string, number> = {
    exposure: 1.0,
    contrast: 40,
    highlights: 60,
    shadows: 60,
    whites: 60,
    blacks: 60,
    texture: 40,
    clarity: 40,
    dehaze: 40,
    vibrance: 30,
    saturation: 30,
    temperature: 1500,
    tint: 30,
    "sharpening.amount": 30,
    "sharpening.radius": 0.5,
    "sharpening.detail": 30,
    "sharpening.masking": 30,
    "noise.luminance": 30,
    "noise.color": 30,
  };
  if (name in fixed) return fixed[name] as number;
  if (name.startsWith("hsl.")) return 40;
  if (name.startsWith("grading.")) return 30;
  return null;
}

/**
 * The smallest change that counts as moving a slider, for convergence (AVG-009 names it without a
 * value): 0.05 EV, 50 K (1 for the rendered pipeline's relative temperature), 0.1 for the sharpening
 * radius, 1 for everything else [inference].
 */
export function minStep(name: string, pipeline: Pipeline = "raw"): number {
  if (name === "exposure") return 0.05;
  if (name === "temperature" && pipeline === "raw") return 50;
  if (name === "sharpening.radius") return 0.1;
  return 1;
}

/**
 * Values are written at the precision of the Develop sliders: exposure to 0.01, the sharpening
 * radius to 0.1, everything else whole [inference: the slider steps in the Develop panel; a value
 * Lightroom rounds on its own would fail the read-back check].
 */
export function roundForSlider(name: string, value: number): number {
  const digits = name === "exposure" ? 2 : name === "sharpening.radius" ? 1 : 0;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The decay multiplier for pass n (1-based): 1.0, 0.6, 0.4, 0.25, then the last value again. */
export function decayFor(pass: number, decay: readonly number[] = SESSION_DEFAULTS.decay): number {
  if (decay.length === 0) return 1;
  return decay[Math.min(pass, decay.length) - 1] ?? (decay[decay.length - 1] as number);
}

/**
 * Sliders that push the rendered highlights up when moved in the given direction (+1 raise, -1
 * lower), and those that push the shadows down. Used by the projected guardrail and to find the
 * sliders to pull back after a breach [inference: the direction each Basic-panel slider moves the
 * histogram's ends].
 */
export const RAISES_HIGHLIGHTS: Readonly<Record<string, 1 | -1>> = {
  exposure: 1,
  whites: 1,
  highlights: 1,
  contrast: 1,
  dehaze: 1,
  saturation: 1,
  vibrance: 1,
};
export const CRUSHES_SHADOWS: Readonly<Record<string, 1 | -1>> = {
  exposure: -1,
  blacks: -1,
  shadows: -1,
  contrast: 1,
  dehaze: 1,
};

/**
 * Fixed correction steps when the clipping limit is breached and no slider of the step is to
 * blame (pass 0's baseline, PRD 6.5: whites then highlights, blacks then shadows), one per render
 * [inference: the step sizes and the exposure fallback]. A step uses each row once, at most
 * MAX_CORRECTIONS renders. Pass 0 corrects "until under" (PRD 6.5): its table starts again from the
 * top, at most MAX_BASELINE_CORRECTIONS renders [stated: Jim, 2026-09-27, PHASE4_PLAN decision 1;
 * the repeat is Claude Code's reading of "in fixed steps until under", approved with the session 2
 * plan].
 */
export const HIGH_CORRECTIONS: ReadonlyArray<Readonly<Record<string, number>>> = [{ whites: -20 }, { highlights: -30 }, { exposure: -0.3 }];
export const LOW_CORRECTIONS: ReadonlyArray<Readonly<Record<string, number>>> = [{ blacks: 20 }, { shadows: 30 }, { exposure: 0.3 }];
export const MAX_CORRECTIONS = 3;
export const MAX_BASELINE_CORRECTIONS = 8;

/** Convergence by metrics (PRD 6.5, AVG-009): mean luma moved < 1/255 of the range, clipping < 0.1 point. */
export const CONVERGENCE = { lumaMean: 1, clipPct: 0.1 } as const;

/**
 * Region preservation (lr_set_regions `preserve: true`, MCP_TOOLS): mean hue within 6 degrees and
 * mean saturation within 8 points (0-100 scale) of the values when the region was set
 * [inference: MCP_TOOLS gives 6 degrees and "8 %" as starting thresholds; read here as points].
 */
export const REGION_PRESERVE = { hueDegrees: 6, saturationPoints: 8 } as const;
