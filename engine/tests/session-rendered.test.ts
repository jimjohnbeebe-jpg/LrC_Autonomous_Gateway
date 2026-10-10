// A session on a rendered photo (Phase 8 row 3) through the tool layer, against the simulated Lightroom
// with DSC_0031.JPG as spike S10's census read it (helpers/lightroom-sim-rendered.ts): what the context and
// the begin result report, pass 0 with an intent's rendered profile and priors (schema v2), relative
// white balance in lr_step, process version 11.0, a photo of neither pipeline, and lr_sync_series
// checking each target against its own pipeline (decision R1 A [stated: Jim, 2026-10-09, "Go"]).

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sessionLogSchema } from "../src/log/index.js";
import { toToolError } from "../src/mcp/index.js";
import { intent } from "./helpers/session-harness.js";
import { addCopy, clean, logDir, lr, map, sync, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness("rendered");

const quiet = { return_image: "none" } as const;
const begin = async (intent_id: string) => (await tools.beginSession({ intent_id, ...quiet })).json;
/** The one session log in the log folder (the Tools layer picks its own session id). */
const readLog = () => {
  const file = readdirSync(logDir).find((f) => f.endsWith(".json") && !f.endsWith(".recipe.json"));
  return sessionLogSchema.parse(JSON.parse(readFileSync(path.join(logDir, file as string), "utf8")));
};
const step = (session_id: string, settings: Record<string, unknown>) => tools.step({ session_id, settings, rationale: "test", ...quiet });

describe("a rendered photo", () => {
  it("is reported as rendered, with relative white balance and its own profile, in the context and the begin result", async () => {
    clean();
    const ctx = (await tools.getActivePhotoContext()).json;
    expect(ctx).toMatchObject({ file_format: "JPG", pipeline: "rendered", white_balance_unit: "relative", process_version: "15.4", process_version_label: "15.4 (Version 6)", camera_profile: "Color" });
    const json = await begin("test_plain");
    expect(json["target"]).toMatchObject({ filename: "DSC_0031.JPG", pipeline: "rendered", white_balance_unit: "relative" });
    expect(readLog().target).toMatchObject({ pipeline: "rendered", process_version: "15.4" });
  });

  it("pass 0 sets the intent's rendered profile", async () => {
    clean();
    const json = await begin("test_prior"); // profile.rendered Color, exposure +0.2
    expect(lr.settings).toMatchObject({ CameraProfile: "Embedded", ConvertToGrayscale: false, Exposure2012: 0.2 });
    expect(lr.settings).not.toHaveProperty("Look");
    expect(json).not.toHaveProperty("pass0_warnings");
    expect(readLog().passes[0]).not.toHaveProperty("warnings");
  });

  it("pass 0 sets Monochrome for a monochrome intent; the colour sliders it drops are refused, not written", async () => {
    clean();
    intent("test_mono", { profile: { raw: "Adobe Monochrome", rendered: "Monochrome" } });
    const json = await begin("test_mono");
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe("Monochrome");
    expect(lr.settings).not.toHaveProperty("Saturation");
    const out = (await step(json["session_id"] as string, { saturation: 10, exposure: 0.1 })).json;
    expect(out["refused"]).toEqual([expect.objectContaining({ name: "saturation", by: "slider" })]);
    expect(lr.settings["Exposure2012"]).toBeCloseTo(0.1);
  });

  it("knows every monochrome profile (Greptile, PR #99)", () => {
    // The profiles that dropped the colour keys in S5 (docs\reports\phase0\S5\part1\s5_profiles.log: 159 keys), Adobe Monochrome's Look, and the rendered Monochrome.
    const MONO = ["Adobe Monochrome", "Camera Deep Tone Monochrome", "Camera Flat Monochrome", "Camera Monochrome", "Camera Monochrome (Green Filter)", "Camera Monochrome (Orange Filter)", "Camera Monochrome (Red Filter)", "Camera Monochrome (Yellow Filter)", "Monochrome"];
    const profiles = map.cameraProfiles();
    expect(profiles.names()).toEqual(expect.arrayContaining(MONO));
    for (const name of profiles.names()) expect(profiles.monochrome(name), name).toBe(MONO.includes(name));
  });

  it("pass 0 writes the rendered white-balance priors in relative units, and not the raw ones", async () => {
    clean();
    intent("test_warm", { priors: { exposure: 0.1 }, priors_by_pipeline: { raw: { temperature: 300, tint: 5 }, rendered: { temperature: 10, tint: -3 } } });
    await begin("test_warm");
    expect(lr.settings).toMatchObject({ IncrementalTemperature: 10, IncrementalTint: -3, WhiteBalance: "Custom", Exposure2012: 0.1 });
    expect(lr.settings).not.toHaveProperty("Temperature");
  });

  it("steps temperature in relative units: capped at 30 per pass, written with Custom", async () => {
    clean();
    lr.renderModel = "grey"; // the tonal model clips its red channel at this warmth, and the guardrail would undo the step
    const id = (await begin("test_plain"))["session_id"] as string;
    const out = (await step(id, { temperature: 50, tint: -4 })).json;
    expect(out["clamped"]).toEqual([expect.objectContaining({ name: "temperature", requested: 50, applied: 30 })]);
    expect(lr.settings).toMatchObject({ IncrementalTemperature: 30, IncrementalTint: -4, WhiteBalance: "Custom" });
    expect(lr.settings).not.toHaveProperty("Temperature");
    expect(toToolError(await step(id, { camera_profile: "Adobe Color" }).catch((e: unknown) => e)).code).toBe("WRONG_PIPELINE");
    const end = (await tools.endSession({ session_id: id, outcome: "revert" })).json;
    expect(end).toMatchObject({ outcome: "revert", revert: { differing: [] } });
    expect(lr.settings).toMatchObject({ IncrementalTemperature: 0, WhiteBalance: "As Shot" });
  });

  it("edits a photo on process version 11.0 without an update step", async () => {
    lr.useRendered("11.0");
    clean();
    const json = await begin("test_prior");
    expect(json["target"]).toMatchObject({ process_version: "11.0", pipeline: "rendered" });
    expect(lr.settings["Exposure2012"]).toBe(0.2);
  });

  it("refuses a photo whose settings match neither pipeline (PIPELINE_UNKNOWN), and the context says why", async () => {
    clean();
    lr.settings["Temperature"] = 5000;
    const e = toToolError(await tools.beginSession({ intent_id: "test_plain", ...quiet }).catch((err: unknown) => err));
    expect(e.code).toBe("PIPELINE_UNKNOWN");
    const ctx = (await tools.getActivePhotoContext()).json;
    expect(ctx).toMatchObject({ pipeline: null, settings_error: { code: "PIPELINE_UNKNOWN" } });
  });
});

describe("lr_sync_series to rendered photos", () => {
  // Lightroom stores a write by uuid to an unselected photo unchecked (S10 run 1; the sim does too), so the
  // engine checks each target's values against the target's own pipeline before writing (sync\target.ts).
  // A Kelvin value or a raw profile is not transferable to a rendered photo (sync\transfer.ts, Phase 8 row 5):
  // with nothing else to write, the target is skipped before its snapshot.
  it("writes relative white balance, and sets Kelvin values or a raw profile aside before writing", async () => {
    clean();
    const a = addCopy(1);
    const settingsOf = () => (lr.copies.get(a) as { settings: Record<string, unknown> }).settings;
    await tools.syncSeries({ source: { settings: { temperature: 20 } }, targets: { uuids: [a] }, adaptive_exposure: false, return_image: "none" });
    expect(settingsOf()).toMatchObject({ IncrementalTemperature: 20, WhiteBalance: "Custom" });
    for (const [settings, group] of [
      [{ temperature: 5500 }, "white_balance"],
      [{ camera_profile: "Adobe Color" }, "camera_profile"],
    ] as const) {
      const out = await sync({ source: { settings }, targets: { uuids: [a] }, adaptive_exposure: false, return_image: "none" });
      expect(out.json["applied"]).toBe(0);
      expect(out.json["skipped"], JSON.stringify(settings)).toEqual([expect.objectContaining({ uuid: a, code: "NOTHING_TRANSFERABLE", not_transferable: [expect.objectContaining({ group })] })]);
      expect((out.json["skipped"] as Array<Record<string, unknown>>)[0]).not.toHaveProperty("snapshot"); // refused before its snapshot
    }
    expect(settingsOf()).not.toHaveProperty("Temperature");
    expect(settingsOf()).toMatchObject({ CameraProfile: "Embedded", IncrementalTemperature: 20 });
  });
});
