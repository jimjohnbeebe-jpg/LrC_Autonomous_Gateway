// Step planning (src/session/plan.ts, rules.ts): decay, limits, the projected guardrail, pull-backs,
// fixed corrections and convergence, without Lightroom.

import { describe, expect, it } from "vitest";
import { computeMetrics, deltaMetrics, summarize, type MetricsSummary } from "../src/metrics/index.js";
import { loadDefaultParamMap, type CanonicalSettings } from "../src/params/index.js";
import {
  applyProjectedGuardrail,
  baseMaxStep,
  convergedByMetrics,
  decayFor,
  fixedCorrection,
  hueDistance,
  minStep,
  planStep,
  pullBack,
  roundForSlider,
  type Change,
} from "../src/session/index.js";

const map = loadDefaultParamMap();
const current: CanonicalSettings = { exposure: 0.33, whites: 0, highlights: -21, blacks: 0, contrast: 0, temperature: 5500, "lens.profile_enable": 1, camera_profile: "Camera Neutral" };
const limits = { clipHighPct: 0.5, clipLowPct: 1.0 };
/** A metrics summary with the given clipping. */
const withClip = (high: number, low: number): MetricsSummary => ({ ...summarize(computeMetrics(Uint8Array.from([128, 128, 128]), 1, 1, 3)), clip_high_pct: high, clip_low_pct: low });

describe("session rules", () => {
  it("decays per pass: 1.0, 0.6, 0.4, 0.25, then 0.25", () => {
    expect([1, 2, 3, 4, 5, 8].map((n) => decayFor(n))).toEqual([1, 0.6, 0.4, 0.25, 0.25, 0.25]);
  });

  it("has the base maxima of ARCHITECTURE section 4, and 30 for sharpening and noise", () => {
    expect(baseMaxStep("exposure")).toBe(1);
    expect(baseMaxStep("whites")).toBe(60);
    expect(baseMaxStep("hsl.orange.sat")).toBe(40);
    expect(baseMaxStep("grading.midtones.hue")).toBe(30);
    expect(baseMaxStep("temperature")).toBe(1500);
    expect(baseMaxStep("noise.luminance")).toBe(30);
    expect(baseMaxStep("lens.profile_enable")).toBeNull();
    expect([minStep("exposure"), minStep("temperature"), minStep("contrast")]).toEqual([0.05, 50, 1]);
  });

  it("rounds to the sliders' precision", () => {
    expect(roundForSlider("exposure", 0.8333)).toBe(0.83);
    expect(roundForSlider("contrast", 12.5)).toBe(13);
    expect(roundForSlider("sharpening.radius", 1.26)).toBe(1.3);
  });

  it("measures hue distance the short way round", () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
  });
});

describe("planStep", () => {
  it("adds a change to the current value and caps it at base maximum x decay", () => {
    const pass1 = planStep({ exposure: 2 }, current, 1, map);
    expect(pass1.changes).toEqual([{ name: "exposure", before: 0.33, requested: 2, after: 1.33, delta: 1 }]);
    expect(pass1.clamped[0]).toMatchObject({ name: "exposure", requested: 2, applied: 1 });
    const pass2 = planStep({ exposure: -2, whites: 50 }, current, 2, map);
    expect(pass2.changes.map((c) => [c.name, c.delta])).toEqual([["exposure", -0.6], ["whites", 36]]);
  });

  it("keeps a slider inside its range and reports it", () => {
    const plan = planStep({ highlights: -60 }, { highlights: -90 }, 1, map);
    expect(plan.changes[0]).toMatchObject({ after: -100, delta: -10 });
    expect(plan.clamped.map((c) => c.reason).join()).toMatch(/range is -100..100/);
  });

  it("refuses a change with nothing left after the limits, and lists zero changes as unchanged", () => {
    const plan = planStep({ highlights: -10, whites: 0 }, { highlights: -100, whites: 5 }, 1, map);
    expect(plan.changes).toEqual([]);
    expect(plan.refused).toEqual([{ name: "highlights", by: "slider", reason: expect.stringMatching(/no change is left/) }]);
    expect(plan.unchanged).toEqual(["whites"]);
  });

  it("sets the camera profile, switches and curves to the given value", () => {
    const plan = planStep({ camera_profile: "Adobe Landscape", "lens.profile_enable": 1, "lens.ca_remove": 0 }, current, 3, map);
    expect(plan.changes).toEqual([
      { name: "camera_profile", before: "Camera Neutral", requested: "Adobe Landscape", after: "Adobe Landscape", delta: null },
      { name: "lens.ca_remove", before: null, requested: 0, after: 0, delta: null },
    ]);
    expect(plan.unchanged).toEqual(["lens.profile_enable"]);
  });

  it("throws for an unknown name or a wrong type, so nothing is written", () => {
    expect(() => planStep({ exposur: 0.2 }, current, 1, map)).toThrow(/Unknown parameter "exposur"/);
    expect(() => planStep({ exposure: "0.2" }, current, 1, map)).toThrow(/takes a change/);
    expect(() => planStep({ camera_profile: "Adobe Nothing" }, current, 1, map)).toThrow(/Adobe Nothing/);
  });

  it("refuses a slider the photo does not have now", () => {
    expect(planStep({ "hsl.red.sat": 10 }, current, 1, map).refused[0]?.reason).toMatch(/not available/);
  });
});

