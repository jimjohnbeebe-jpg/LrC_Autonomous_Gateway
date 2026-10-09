// Lightroom versions (Phase 6, PR A): the supported baseline 15.0 and the newest tested 15.6
// (src/bridge/lightroom.ts), their notices in lr_get_active_photo_context, the session log and the
// HUD; an older or a newer process version; and FEATURE_UNAVAILABLE for a command an older plugin
// does not know and for a slider Lightroom no longer reports after a write (src/mcp/errors.ts),
// against the simulated Lightroom (tests/helpers/session-harness.ts).

import path from "node:path";
import { describe, expect, it } from "vitest";
import { BridgeError, HUD_LIMITS, PLUGIN_VERSION, lightroomNotices } from "../src/bridge/index.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { readbackError } from "../src/mcp/errors.js";
import { PreviewService } from "../src/preview/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig, hudWordProblems } from "./helpers/hud-harness.js";
import { nefDump } from "./helpers/lightroom-sim.js";
import { ID, clean, client, fails, lr, manager, map, plugin, readLog, tmp, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

/** Reconnect to a Lightroom that reports `version` in hello and get_context. */
async function lightroom(version: string): Promise<void> {
  client.stop();
  lr.lrcVersion = version;
  client.start();
  await client.waitConnected(2000);
}

const tools = (): Tools =>
  new Tools({ client, map, previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }), ensureBridge: () => client.waitConnected(2000).then(() => undefined), historyPrefix: "AVG test" });

/** Lightroom answers the write but leaves `key` out of its read-back, as one that no longer reports it would. */
function dropFromReadBack(key: string): void {
  const apply = plugin.handlers.get("apply_settings");
  if (!apply) throw new Error("the sim has no apply_settings");
  plugin.handlers.set("apply_settings", async (p, id) => {
    const reply = await apply(p, id);
    if (reply !== "silent" && reply.ok) delete (reply.payload as { read_back: Record<string, unknown> }).read_back[key];
    return reply;
  });
}

describe("lightroomNotices", () => {
  it("says nothing from 15.0 to 15.6, patch releases included", () => {
    for (const v of ["15.0", "15.0.1", "15.5.1", "15.6", "15.6.2", "15.6 [ 1234 ]"]) expect(lightroomNotices(v), v).toEqual([]);
  });

  it("says an older version may work but is untested, and a newer one may lack features", () => {
    for (const v of ["14.5", "14.9.9", "13.0"]) expect(lightroomNotices(v)).toEqual([`Lightroom Classic ${v.split(".").slice(0, 2).join(".")} is older than 15.0, the supported version. LrC-AVG may work but is untested.`]);
    for (const v of ["15.7", "15.10", "16.0", "16.0.1"]) expect(lightroomNotices(v)[0]).toMatch(/^Lightroom Classic \d+\.\d+ is newer than 15\.6, the newest tested\. A feature that is unavailable will say so\.$/);
  });

  it("says when the version cannot be read", () => {
    for (const v of ["garbage", "", "16", "15.6abc", undefined, 15.6]) expect(lightroomNotices(v), String(v)).toEqual(["Could not read the Lightroom Classic version. LrC-AVG supports 15.0 and later."]);
  });

  it("keeps every notice to one HUD line in the photographer's words", () => {
    for (const notice of ["14.5", "16.0", "x"].flatMap(lightroomNotices)) {
      expect(Buffer.byteLength(notice, "utf8")).toBeLessThanOrEqual(HUD_LIMITS.text);
      expect(hudWordProblems(notice)).toEqual([]);
    }
  });
});

describe("Lightroom notices in the results", () => {
  it("puts notices in lr_get_active_photo_context's lightroom block, empty within the tested versions", async () => {
    expect((await tools().getActivePhotoContext()).json["lightroom"]).toEqual({ lrc_version: "15.5.1", sdk_declared: 13, notices: [] });
    lr.lrcVersion = "14.2";
    expect((await tools().getActivePhotoContext()).json["lightroom"]).toEqual({ lrc_version: "14.2", sdk_declared: 13, notices: lightroomNotices("14.2") });
  });

  it("logs the notices and shows the HUD line once per session", async () => {
    await lightroom("16.0");
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const [notice] = lightroomNotices("16.0");
    expect(readLog().lightroom).toEqual({ lrc_version: "16.0", sdk_declared: 13, notices: [notice] });
    expect((await hudAt("awaiting_claude")).note).toBe(notice);
    await rig.manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "r" });
    await waitUntil(() => lr.hud.last()?.pass === 1 && lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()?.note).toBeUndefined();
    expect(lr.hud.taken.filter((u) => u.note === notice)).toHaveLength(1);
  });

  it("shows no HUD line and logs no notice within the tested versions", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    expect(readLog().lightroom?.notices).toEqual([]);
    expect((await hudAt("awaiting_claude")).note).toBeUndefined();
  });
});

