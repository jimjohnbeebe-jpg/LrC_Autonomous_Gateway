// A step Lightroom takes only in part is undone whole (GitHub issue #187 part 2; session\guardrail.ts
// undoRefused), against the simulated Lightroom: the photo is back at its pre-step settings, the pass is
// not used, and the next step goes on as if the refused one had not been. Also the raw B&W write (Phase 10
// row 2): Adobe Monochrome carries ConvertToGrayscale true, and undoing it turns the photo back to colour.

import { beforeEach, describe, expect, it } from "vitest";
import { companionsBack, type FromSdkResult } from "../src/params/index.js";
import { ID, SHORT, clean, fails, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

type J = Record<string, unknown>;
/** Issue #187's exact step [handle: issue #187 "Evidence" 1]. */
const STEP_187 = { "tone_curve.master": [0, 0, 64, 56, 128, 128, 192, 200, 255, 255], vibrance: 7 };

describe("a refused step is undone whole (issue #187)", () => {
  useSessionHarness("raw");
  beforeEach(() => clean());

  it("WRITE_NOT_TAKEN: the curve is not taken, the vibrance written with it is put back, and the pass is not used", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    const steps = lr.history.length;
    lr.ignored.add("ToneCurvePV2012"); // read back as it was, like #187's linear curve
    const e = await fails(manager.step({ session_id: ID, settings: STEP_187, rationale: "#187" }));
    expect(e.code).toBe("WRITE_NOT_TAKEN");
    expect(e.message).toMatch(/ToneCurvePV2012/);
    expect(e.message).toMatch(/The step was undone: the values Lightroom did take were written back/);
    expect(e.message).not.toMatch(/other values were written/);
    expect(e.details).toMatchObject({ undone: true, revert_history_name: `AVG ${SHORT} pass 1/4 revert` });
    expect(lr.settings).toEqual(before);
    expect(lr.history.slice(steps)).toEqual([`AVG ${SHORT} pass 1/4`, `AVG ${SHORT} pass 1/4 revert`]);
    expect(readLog().passes).toHaveLength(1); // pass 0 only

    lr.ignored.delete("ToneCurvePV2012");
    const next = await manager.step({ session_id: ID, settings: { contrast: 10 }, rationale: "the next step" });
    expect(next.json).toMatchObject({ pass: "1/4", applied: [expect.objectContaining({ name: "contrast" })] });
    expect(next.json["metrics_refreshed"]).toBeUndefined(); // the photo is as the last render showed it
  });

  it("FEATURE_UNAVAILABLE: a key Lightroom does not report back is named, and the rest is put back", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    const apply = plugin.handlers.get("apply_settings")!;
    plugin.handlers.set("apply_settings", async (p, id) => {
      const reply = await apply(p, id);
      if (reply !== "silent" && reply.ok && "Dehaze" in (p["settings"] as J)) delete ((reply.payload as J)["read_back"] as J)["Dehaze"];
      return reply;
    });
    const e = await fails(manager.step({ session_id: ID, settings: { dehaze: 10, vibrance: 7 }, rationale: "a key not reported" }));
    expect(e.code).toBe("FEATURE_UNAVAILABLE");
    expect(e.message).toMatch(/Dehaze could not be checked, so it was not written back/);
    expect(e.message).not.toMatch(/other values were written/);
    expect(e.message).toMatch(/the photo is as it was before this step except possibly Dehaze, which Lightroom does not report/);
    expect(e.details).toMatchObject({ undone: true, unverified_keys: ["Dehaze"] });
    expect(lr.settings["Vibrance"]).toBe(before["Vibrance"]);
  });

  it("undoes the step when a correction write after it is refused (review, PR B)", async () => {
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    const apply = plugin.handlers.get("apply_settings")!;
    plugin.handlers.set("apply_settings", async (p, id) => {
      const guard = String(p["history_name"]).endsWith("guard 1");
      if (guard) lr.ignored.add("Exposure2012");
      try {
        return await apply(p, id);
      } finally {
        if (guard) lr.ignored.delete("Exposure2012");
      }
    });
    const e = await fails(manager.step({ session_id: ID, settings: { exposure: 1, shadows: 10 }, rationale: "much brighter" }));
    expect(e.code).toBe("WRITE_NOT_TAKEN");
    expect(e.details).toMatchObject({ undone: true, revert_history_name: `AVG ${SHORT} pass 1/4 revert` });
    expect(lr.settings).toEqual(before);
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 1/4 revert`);
    expect(readLog().passes).toHaveLength(1); // pass 0 only
  });

  it("says so when the undo fails too", async () => {
    await manager.begin({ intent_id: "test_plain" });
    lr.ignored.add("ToneCurvePV2012");
    const apply = plugin.handlers.get("apply_settings")!;
    plugin.handlers.set("apply_settings", (p, id) =>
      String(p["history_name"]).endsWith("revert") ? { ok: false, error: { code: "write_failed", message: "no", recoverable: false } } : apply(p, id),
    );
    const e = await fails(manager.step({ session_id: ID, settings: STEP_187, rationale: "#187" }));
    expect(e.code).toBe("WRITE_NOT_TAKEN");
    expect(e.message).toMatch(/Undoing the step \(".* revert"\) failed too/);
    expect(e.details).toMatchObject({ undone: false });
  });

  it("writes raw Adobe Monochrome with ConvertToGrayscale true, and its undo writes the colour profile with false", async () => {
    await manager.begin({ intent_id: "test_plain" });
    lr.ignored.add("ToneCurvePV2012");
    const e = await fails(manager.step({ session_id: ID, settings: { camera_profile: "Adobe Monochrome", "tone_curve.master": [0, 0, 128, 160, 255, 255] }, rationale: "B&W" }));
    expect(e.details).toMatchObject({ undone: true });
    const writes = plugin.received.filter((r) => r.name === "apply_settings").map((r) => r.payload["settings"] as J);
    expect(writes.at(-2)).toMatchObject({ CameraProfile: "Adobe Standard", ConvertToGrayscale: true });
    expect(writes.at(-1)).toMatchObject({ CameraProfile: "Camera Neutral", ConvertToGrayscale: false });
    expect(lr.settings["ConvertToGrayscale"]).toBe(false);
  });

  it("puts a black-and-white photo with a colour profile (Treatment) back in black and white (review, PR B)", async () => {
    lr.settings["ConvertToGrayscale"] = true;
    await manager.begin({ intent_id: "test_plain" });
    lr.ignored.add("ToneCurvePV2012");
    const e = await fails(manager.step({ session_id: ID, settings: { camera_profile: "Adobe Monochrome", "tone_curve.master": [0, 0, 128, 160, 255, 255] }, rationale: "B&W" }));
    expect(e.details).toMatchObject({ undone: true });
    const writes = plugin.received.filter((r) => r.name === "apply_settings").map((r) => r.payload["settings"] as J);
    expect(writes.at(-1)).toMatchObject({ CameraProfile: "Camera Neutral", ConvertToGrayscale: true });
    expect(lr.settings["ConvertToGrayscale"]).toBe(true);
  });

  it("puts an unpinned profile back: its pair, as read, not the step's pinned one (Greptile, PR #200)", async () => {
    lr.lookVersion = "18.7"; // Lightroom stamps its own (issue #67): the pair goes back without it
    lr.settings["CameraProfile"] = "Adobe Standard";
    lr.settings["Look"] = { Name: "Someone's Look", UUID: "0000UNPINNED", Amount: 1, Parameters: { Version: "18.7", Vibrance: 5 } };
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    lr.ignored.add("ToneCurvePV2012");
    const e = await fails(manager.step({ session_id: ID, settings: { camera_profile: "Adobe Color", "tone_curve.master": [0, 0, 128, 160, 255, 255] }, rationale: "colour" }));
    expect(e.details).toMatchObject({ undone: true });
    expect(lr.settings).toEqual(before);
  });

  it("puts the white balance mode back after a refused step that changed the temperature (Greptile, PR #200)", async () => {
    expect(lr.settings["WhiteBalance"]).toBe("As Shot");
    await manager.begin({ intent_id: "test_plain" });
    const before = structuredClone(lr.settings);
    lr.ignored.add("ToneCurvePV2012");
    const e = await fails(manager.step({ session_id: ID, settings: { temperature: Number(before["Temperature"]) + 200, "tone_curve.master": [0, 0, 128, 160, 255, 255] }, rationale: "warmer" }));
    expect(e.details).toMatchObject({ undone: true });
    const writes = plugin.received.filter((r) => r.name === "apply_settings").map((r) => r.payload["settings"] as J);
    expect(writes.at(-2)).toMatchObject({ WhiteBalance: "Custom" });
    expect(writes.at(-1)).toMatchObject({ Temperature: before["Temperature"], WhiteBalance: "As Shot" });
    expect(lr.settings).toEqual(before);
  });
});

describe("companionsBack (params)", () => {
  const view = (companions: J): FromSdkResult => ({ companions }) as unknown as FromSdkResult;

  it("names a key the photo did not report before, which cannot be written back as absent", () => {
    const r = companionsBack(view({}), view({ WhiteBalance: "Custom" }), { temperature: 5000 });
    expect(r).toEqual({ sdk: {}, not_restored: ["WhiteBalance"] });
  });

  it("writes nothing for a group neither written back nor changed", () => {
    const same = { CameraProfile: "Camera Neutral", ConvertToGrayscale: false, WhiteBalance: "As Shot" };
    expect(companionsBack(view(same), view(same), { exposure: 0 })).toEqual({ sdk: {}, not_restored: [] });
  });
});
