// Grading hue in planStep (src/session/plan.ts): a target angle, no per-pass cap, wraps at 360 (issue #128).

import { describe, expect, it } from "vitest";
import { loadDefaultParamMap, type CanonicalSettings } from "../src/params/index.js";
import { isCircularHue, planStep } from "../src/session/index.js";

const map = loadDefaultParamMap();
const HUE = "grading.highlights.hue";
/** Plans a change to the highlights hue from `before` at the given pass. */
const hue = (before: number, change: number, pass = 1) => planStep({ [HUE]: change }, { [HUE]: before, "grading.highlights.sat": 0 } satisfies CanonicalSettings, pass, map);

describe("grading hue in planStep", () => {
  it("applies the whole change in pass 1, with nothing clamped", () => {
    const plan = hue(0, 42);
    expect(plan.changes).toEqual([{ name: HUE, before: 0, requested: 42, after: 42, delta: 42 }]);
    expect(plan.clamped).toEqual([]);
  });

  it("applies the same change in pass 4 (decay 0.25): no per-pass cap", () => {
    const plan = hue(0, 42, 4);
    expect(plan.changes[0]).toMatchObject({ after: 42, delta: 42 });
    expect(plan.clamped).toEqual([]);
  });

  it("wraps below 0: 10 and -20 gives 350", () => {
    expect(hue(10, -20).changes[0]).toMatchObject({ after: 350, delta: -20 });
  });

  it("wraps above 359: 350 and +20 gives 10", () => {
    expect(hue(350, 20).changes[0]).toMatchObject({ after: 10, delta: 20 });
  });

  it("takes the shortest way round: 10 and +340 gives 350, delta -20", () => {
    expect(hue(10, 340).changes[0]).toMatchObject({ after: 350, delta: -20 });
  });

  it("treats a before of 360 as 0", () => {
    expect(hue(360, 10).changes[0]).toMatchObject({ after: 10, delta: 10 });
  });

  it("lists a change of 0 or 360 as unchanged", () => {
    for (const change of [0, 360]) {
      const plan = hue(10, change);
      expect(plan.changes).toEqual([]);
      expect(plan.unchanged).toEqual([HUE]);
    }
  });

  it("still caps saturation at 30 x decay: 50 at pass 2 applies 18", () => {
    const plan = planStep({ "grading.highlights.sat": 50 }, { "grading.highlights.sat": 0 }, 2, map);
    expect(plan.changes[0]).toMatchObject({ name: "grading.highlights.sat", after: 18 });
    expect(plan.clamped).toHaveLength(1);
  });
});

describe("isCircularHue", () => {
  it("is true for the four grading hues", () => {
    for (const range of ["shadows", "midtones", "highlights", "global"]) expect(isCircularHue(`grading.${range}.hue`)).toBe(true);
  });

  it("is false for other names", () => {
    for (const name of ["grading.midtones.sat", "hsl.red.hue", "local.toning_hue", "exposure"]) expect(isCircularHue(name)).toBe(false);
  });
});
