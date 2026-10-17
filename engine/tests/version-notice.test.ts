// Plugin and engine at one version (Phase 9, D10): the plugin's version must equal the engine's, and a
// connected plugin that differs gets an advisory notice, never a block, in lr_get_active_photo_context,
// the session log and (once, in photographer's words) the HUD. Against the simulated Lightroom
// (tests/helpers/session-harness.ts); what Lightroom shows is Jim's to observe.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUD_LIMITS, PLUGIN_VERSION, UPDATE_HUD_NOTE, lightroomNotices, pluginVersionAtLeast, updateNotices } from "../src/bridge/index.js";
import { ENGINE_VERSION, Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig, hudWordProblems } from "./helpers/hud-harness.js";
import { ID, clean, client, lr, map, readLog, tmp, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

/** Reconnect to a Lightroom whose plugin reports `pluginVersion` and whose version is `lrcVersion`. */
async function reconnect(pluginVersion: string, lrcVersion = "15.5.1"): Promise<void> {
  client.stop();
  lr.pluginVersion = pluginVersion;
  lr.lrcVersion = lrcVersion;
  client.start();
  await client.waitConnected(2000);
}

const toolsFor = (engineVersion: string): Tools =>
  new Tools({ client, map, previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }), ensureBridge: () => client.waitConnected(2000).then(() => undefined), historyPrefix: "AVG test", engineVersion });

describe("updateNotices", () => {
  it("ships the plugin and the engine at one version", () => {
    expect(PLUGIN_VERSION).toBe(ENGINE_VERSION);
    expect(updateNotices(PLUGIN_VERSION, ENGINE_VERSION)).toEqual([]);
  });

  it("says nothing when the versions are equal", () => {
    expect(updateNotices("1.0.0", "1.0.0")).toEqual([]);
  });

  it("asks for a Lightroom restart when they differ, in either direction, naming both", () => {
    expect(updateNotices("1.0.0", "1.0.1")).toEqual(["LrC-AVG was updated: restart Lightroom Classic to finish the update (plugin 1.0.0, engine 1.0.1)"]);
    expect(updateNotices("1.1.0", "1.0.9")).toEqual(["LrC-AVG was updated: restart Lightroom Classic to finish the update (plugin 1.1.0, engine 1.0.9)"]);
  });

  it("has nothing to compare for a version that is not major.minor.patch (a test or development engine)", () => {
    for (const [plugin, engine] of [["1.0.0", "test"], ["1.0.0", "unknown"], ["1.0.0", undefined], [undefined, "1.0.0"], ["1.0", "1.0.0"], ["1.0.0", "1.0.0-rc.1"], [100, "1.0.0"]]) {
      expect(updateNotices(plugin, engine), `${String(plugin)} / ${String(engine)}`).toEqual([]);
    }
  });

  it("keeps the minimum-version checks as they were: a difference is not a block", () => {
    expect(pluginVersionAtLeast("1.0.0", "0.23.0")).toBe(true);
    expect(pluginVersionAtLeast("0.23.0", "0.23.0")).toBe(true);
  });

  it("gives the HUD a line in photographer's words that fits one HUD note", () => {
    expect(hudWordProblems(UPDATE_HUD_NOTE)).toEqual([]);
    expect(Buffer.byteLength(UPDATE_HUD_NOTE, "utf8")).toBeLessThanOrEqual(HUD_LIMITS.text);
    expect(UPDATE_HUD_NOTE).toMatch(/restart Lightroom Classic/);
  });
});

describe("the notice in the results", () => {
  it("puts nothing extra in lr_get_active_photo_context's notices when plugin and engine match", async () => {
    const { json } = await toolsFor(PLUGIN_VERSION).getActivePhotoContext();
    expect(json["lightroom"]).toEqual({ lrc_version: "15.5.1", sdk_declared: 13, notices: [] });
  });

  it("adds the update notice to lr_get_active_photo_context's lightroom.notices when the engine is another version", async () => {
    const { json } = await toolsFor("1.0.1").getActivePhotoContext();
    expect(json["lightroom"]).toEqual({ lrc_version: "15.5.1", sdk_declared: 13, notices: updateNotices(PLUGIN_VERSION, "1.0.1") });
    expect(json["ok"]).toBe(true);
  });

  it("names an older plugin that Lightroom still runs, after the Lightroom version's own notice", async () => {
    await reconnect("0.23.0", "16.0");
    const { json } = await toolsFor("1.0.0").getActivePhotoContext();
    expect(json["lightroom"]).toMatchObject({ notices: [...lightroomNotices("16.0"), "LrC-AVG was updated: restart Lightroom Classic to finish the update (plugin 0.23.0, engine 1.0.0)"] });
  });

  it("logs the notice and shows the HUD line once per session", async () => {
    clean();
    const rig = hudRig({ engineVersion: "1.0.1" });
    await rig.manager.begin({ intent_id: "test_plain" });
    expect(readLog().lightroom?.notices).toEqual(updateNotices(PLUGIN_VERSION, "1.0.1"));
    expect((await hudAt("awaiting_claude")).note).toBe(UPDATE_HUD_NOTE);
    await rig.manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "r" });
    await waitUntil(() => lr.hud.last()?.pass === 1 && lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()?.note).toBeUndefined();
    expect(lr.hud.taken.filter((u) => u.note === UPDATE_HUD_NOTE)).toHaveLength(1);
  });

  it("shows the update line before an untested-Lightroom line, and logs both", async () => {
    await reconnect(PLUGIN_VERSION, "16.0");
    clean();
    const rig = hudRig({ engineVersion: "1.0.1" });
    await rig.manager.begin({ intent_id: "test_plain" });
    expect(readLog().lightroom?.notices).toEqual([...lightroomNotices("16.0"), ...updateNotices(PLUGIN_VERSION, "1.0.1")]);
    expect((await hudAt("awaiting_claude")).note).toBe(UPDATE_HUD_NOTE);
  });

  it("shows no HUD line and logs no notice when plugin and engine match", async () => {
    clean();
    const rig = hudRig({ engineVersion: PLUGIN_VERSION });
    await rig.manager.begin({ intent_id: "test_plain" });
    expect(readLog().lightroom?.notices).toEqual([]);
    expect((await hudAt("awaiting_claude")).note).toBeUndefined();
  });
});
