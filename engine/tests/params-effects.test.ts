// The Effects keys of the canonical map (issue #125) against the effects probe's committed results.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_PARAMS, EFFECTS_RUN, RENDERED_PARAMS, type ParamSpec } from "../src/params/canonical.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { lightroomLabel } from "../src/params/labels.js";
import { planStep } from "../src/session/plan.js";
import { baseMaxStep } from "../src/session/rules.js";

type Probe = {
  photos: Array<{
    pipeline: string;
    range: { per_parameter: Array<{ sdk_key: string; min: number; max: number; min_read: number; max_read: number; below_written: number; below_read: number; above_written: number; above_read: number }> };
    style: { steps: Array<{ written: number; read_back: number }> };
  }>;
};
const probe = JSON.parse(readFileSync(fileURLToPath(new URL(`../../${EFFECTS_RUN}`, import.meta.url)), "utf8")) as Probe;
const effects = [...CANONICAL_PARAMS].filter(([, spec]) => spec.kind === "number" && spec.rangeSource.includes(EFFECTS_RUN)) as Array<[string, ParamSpec & { kind: "number" }]>;

describe("params: Effects (issue #125)", () => {
  it("has the nine keys under the SDK key words (D1 B), the same on both pipelines", () => {
    expect(effects.map(([name]) => name).sort()).toEqual([
      "grain.amount", "grain.frequency", "grain.size", "vignette.amount", "vignette.feather",
      "vignette.highlight_contrast", "vignette.midpoint", "vignette.roundness", "vignette.style",
    ]);
    for (const [name, spec] of effects) expect(RENDERED_PARAMS.get(name), name).toEqual(spec);
  });

  it("matches every limit to the probe on both pipelines; 1 % beyond was not taken", () => {
    expect(probe.photos.map((p) => p.pipeline).sort()).toEqual(["raw", "rendered"]);
    for (const photo of probe.photos) {
      const records = new Map(photo.range.per_parameter.map((r) => [r.sdk_key, r]));
      for (const [name, spec] of effects.filter(([n]) => n !== "vignette.style")) {
        const r = records.get(spec.sdkKey);
        expect(r, `${photo.pipeline} ${name}`).toBeDefined();
        if (!r) continue;
        expect([r.min, r.max, r.min_read, r.max_read], name).toEqual([spec.min, spec.max, spec.min, spec.max]);
        expect([r.below_read, r.above_read], name).not.toContain(r.below_written);
        expect(r.above_read, name).not.toBe(r.above_written);
      }
      const taken = photo.style.steps.filter((s) => s.read_back === s.written).map((s) => s.written);
      expect(taken, photo.pipeline).toEqual([1, 2, 3]);
    }
    const style = CANONICAL_PARAMS.get("vignette.style");
    expect(style?.kind === "number" && [style.min, style.max]).toEqual([1, 3]);
  });

  it("gives each key a Lightroom label, a step for the sliders and none for the style", () => {
    const map = loadDefaultParamMap();
    for (const [name] of effects) {
      expect(map.names(), name).toContain(name);
      expect(lightroomLabel(name), name).not.toBe(name);
    }
    expect(lightroomLabel("grain.frequency")).toBe("Grain Roughness");
    expect(baseMaxStep("vignette.amount")).toBe(30);
    expect(baseMaxStep("grain.frequency", "rendered")).toBe(30);
    expect(baseMaxStep("vignette.style")).toBeNull();
  });

  it("plans a pass: amount capped per pass and at its limit, style set in one pass", () => {
    const map = loadDefaultParamMap();
    const current = { "vignette.amount": -90, "vignette.style": 1, "grain.amount": 0 };
    const plan = planStep({ "vignette.amount": -20, "vignette.style": 2, "grain.amount": 50 }, current, 1, map, undefined, "rendered");
    const after = Object.fromEntries(plan.changes.map((c) => [c.name, c.after]));
    expect(after).toEqual({ "vignette.amount": -100, "vignette.style": 3, "grain.amount": 30 });
    expect(plan.clamped.map((c) => c.name).sort()).toEqual(["grain.amount", "vignette.amount"]);
  });

  it("takes a style change on the last pass too, without decay (Greptile, PR #147)", () => {
    const map = loadDefaultParamMap();
    const down = planStep({ "vignette.style": -1 }, { "vignette.style": 2 }, 4, map);
    expect(down.changes.map((c) => [c.name, c.after])).toEqual([["vignette.style", 1]]);
    const up = planStep({ "vignette.style": 2 }, { "vignette.style": 1 }, 4, map);
    expect(up.changes.map((c) => [c.name, c.after])).toEqual([["vignette.style", 3]]);
    expect(up.clamped).toEqual([]);
  });
});
