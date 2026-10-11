// lr_end_session "abandon" and the Abort that abandons (GitHub issue #124, src/session/abandon.ts): a session stuck on
// an AI mask ends without a Lightroom write, the plugin's guard is dropped (clear_pending_ai, plugin 0.20.0, as the sim
// imitates Pending.lua) and a new session can begin; against the Lightroom sim.

import { describe, expect, it, vi } from "vitest";
import { abandonedNote, type SessionManager } from "../src/session/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { ID, clean, client, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const FAST = { computeMs: 300, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 10_000, clearMs: 100 };
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const toPhoto = (): number => plugin.received.filter((r) => !r.name.startsWith("hud_") && r.name !== "clear_pending_ai").length;
const abandon = (m: SessionManager) => m.end({ session_id: ID, outcome: "abandon" });

/** A session whose AI mask got no result: LIGHTROOM_STUCK, or AI_MASK_FAILED with `failed`. */
async function stuck(failed = false) {
  let begun = 0; // a second session gets its own id, so its own log
  clean();
  const rig = hudRig({ aiTimings: { ...FAST, ...(failed ? { computeMs: 10_000, settleMs: 50 } : {}) }, newId: () => (begun++ === 0 ? ID : "fedcba98-7654-3210-fedc-ba9876543210") });
  await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  lr.masks.tableRoute = "late";
  const e = await fails(rig.manager.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "landscape_vegetation" }));
  expect(e.code).toBe(failed ? "AI_MASK_FAILED" : "LIGHTROOM_STUCK");
  expect(e.message).toMatch(/lr_end_session "abandon" ends the session and leaves the photo as it is\./);
  return rig;
}

describe("issue #124: lr_end_session abandon", () => {
  it("after AI_MASK_FAILED: ends the session with no read or write, drops the plugin's guard, and a new session begins", async () => {
    const rig = await stuck(true);
    expect((await fails(rig.manager.end({ session_id: ID, outcome: "revert" }))).message).toMatch(/"abandon"/);
    const before = toPhoto();
    const out = (await abandon(rig.manager)).json;
    expect(out).toMatchObject({ ok: true, outcome: "abandoned", ended_by: { source: "claude" }, ai_mask: { kind: "landscape_vegetation", state: "failed" }, lightroom_guard: "cleared" });
    expect(out["snapshot"]).toMatch(/^AVG pre-session /);
    expect(out["note"]).toMatch(/Nothing was read from or written to the photo.*Snapshots panel/);
    expect(toPhoto()).toBe(before);
    expect(sent("clear_pending_ai")).toBe(1);
    expect(lr.masks.guard.size).toBe(0);
    expect(readLog()).toMatchObject({ outcome: "abandoned", ended_by: { source: "claude" }, revert: null, recipe_path: null });
    expect(rig.manager.current()).toBeNull();
    expect(await hudAt("ended")).toMatchObject({ note: abandonedNote(false) });
    lr.masks.tableRoute = "computes";
    expect((await rig.manager.begin({ intent_id: "test_plain", return_image: "none" })).json).toMatchObject({ ok: true });
    expect(lr.masks.refusedPending).not.toContain("create_snapshot");
  });

  it("with Lightroom gone: ends the session all the same, says the guard stays, and logs why", async () => {
    const rig = await stuck();
    const state = vi.spyOn(client, "getState").mockReturnValue("connecting");
    try {
      expect((await abandon(rig.manager)).json).toMatchObject({ outcome: "abandoned", lightroom_guard: "not_cleared", note: expect.stringMatching(/refuses them until it restarts/) });
    } finally {
      state.mockRestore();
    }
    expect(sent("clear_pending_ai")).toBe(0);
    expect(readLog().failures.at(-1)).toMatchObject({ stage: "abandon (clear_pending_ai)", error: { code: "Lightroom is not connected" } });
  });

  it("with Lightroom hung, its socket open and the plugin seen as paused: gives up on clear_pending_ai at its own deadline (Greptile, PR #134)", async () => {
    const rig = await stuck();
    plugin.handlers.set("clear_pending_ai", () => "silent");
    const paused = vi.spyOn(client, "pluginPaused").mockReturnValue(true); // the bridge's own timeout would wait on
    try {
      const t0 = performance.now();
      expect((await abandon(rig.manager)).json).toMatchObject({ outcome: "abandoned", lightroom_guard: "not_cleared" });
      expect(performance.now() - t0).toBeLessThan(1000);
    } finally {
      paused.mockRestore();
    }
    expect(readLog().failures.at(-1)).toMatchObject({ stage: "abandon (clear_pending_ai)", error: { code: "BRIDGE_TIMEOUT" } });
    expect(rig.manager.current()).toBeNull();
  });

  it("with a plugin before 0.20.0: does not send clear_pending_ai and says Lightroom holds writes until it restarts", async () => {
    const rig = await stuck();
    lr.pluginVersion = "0.19.1";
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    expect((await abandon(rig.manager)).json).toMatchObject({ lightroom_guard: "plugin_too_old", note: expect.stringMatching(/before 0\.20\.0/) });
    expect(sent("clear_pending_ai")).toBe(0);
  });

  it("without an AI mask pending: ends the session as it is, with no Lightroom call", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const before = plugin.received.filter((r) => !r.name.startsWith("hud_")).length;
    const out = (await abandon(rig.manager)).json;
    expect(out).toMatchObject({ outcome: "abandoned" });
    expect(out).toMatchObject({ lightroom_guard: "none" });
    expect(out).not.toHaveProperty("ai_mask");
    expect(plugin.received.filter((r) => !r.name.startsWith("hud_")).length).toBe(before);
  });
});

describe("issue #124: the HUD's Abort while the AI mask is stuck", () => {
  it("abandons the edit: logged as the user's, the HUD told how to undo it, later calls get SESSION_ENDED", async () => {
    const rig = await stuck();
    const before = sent("apply_snapshot");
    const note = rig.manager.userAction({ name: "hud_abort", payload: { session_id: ID, seq_seen: 1, click_id: "abandon-1", source: "hud" }, received: new Date(), t0: performance.now() });
    expect(note).toMatch(/^Abort: /);
    await waitUntil(() => rig.manager.current() === null, 3000);
    expect(sent("apply_snapshot")).toBe(before);
    expect(sent("clear_pending_ai")).toBe(1);
    expect(readLog()).toMatchObject({ outcome: "abandoned", ended_by: { source: "hud", click_id: "abandon-1" } });
    expect(await hudAt("ended")).toMatchObject({ note: abandonedNote(true) });
    const later = await fails(rig.manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" }));
    expect(later).toMatchObject({ code: "SESSION_ENDED" });
    expect(later.message).toMatch(/abandoned it while Lightroom's AI mask was stuck/);
  });

  it("abandons the edit with Lightroom gone too, where the reconnect fails before any revert (Greptile, PR #134)", async () => {
    const rig = await stuck();
    const state = vi.spyOn(client, "getState").mockReturnValue("connecting");
    const wait = vi.spyOn(client, "waitConnected").mockRejectedValue(new Error("bridge is connecting"));
    try {
      rig.manager.userAction({ name: "hud_abort", payload: { session_id: ID, seq_seen: 1, click_id: "abandon-2", source: "menu" }, received: new Date(), t0: performance.now() });
      await waitUntil(() => rig.manager.current() === null, 3000);
    } finally {
      state.mockRestore();
      wait.mockRestore();
    }
    expect(readLog()).toMatchObject({ outcome: "abandoned", ended_by: { source: "menu", click_id: "abandon-2" } });
    expect(sent("clear_pending_ai")).toBe(0);
  });
});
