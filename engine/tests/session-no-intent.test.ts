// Issue #108: the user's request comes first. lr_begin_session without an intent (pass 0 writes no profile
// or priors), with `profile` replacing the intent's (PRD FR-4.3, "unless Claude overrides"), and pass 0's
// Adobe Landscape taken when Lightroom leaves the Look's empty PointColors out of the read-back, as it did
// on _OZ80005.NEF [handle: docs\reports\phase8.5\issue108\engine-20261009-excerpt.jsonl, 2026-10-10T05:18:58Z, WRITE_NOT_TAKEN on Look].
// Against the simulated Lightroom (tests/helpers/session-harness.ts), on a raw photo and on a rendered one.

import { describe, expect, it } from "vitest";
import { PIPELINES } from "../src/params/index.js";
import { SHORT, clean, fails, intent, lr, manager, map, readLog, useSessionHarness } from "./helpers/session-harness.js";

describe.each(PIPELINES)("lr_begin_session, the user's request first (%s pipeline)", (pipeline) => {
  useSessionHarness(pipeline);
  const other = pipeline === "raw" ? "Color" : "Adobe Color"; // a profile of the other pipeline
  const override = pipeline === "raw" ? "Adobe Landscape" : "Monochrome";

  it("begins without an intent: no profile, no priors, the request kept in the log", async () => {
    clean();
    const profileBefore = map.fromSdk(lr.settings).camera_profile.name;
    const out = await manager.begin({ notes: "make it moody and cool" });
    expect(out.json).toMatchObject({ ok: true, intent: { id: "none", source: "none" }, pass0_applied: [] });
    expect(lr.snapshots.size).toBe(1);
    expect(lr.history).toEqual([]);
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe(profileBefore);
    expect(readLog()).toMatchObject({ intent: { id: "none", source: "none" }, notes: "make it moody and cool" });
  });

  it("writes `profile` at pass 0, without an intent and in place of the intent's", async () => {
    clean();
    await manager.begin({ profile: override });
    expect(lr.history).toEqual([`AVG ${SHORT} pass 0/4`]);
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe(override);
  });

  it("keeps the intent's priors when `profile` replaces its profile", async () => {
    clean();
    await manager.begin({ intent_id: "test_prior", profile: override });
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe(override);
    expect(lr.settings["Exposure2012"]).toBe(0.2);
  });

  it("leaves the colour priors out when `profile` makes a colour intent monochrome (Greptile, PR #120)", async () => {
    clean();
    intent("test_colour", { profile: { raw: "Adobe Color", rendered: "Color" }, priors: { exposure: 0.2, vibrance: 10, "hsl.orange.sat": -20 } });
    const mono = pipeline === "raw" ? "Adobe Monochrome" : "Monochrome";
    const out = await manager.begin({ intent_id: "test_colour", profile: mono });
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe(mono);
    const applied = (out.json["pass0_applied"] as Array<{ name: string }>).map((c) => c.name);
    expect(applied).toContain("exposure");
    expect(applied).not.toContain("vibrance");
    expect(applied).not.toContain("hsl.orange.sat");
  });

  it("refuses a profile of the other pipeline before the snapshot, and Variants mode without an intent", async () => {
    clean();
    expect((await fails(manager.begin({ profile: other }))).code).toBe("WRONG_PIPELINE");
    expect((await fails(manager.begin({ mode: "variants" }))).code).toBe("INVALID_ARGUMENTS");
    expect(lr.snapshots.size).toBe(0);
    expect(lr.history).toEqual([]);
  });

  it.runIf(pipeline === "raw")("takes Adobe Landscape when Lightroom leaves the Look's empty PointColors out", async () => {
    clean();
    lr.dropEmptyPointColors = true;
    const out = await manager.begin({ profile: "Adobe Landscape" });
    expect(out.json["ok"]).toBe(true);
    expect((lr.settings["Look"] as { Parameters: Record<string, unknown> }).Parameters).not.toHaveProperty("PointColors");
    expect(map.fromSdk(lr.settings).camera_profile.name).toBe("Adobe Landscape");
  });
});
