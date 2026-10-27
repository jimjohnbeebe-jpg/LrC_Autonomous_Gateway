// The sharpness advisory (src/session/sharpness-advice.ts, issue #216): only for a pass that changed a
// sharpening or noise slider, only past SHARPNESS_DROP_PCT, and a valid guardrail action of the session log.

import { describe, expect, it } from "vitest";
import { guardrailActionSchema } from "../src/log/session-log.js";
import { computeMetrics, type Metrics } from "../src/metrics/index.js";
import { SHARPNESS_DROP_PCT, sharpnessAdvisory } from "../src/session/sharpness-advice.js";
import type { Change } from "../src/session/plan.js";

const base = computeMetrics(new Uint8Array(30 * 20 * 3).fill(100), 30, 20, 3);
const at = (sharpness: number | null): Metrics => ({ ...base, sharpness });
const change = (name: string): Change => ({ name, before: 0, requested: 30, after: 30, delta: 30 });

describe("sharpness advisory", () => {
  it("advises when a noise or sharpening change lowers sharpness by more than the threshold", () => {
    const [a] = sharpnessAdvisory([change("exposure"), change("noise.luminance")], at(1000), at(1000 * (1 - (SHARPNESS_DROP_PCT + 5) / 100)));
    expect(a).toMatchObject({ kind: "advisory", limit: "sharpness", history_name: null, changes: {} });
    expect(a?.reason).toContain("noise.luminance");
    expect(a?.reason).not.toContain("exposure");
    expect(guardrailActionSchema.safeParse(a).success).toBe(true);
  });

  it("stays quiet within the threshold, for other sliders, for a rise and without a measurement", () => {
    const within = at(1000 * (1 - (SHARPNESS_DROP_PCT - 1) / 100));
    expect(sharpnessAdvisory([change("sharpening.amount")], at(1000), within)).toEqual([]);
    expect(sharpnessAdvisory([change("exposure")], at(1000), at(100))).toEqual([]);
    expect(sharpnessAdvisory([change("sharpening.amount")], at(1000), at(2000))).toEqual([]);
    expect(sharpnessAdvisory([change("sharpening.amount")], at(null), at(100))).toEqual([]);
    expect(sharpnessAdvisory([change("sharpening.amount")], at(0), at(0))).toEqual([]);
  });
});
