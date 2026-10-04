// A block Lightroom adds inside the profile's Look is its own, not a failed put-back (#67, capture 5): after Jim
// worked in Develop, LrC 15.6 added a default Look.Parameters.LensBlur that the pre-session snapshot does not
// remove [stated: the lead, from capture 5's rowA_put_back and a read-back, 2026-10-04]. The engine compares
// the photo as its canonical settings (params\map.ts fromSdk), which take the Look only as the camera profile's
// name and UUID, so every revert, auto-revert and HUD put-back below reads as back (differing []), against the
// simulated Lightroom stamping the block on every snapshot apply (helpers/lightroom-sim.ts lensBlurStamp).

import { describe, expect, it } from "vitest";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

/** The Adobe Color Look as LrC 15.6 carries it on a raw photo (UUID and parameters as in camera-profiles.lrc15.json's pair), without LensBlur. */
function withProfileLook(): void {
  clean();
  lr.settings["Look"] = { UUID: "B952C231111CD8E0ECCF14B86BAA7077", Name: "Adobe Color", Amount: 1, Parameters: { Version: "18.7", ProcessVersion: "15.4", ConvertToGrayscale: false } };
  lr.lensBlurStamp = true;
}
const lensBlur = (): unknown => (lr.settings["Look"] as { Parameters: Record<string, unknown> }).Parameters["LensBlur"];

describe("a block Lightroom adds inside the Look", () => {
  it("lr_end_session revert of the open session: differing [] although the snapshot left LensBlur", async () => {
    withProfileLook();
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none" });
    await m.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" });
    expect((await m.end({ session_id: ID, outcome: "revert" })).json).toMatchObject({ outcome: "revert", revert: { differing: [] } });
    expect(lensBlur()).toMatchObject({ Active: false });
  });

  it("the auto-revert after Lightroom's dialog is verified as back", async () => {
    withProfileLook();
    const m = newManager({ aiTimings: { computeMs: 2000, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, graceMs: 40 } });
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    [lr.masks.gate, lr.masks.heldProbes] = ["dialog", 4];
    expect(await fails(m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "sky" }))).toMatchObject({ code: "LIGHTROOM_DIALOG", details: { reverted: true } });
    expect(readLog()).toMatchObject({ outcome: "revert", revert: { differing: [] } });
    expect(lensBlur()).toBeDefined();
  });

  it("the HUD's Put back, reported, reads as back", async () => {
    withProfileLook();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await rig.manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test" });
    const start = structuredClone(lr.snapshots.get("SNAP-1") ?? {});
    Object.assign(lr.settings, start); // the plugin applied the snapshot itself, and Lightroom stamped the Look
    (lr.settings["Look"] as { Parameters: Record<string, unknown> }).Parameters["LensBlur"] = { Active: false, BlurAmount: 50, Version: 1 };
    hudEvent(plugin, "hud_put_back", { session_id: ID, outcome: "done" });
    await hudAt("ended");
    await waitUntil(() => rig.manager.current() === null);
    expect(readLog()).toMatchObject({ outcome: "revert", revert: { differing: [] } });
  });
});
