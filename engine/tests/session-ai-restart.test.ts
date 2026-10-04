// D16 (GitHub issue #59, PR C step 2d): nothing writes to the photo while Lightroom has not given an AI mask's
// result, and a Lightroom restart puts the photo back by itself (src/session/ai-update.ts settlePending,
// restart.ts, ai-revert.ts), with the plugin's own guard (plugin\LrC-AVG.lrplugin\Pending.lua, as the sim
// imitates it, helpers/lightroom-sim-masks.ts), against the Lightroom sim.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, aiWatch } from "../src/params/index.js";
import { ABORT_WAITS, engineEndedNote, type SessionManager } from "../src/session/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { restartLightroom } from "./helpers/lightroom-sim-masks.js";
import { ID, clean, client, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const FAST = { computeMs: 300, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 10_000 };
const masks = (): unknown[] => (lr.settings[MASK_TABLE_KEY] ?? []) as unknown[];
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const step = (m: SessionManager) => m.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" });
const create = (m: SessionManager, kind = "landscape_vegetation") => m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind });
let clicks = 0;
const abortClick = (m: SessionManager): string =>
  m.userAction({ name: "hud_abort", payload: { session_id: ID, seq_seen: 1, click_id: `restart-${++clicks}`, source: "hud" }, received: new Date(), t0: performance.now() });

/** A session whose AI mask got no result in time: Lightroom's record says done, the entry has no digest (LIGHTROOM_STUCK). */
async function stuckSession(timings: Record<string, number> = {}) {
  clean();
  const rig = hudRig({ aiTimings: { ...FAST, ...timings } });
  await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  const start = structuredClone(lr.settings);
  lr.masks.tableRoute = "late";
  const e = await fails(create(rig.manager));
  return { rig, start, e };
}

describe("D16: nothing written while Lightroom computes an AI mask", () => {
  it("keeps the mask pending after Lightroom's record says done: no write, revert or Abort until the entry computes, then the session goes on", async () => {
    const { rig, e } = await stuckSession();
    expect(e).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(e.message).toMatch(/the engine notices the restart, puts the photo back .* by itself; nothing to call/);
    expect(lr.masks.update?.state).toBe("done");
    const snapshots = sent("apply_snapshot");
    expect(await fails(step(rig.manager))).toMatchObject({ code: "AI_UPDATE_PENDING", recoverable: false, details: { stuck: true } });
    expect(await fails(rig.manager.end({ session_id: ID, outcome: "revert" }))).toMatchObject({ code: "AI_UPDATE_PENDING" });
    expect(abortClick(rig.manager)).toBe(ABORT_WAITS);
    await new Promise((resolve) => setTimeout(resolve, 50)); // an Abort would have been queued by now
    expect(sent("apply_snapshot")).toBe(snapshots);
    expect(rig.reported.some((r) => r.note === "Lightroom's AI mask seems stuck. Restart Lightroom: the photo is then put back by itself.")).toBe(true);
    lr.masks.finishLate(); // Lightroom finishes after all
    expect((await step(rig.manager)).json).toMatchObject({ ok: true });
    expect((await rig.manager.end({ session_id: ID, outcome: "revert" })).json).toMatchObject({ outcome: "revert", revert: { differing: [] } });
  });

  it("sends the plugin the entry to watch; the plugin then refuses a write to the photo from anyone, a restarted engine's new session too", async () => {
    await stuckSession();
    const watch = plugin.received.filter((r) => r.name === "update_ai_settings").at(-1)?.payload["watch"];
    expect(watch).toEqual({ ...aiWatch([]), ids: [expect.any(String)] });
    const other = newManager({ newId: () => "fedcba98-7654-3210-fedc-ba9876543210" }); // Claude Desktop started the engine again: it knows nothing of the mask
    expect(await fails(other.begin({ intent_id: "test_plain", return_image: "none" }))).toMatchObject({ code: "AI_COMPUTE_PENDING", recoverable: false });
    expect(lr.masks.refusedPending).toContain("create_snapshot");
  });

  it("refuses the HUD's Abort while the engine waits for Lightroom, and goes on when the mask computes", async () => {
    clean();
    const rig = hudRig({ aiTimings: { ...FAST, computeMs: 10_000 } });
    await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    lr.masks.tableRoute = "late";
    const pending = create(rig.manager);
    await waitUntil(() => sent("update_ai_settings") === 1);
    expect(abortClick(rig.manager)).toBe(ABORT_WAITS);
    lr.masks.finishLate();
    expect((await pending).json).toMatchObject({ ok: true, ai: { route: "table" } });
    expect(sent("apply_snapshot")).toBe(0);
    expect(rig.manager.current()?.id).toBe(ID);
  });
});