describe("the projected guardrail", () => {
  it("refuses sliders that push further into a limit already reached, and keeps the others", () => {
    const plan = applyProjectedGuardrail(planStep({ exposure: 0.3, whites: 10, shadows: 20, highlights: -10 }, { ...current, shadows: 0 }, 1, map), withClip(0.8, 0), limits);
    expect(plan.refused.map((r) => r.name)).toEqual(["exposure", "whites"]);
    expect(plan.changes.map((c) => c.name)).toEqual(["shadows", "highlights"]);
    expect(plan.refused[0]?.reason).toMatch(/clip_high_pct is 0.8 %, at or over the limit of 0.5 %/);
  });

  it("refuses darkening sliders when the shadows are at their limit", () => {
    const plan = applyProjectedGuardrail(planStep({ blacks: -10, contrast: 10, exposure: 0.2 }, current, 1, map), withClip(0, 1.2), limits);
    expect(plan.refused.map((r) => r.name)).toEqual(["blacks", "contrast"]);
    expect(plan.changes.map((c) => c.name)).toEqual(["exposure"]);
  });

  it("caps a change that a probe's slope says would cross the limit", () => {
    // 0.2 % now; +1 % per EV: 0.3 EV of room before 0.5 %.
    const slopes = new Map([["exposure", { luma_mean: 40, clip_high_pct: 1, clip_low_pct: -0.5 }]]);
    const plan = applyProjectedGuardrail(planStep({ exposure: 0.8 }, current, 1, map), withClip(0.2, 0), limits, slopes);
    expect(plan.changes[0]).toMatchObject({ name: "exposure", delta: 0.3, after: 0.63 });
    expect(plan.clamped.at(-1)?.reason).toMatch(/probe's slope/);
    const lowering = applyProjectedGuardrail(planStep({ exposure: -0.5 }, current, 1, map), withClip(0.2, 0), limits, slopes);
    expect(lowering.changes[0]?.delta).toBe(-0.5); // lowers clip_high; clip_low rises 0.25, within its room
  });

  it("does nothing without metrics", () => {
    const plan = applyProjectedGuardrail(planStep({ exposure: 0.3 }, current, 1, map), null, limits);
    expect(plan.changes).toHaveLength(1);
  });
});

describe("corrections", () => {
  const step: Change[] = [
    { name: "exposure", before: 0.33, requested: 1, after: 1.33, delta: 1 },
    { name: "highlights", before: -21, requested: -10, after: -31, delta: -10 },
    { name: "blacks", before: 0, requested: -20, after: -20, delta: -20 },
  ];

  it("pulls back half, then all, of the sliders that pushed towards the breach", () => {
    expect(pullBack(step, "high", 0.5)).toEqual({ exposure: 0.83 });
    expect(pullBack(step, "high", 1)).toEqual({ exposure: 0.33 });
    expect(pullBack(step, "low", 0.5)).toEqual({ blacks: -10 });
    expect(pullBack([step[1] as Change], "high", 0.5)).toEqual({});
  });

  it("applies a fixed correction inside the range and leaves out sliders at their limit", () => {
    expect(fixedCorrection({ whites: -20 }, { whites: -90 }, map)).toEqual({ whites: -100 });
    expect(fixedCorrection({ whites: -20 }, { whites: -100 }, map)).toEqual({});
    expect(fixedCorrection({ exposure: -0.3 }, { exposure: 0.33 }, map)).toEqual({ exposure: 0.03 });
  });
});

describe("convergence by metrics", () => {
  const m = (level: number, clip = 0): MetricsSummary => {
    const s = summarize(computeMetrics(Uint8Array.from([level, level, level]), 1, 1, 3));
    return { ...s, clip_high_pct: clip };
  };
  const small: Change[] = [{ name: "exposure", before: 0.3, requested: 0.02, after: 0.32, delta: 0.02 }];

  it("converges when luma moved < 1, clipping < 0.1 point and no slider more than its minimum step", () => {
    expect(convergedByMetrics(deltaMetrics(m(120), m(120.5 as number)), small)).toBe(true);
  });

  it("does not converge on a larger move, a clipping change, a big slider change or a profile change", () => {
    expect(convergedByMetrics(deltaMetrics(m(120), m(122)), small)).toBe(false);
    expect(convergedByMetrics(deltaMetrics(m(120), m(120, 0.2)), small)).toBe(false);
    expect(convergedByMetrics(deltaMetrics(m(120), m(120)), [{ name: "exposure", before: 0, requested: 0.1, after: 0.1, delta: 0.1 }])).toBe(false);
    expect(convergedByMetrics(deltaMetrics(m(120), m(120)), [{ name: "camera_profile", before: "a", requested: "b", after: "b", delta: null }])).toBe(false);
    expect(convergedByMetrics(null, small)).toBe(false);
  });
});