describe("process versions", () => {
  const refusal = (pv: string): unknown => {
    try {
      map.fromSdk({ ...nefDump.settings, ProcessVersion: pv });
    } catch (err) {
      return err;
    }
    throw new Error(`process version ${pv} was accepted`);
  };

  it("calls an older one LEGACY_PROCESS_VERSION and a newer one NEWER_PROCESS_VERSION, naming Lightroom when known", () => {
    expect(toToolError(refusal("6.7")).body()).toMatchObject({ code: "LEGACY_PROCESS_VERSION", recoverable: false, message: expect.stringMatching(/update the photo's process version/) });
    const newer = toToolError(refusal("16.0"), { lrc_version: "16.1" });
    expect(newer.body()).toMatchObject({ code: "NEWER_PROCESS_VERSION", recoverable: false });
    expect(newer.message).toMatch(/^Process version 16\.0 is newer than this engine knows .*reading its context still works\. Lightroom 16\.1 is running\.$/);
    expect(toToolError(refusal("16.0")).message).not.toMatch(/is running/);
  });

  it("compares process versions by component, so 15.10 and 15.4.1 are newer than 15.4", () => {
    for (const pv of ["15.10", "15.4.1"]) expect(toToolError(refusal(pv)).body()).toMatchObject({ code: "NEWER_PROCESS_VERSION" });
    expect(toToolError(refusal("15.3")).body()).toMatchObject({ code: "LEGACY_PROCESS_VERSION" });
  });

  it("still describes the photo, with NEWER_PROCESS_VERSION as its settings_error", async () => {
    lr.lrcVersion = "16.0";
    lr.settings["ProcessVersion"] = "16.0";
    const { json } = await tools().getActivePhotoContext();
    expect(json["settings"]).toBeNull();
    expect(json["settings_error"]).toMatchObject({ code: "NEWER_PROCESS_VERSION", message: expect.stringMatching(/Lightroom 16\.0 is running\.$/) });
  });
});

describe("FEATURE_UNAVAILABLE", () => {
  it("answers a command the plugin does not know with the feature and the versions", async () => {
    const e = toToolError(new BridgeError("unknown_command", "unknown command search_photos", false, "search_photos"), { lrc_version: "15.6", plugin_version: "0.7.0" });
    expect(e.body()).toEqual({
      code: "FEATURE_UNAVAILABLE",
      recoverable: true,
      message: "search_photos is not available with Lightroom 15.6 / plugin 0.7.0; this LrC-AVG plugin does not know it. Update the plugin, then restart Lightroom so it loads it.",
      details: { feature: "search_photos", lrc_version: "15.6", plugin_version: "0.7.0" },
    });
    plugin.handlers.delete("search_photos");
    const failed = await tools().searchPhotos({ filename: "x" }).then(
      () => null,
      (err: unknown) => toToolError(err),
    );
    expect(failed?.body()).toMatchObject({ code: "FEATURE_UNAVAILABLE", details: { feature: "search_photos", lrc_version: "15.5.1", plugin_version: PLUGIN_VERSION } });
  });

  it("names a slider missing from the read-back in Lightroom's words; a different value stays WRITE_NOT_TAKEN", () => {
    const written = map.toSdk({ dehaze: 10, exposure: 0.5 }, { processVersion: "15.4", pipeline: "raw" });
    const { Dehaze: _dehaze, ...withoutDehaze } = written;
    const e = readbackError(map, written, withoutDehaze, "AVG x", { lrc_version: "16.0", plugin_version: "0.9.0" });
    expect(e?.body()).toMatchObject({ code: "FEATURE_UNAVAILABLE", recoverable: true, details: { feature: "Dehaze", lrc_version: "16.0", plugin_version: "0.9.0", history_name: "AVG x" } });
    expect(e?.message).toBe(
      'Dehaze is not available with Lightroom 16.0 / plugin 0.9.0; Lightroom did not report it back after "AVG x", so it could not be checked. Leave it out of later steps. The step\'s other values were written.',
    );
    expect(readbackError(map, written, { ...written, Dehaze: 0 }, "AVG x", null)?.code).toBe("WRITE_NOT_TAKEN");
    expect(readbackError(map, written, { Exposure2012: 0 }, "AVG x", null)?.code).toBe("WRITE_NOT_TAKEN"); // one absent, one different
    expect(readbackError(map, written, written, "AVG x", null)).toBeNull();
    const profile = readbackError(map, map.toSdk({ camera_profile: "Adobe Landscape" }, { processVersion: "15.4", pipeline: "raw" }), {}, "AVG y", null);
    expect(profile?.message).toMatch(/^Profile is not available with this Lightroom and plugin; .*Leave it out of later steps\.$/);
  });

  it("keeps the session open after a slider Lightroom no longer reports; the step's other values are written", async () => {
    clean();
    await manager.begin({ intent_id: "test_plain" });
    dropFromReadBack("Clarity2012");
    const e = await fails(manager.step({ session_id: ID, settings: { clarity: 10, shadows: 10 }, rationale: "r" }));
    expect(e.body()).toMatchObject({ code: "FEATURE_UNAVAILABLE", recoverable: true, details: { feature: "Clarity", lrc_version: "15.5.1", plugin_version: PLUGIN_VERSION, session_id: ID } });
    expect(e.message).toMatch(/^Clarity is not available with Lightroom 15\.5\.1 \/ plugin .* The step's other values were written\. \(session .* is still open/);
    expect(lr.settings["Shadows2012"]).toBe(10);
    expect(manager.current()?.id).toBe(ID);
    expect(readLog().failures.map((f) => f.error.code)).toEqual(["FEATURE_UNAVAILABLE"]);
    // The failed pass is not counted; the next one goes on from what the photo holds.
    expect((await manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" })).json).toMatchObject({ pass: "1/4", applied: [{ name: "shadows", before: 10 }] });
  });
});
