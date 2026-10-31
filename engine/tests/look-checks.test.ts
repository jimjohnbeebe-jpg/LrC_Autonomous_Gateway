// A look's checks (Phase 10 row 12, PHASE10_PLAN "Third re-plan" R5: a method's ranges, reported, never enforced):
// the schema's measure names against the reference gap's, the loader's checks, lookChecks' arithmetic, and the
// brief and look_checks of a session against the simulated Lightroom.

import { describe, expect, it } from "vitest";
import { CHECK_MEASURES, IntentLibrary } from "../src/intents/index.js";
import { GAP_MEASURES, lookChecks, type Perceptual } from "../src/metrics/index.js";
import { ID, clean, intent, map, manager, tmp, useSessionHarness } from "./helpers/session-harness.js";

const perceptual = (p50: number, wheel: number | null = 50): Perceptual => ({
  L: { p2: 1, p5: 3, p20: 20, p50, p80: 70, p95: 90, p98: 95 },
  zones: [1, 2, 3, 10, 20, 30, 20, 8, 3, 2, 1],
  cast: { sh: { a: 1, b: 5, C: 5, h: 80, wheel }, mid: null, hi: null },
  bands: { red: 10, orange: 40, yellow: 20, green: 10, aqua: 5, blue: 10, purple: 3, magenta: 2 },
  cf: 30,
  rms: 0.2,
});

describe("look checks", () => {
  it("names the reference gap's measures, no more and no fewer", () => {
    expect([...CHECK_MEASURES].sort()).toEqual(Object.keys(GAP_MEASURES).sort());
  });

  it("reports met, not met, and null without a value; a wheel range runs counter-clockwise from min to max", () => {
    const out = lookChecks(perceptual(60), [
      { measure: "L.p50", min: 56, why: "a" },
      { measure: "L.p50", max: 33, why: "b" },
      { measure: "dark", max: 5, why: "c" },
      { measure: "sh.wheel", min: 350, max: 60, why: "d" },
      { measure: "mid.C", min: 1, why: "e" },
    ]);
    expect(out.map((c) => c.met)).toEqual([true, false, false, true, null]);
    expect(out[2]).toEqual({ measure: "dark", v: 6, min: null, max: 5, met: false, why: "c" });
    expect(lookChecks(perceptual(60, 200), [{ measure: "sh.wheel", min: 350, max: 60, why: "d" }])[0]?.met).toBe(false);
  });

  it("takes checks in a schema v3 intent only, and refuses a reversed range or a one-sided wheel range", () => {
    const lib = new IntentLibrary({ map, userDir: tmp });
    const look = { id: "x", label: "x", category: "c", brief: "b", priors: {} };
    const checks = [{ measure: "L.p50", min: 40, why: "w" }];
    expect(() => lib.check({ ...look, schema_version: 2, checks })).toThrow(/checks need schema_version 3/);
    expect(lib.check({ ...look, schema_version: 3, checks })).toMatchObject({ checks });
    expect(() => lib.check({ ...look, schema_version: 3, checks: [{ measure: "L.p50", min: 60, max: 40, why: "w" }] })).toThrow(/min 60 is above max 40/);
    expect(() => lib.check({ ...look, schema_version: 3, checks: [{ measure: "sh.wheel", min: 10, why: "w" }] })).toThrow(/needs both min and max/);
    expect(() => lib.check({ ...look, schema_version: 3, checks: [{ measure: "L.p50", why: "w" }] })).toThrow();
    expect(() => lib.check({ ...look, schema_version: 3, checks: [{ measure: "L.p51", min: 1, why: "w" }] })).toThrow();
  });
});

describe("look checks in a session", () => {
  useSessionHarness();

  it("returns the checks in the brief and look_checks at begin and in every pass, and refuses nothing for them", async () => {
    clean();
    const checks = [{ measure: "L.p50", min: 99, why: "an unreachable range, to show it is not enforced" }];
    intent("look_checked", { schema_version: 3, checks });
    const begin = await manager.begin({ intent_id: "look_checked", return_image: "none" });
    expect(begin.json["intent_brief"]).toMatchObject({ checks, checks_note: expect.stringContaining("Reported only") });
    expect(begin.json["look_checks"]).toEqual([expect.objectContaining({ measure: "L.p50", min: 99, max: null, met: false })]);
    const step = await manager.step({ session_id: ID, settings: { exposure: 0.3 }, rationale: "brighter" });
    expect(step.json["ok"]).toBe(true);
    expect(step.json["look_checks"]).toEqual([expect.objectContaining({ measure: "L.p50", met: false })]);
  });

  it("has no look_checks without checks", async () => {
    clean();
    const begin = await manager.begin({ return_image: "none" });
    expect(begin.json["look_checks"]).toBeUndefined();
  });
});