describe("D16: a Lightroom restart puts the photo back", () => {
  it("after LIGHTROOM_STUCK: the engine puts the photo back (checked) and ends the session; the HUD closes 10 s later; later calls get SESSION_ENDED", async () => {
    const { rig, start } = await stuckSession();
    restartLightroom(lr, plugin);
    await waitUntil(() => rig.manager.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "revert", ended_by: { source: "engine", reason: expect.stringMatching(/^Lightroom restarted while it computed the AI Vegetation mask/) }, revert: { differing: [] } });
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
    expect(await hudAt("ended")).toMatchObject({ note: engineEndedNote("Lightroom restarted"), close_after: 10 });
    expect(await fails(step(rig.manager))).toMatchObject({ code: "SESSION_ENDED", details: { ended_by: "engine" } });
  });

  it("during the wait: the bridge's drop leaves the mask pending, so the reconnect from the new Lightroom puts the photo back", async () => {
    clean();
    const rig = hudRig({ aiTimings: { ...FAST, computeMs: 10_000 } });
    await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    lr.masks.tableRoute = "never";
    const pending = fails(create(rig.manager, "sky"));
    await waitUntil(() => sent("update_ai_settings") === 1);
    restartLightroom(lr, plugin);
    const e = await pending;
    expect(e.code).toBe("BRIDGE_DISCONNECTED");
    expect(e.message).toMatch(/nothing is written until its result shows, or until Lightroom restarts/);
    await waitUntil(() => rig.manager.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "revert", ended_by: { source: "engine" }, revert: { differing: [] } });
  });

  it("a reconnect from the same Lightroom is no restart: the session stays open, the mask pending", async () => {
    const { rig } = await stuckSession();
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rig.manager.current()?.id).toBe(ID);
    expect(await fails(step(rig.manager))).toMatchObject({ code: "AI_UPDATE_PENDING" });
  });

  it("a put-back after the restart that does not go through leaves the session open for Claude's revert, and the HUD says so", async () => {
    const { rig } = await stuckSession();
    const real = plugin.handlers.get("apply_snapshot") as FakeHandler;
    plugin.handlers.set("apply_snapshot", () => ({ ok: false, error: { code: "gate_busy", message: "Lightroom's catalog stayed busy for 60 s", recoverable: true } }));
    restartLightroom(lr, plugin);
    await waitUntil(() => rig.reported.some((r) => r.note === "Lightroom restarted, but the photo could not be put back. Ask Claude to put it back."), 3000);
    expect(rig.manager.current()?.id).toBe(ID);
    expect(readLog().failures.at(-1)).toMatchObject({ stage: "revert after a Lightroom restart", error: { code: "LIGHTROOM_RESTARTED" } });
    plugin.handlers.set("apply_snapshot", real);
    expect((await rig.manager.end({ session_id: ID, outcome: "revert" })).json).toMatchObject({ outcome: "revert", revert: { differing: [] } });
  });

  it("a plugin before 0.15.0 still gets the HUD's updates, without close_after", async () => {
    const { rig } = await stuckSession();
    lr.pluginVersion = "0.14.0";
    restartLightroom(lr, plugin);
    await waitUntil(() => rig.manager.current() === null, 3000);
    const ended = await hudAt("ended");
    expect(ended.close_after).toBeUndefined();
    expect(lr.hud.refused).toEqual([]);
  });

  it("the HUD's note after an engine end names the restart or the dialog", () => {
    expect(engineEndedNote("Lightroom restarted while it computed the AI Sky mask (x)")).toBe("Lightroom restarted while it computed the mask, so the photo was put back as it was before the edit.");
    expect(engineEndedNote("Lightroom was busy or showed a dialog while it computed the AI Sky mask (x)")).toBe("Lightroom was busy or showed a dialog, so the photo was put back as it was before the edit.");
  });
});
