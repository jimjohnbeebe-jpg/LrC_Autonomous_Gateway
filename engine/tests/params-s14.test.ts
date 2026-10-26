// The B&W mixer and Calibration keys of the canonical map (Phase 10 row 2) against spike S14 run 2's
// committed results (docs\reports\phase10\S14.md "d. B&W mixer", "e. Calibration").

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_PARAMS, RENDERED_PARAMS, S14_RUN, type ParamSpec } from "../src/params/canonical.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { lightroomLabel } from "../src/params/labels.js";
import { planStep } from "../src/session/plan.js";
import { baseMaxStep } from "../src/session/rules.js";
import { groupOf, splitTransferable } from "../src/sync/index.js";

type Record_ = { sdk_key: string; min: number; max: number; min_read: number; max_read: number; below_written: number; below_read: number; above_written: number; above_read: number };
type Photo = { pipeline: string; mixer?: { range: { per_parameter: Record_[] } }; calibration?: { per_parameter: Record_[] } };
const results = JSON.parse(readFileSync(fileURLToPath(new URL(`../../${S14_RUN}`, import.meta.url)), "utf8")) as { photos: Photo[] };
const s14 = [...CANONICAL_PARAMS].filter(([, spec]) => spec.kind === "number" && spec.rangeSource.includes(S14_RUN)) as Array<[string, ParamSpec & { kind: "number" }]>;
const BANDS = ["red", "orange", "yellow", "green", "aqua", "blue", "purple", "magenta"];

describe("params: the B&W mixer and Calibration (spike S14)", () => {
  it("has Jim's 15 names [stated: 2026-10-25], the same on both pipelines", () => {
    expect(s14.map(([name]) => name).sort()).toEqual([
      ...BANDS.map((b) => `bw.${b}`),
      "calibration.blue.hue", "calibration.blue.sat", "calibration.green.hue", "calibration.green.sat",
      "calibration.red.hue", "calibration.red.sat", "calibration.shadow_tint",
    ].sort());
    for (const [name, spec] of s14) expect(RENDERED_PARAMS.get(name), name).toEqual(spec);
  });

  it("matches every limit to S14 run 2 on the raw NEF and the rendered JPEG; 1 % beyond was not taken", () => {
    const photos = results.photos.slice(0, 2);
    expect(photos.map((p) => p.pipeline)).toEqual(["raw", "rendered"]);
    for (const photo of photos) {
      const records = new Map([...(photo.mixer?.range.per_parameter ?? []), ...(photo.calibration?.per_parameter ?? [])].map((r) => [r.sdk_key, r]));
      expect(records.size, photo.pipeline).toBe(15);
      for (const [name, spec] of s14) {
        const r = records.get(spec.sdkKey);
        expect(r, `${photo.pipeline} ${name}`).toBeDefined();
        if (!r) continue;
        expect([r.min, r.max, r.min_read, r.max_read], name).toEqual([spec.min, spec.max, spec.min, spec.max]);
        expect(r.below_read, name).not.toBe(r.below_written);
        expect(r.above_read, name).not.toBe(r.above_written);
      }
    }
  });

  it("gives each a Lightroom label, a per-pass step and its own sync group", () => {
    const map = loadDefaultParamMap();
    for (const [name] of s14) {
      expect(map.names(), name).toContain(name);
      expect(lightroomLabel(name), name).not.toBe(name);
    }
    expect(lightroomLabel("bw.aqua")).toBe("B&W Aqua");
    expect(lightroomLabel("calibration.red.sat")).toBe("Red Primary Saturation");
    expect(baseMaxStep("bw.blue")).toBe(40);
    expect(baseMaxStep("calibration.shadow_tint", "rendered")).toBe(20);
    expect(groupOf("bw.red")).toBe("bw");
    expect(groupOf("calibration.green.hue")).toBe("calibration");
  });

  it("refuses a B&W mixer change on a colour photo, which has no mixer keys, and says why", () => {
    const plan = planStep({ "bw.blue": -20 }, { "hsl.blue.sat": 0 }, 1, loadDefaultParamMap());
    expect(plan.changes).toEqual([]);
    expect(plan.refused).toEqual([expect.objectContaining({ name: "bw.blue", reason: expect.stringMatching(/only on a black-and-white photo/) })]);
  });

  it("refuses a colour slider in the step that sets a monochrome profile, which drops it (review, PR B)", () => {
    const plan = planStep({ camera_profile: "Adobe Monochrome", vibrance: 5, "hsl.red.sat": 3, exposure: 0.1 }, { vibrance: 0, "hsl.red.sat": 0, exposure: 0 }, 1, loadDefaultParamMap());
    expect(plan.changes.map((c) => c.name)).toEqual(["camera_profile", "exposure"]);
    expect(plan.refused.map((r) => [r.name, r.by])).toEqual([["vibrance", "slider"], ["hsl.red.sat", "slider"]]);
    expect(plan.refused[0]?.reason).toMatch(/monochrome camera_profile drops vibrance: set it in an earlier step/);
    expect(planStep({ camera_profile: "Adobe Color", vibrance: 5 }, { vibrance: 0 }, 1, loadDefaultParamMap()).refused).toEqual([]);
  });

  it("syncs the B&W mixer only onto a photo that has it, or with a monochrome profile (review, PR B)", () => {
    const map = loadDefaultParamMap();
    const colour = { pipeline: "raw" as const, process_version: "15.4", settings: { vibrance: 0 } };
    const out = splitTransferable(map, { "bw.red": 10, exposure: 0.2 }, "raw", colour);
    expect(out.writable).toEqual({ exposure: 0.2 });
    expect(out.not_transferable).toEqual([{ group: "bw", names: ["bw.red"], reason: expect.stringMatching(/only on a black-and-white photo/) }]);
    expect(splitTransferable(map, { "bw.red": 10, camera_profile: "Adobe Monochrome" }, "raw", colour).writable).toEqual({ "bw.red": 10, camera_profile: "Adobe Monochrome" });
    expect(splitTransferable(map, { "bw.red": 10 }, "raw", { ...colour, settings: { "bw.red": 0 } }).writable).toEqual({ "bw.red": 10 });
  });
});
