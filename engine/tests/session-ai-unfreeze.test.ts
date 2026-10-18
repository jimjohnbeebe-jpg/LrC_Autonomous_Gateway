// GitHub issue #181: an AI mask whose Lightroom update stayed in the write gate past the engine's wait (LIGHTROOM_STUCK) frees
// the session by itself once Lightroom lets go, with no restart (src/session/ai-update.ts settlePending); the Deck's Abort then
// puts the photo back, and while the gate stays held it abandons the edit and says the photo was NOT put back
// (src/session/abandon.ts). Against the Lightroom sim (helpers/lightroom-sim-masks.ts): "dialog" holds the gate with the update
// "running" for `heldProbes` probes; `release()` is Lightroom finishing, and the update's record then says done.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY } from "../src/params/index.js";
import { abandonedNote, type Session, type SessionManager } from "../src/session/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { ID, clean, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const FAST = { computeMs: 300, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 10_000, settleMs: 50, clearMs: 100 };
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const masks = (): unknown[] => (lr.settings[MASK_TABLE_KEY] ?? []) as unknown[];
const step = (m: SessionManager) => m.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" });
let clicks = 0;
const abortClick = (m: SessionManager): string =>
  m.userAction({ name: "hud_abort", payload: { session_id: ID, seq_seen: 1, click_id: `unfreeze-${++clicks}`, source: "hud" }, received: new Date(), t0: performance.now() });

/** A session stuck on a Water mask: Lightroom's update still runs, holding the gate (`slow`: the mask computes when it ends). */
async function stuck(slow = false) {
  clean();
  const rig = hudRig({ aiTimings: FAST });
  await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  const start = structuredClone(lr.settings);
  [lr.masks.gate, lr.masks.heldProbes] = [slow ? "slow" : "dialog", 1_000_000];
  const e = await fails(rig.manager.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "landscape_water" }));
  expect(e).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
  return { rig, m: rig.manager, start, e };
}

/** Lightroom's update ends: its record says done and the gate is free. */
function lightroomEnds(): void {
  lr.masks.release();
  lr.masks.held = 0;
}

describe("issue #181: a stuck AI mask frees the session when Lightroom lets go", () => {
  it("while the update still runs: every write, render and revert is refused, the plugin's guard stays", async () => {
    const { m } = await stuck();
    const writes = sent("apply_settings");
    expect(await fails(step(m))).toMatchObject({ code: "AI_UPDATE_PENDING", details: { stuck: true } });
    expect(await fails(m.end({ session_id: ID, outcome: "revert" }))).toMatchObject({ code: "AI_UPDATE_PENDING" });
    expect(sent("apply_settings")).toBe(writes);
    expect(sent("clear_pending_ai")).toBe(0);
  });

  it("an update that ends with the result: the session goes on, with no notice", async () => {
    const { m } = await stuck(true);
    lightroomEnds();
    const out = (await step(m)).json;
    expect(out).toMatchObject({ ok: true });
    expect(out).not.toHaveProperty("hud_actions");
    expect(sent("clear_pending_ai")).toBe(0);
  });

  it("an update that ends with no result: the guard is dropped, the next call writes, and its result says the mask failed and how to put the photo back", async () => {
    const { m } = await stuck();
    lightroomEnds();
    const out = (await step(m)).json;
    expect(out).toMatchObject({ ok: true });
    expect(sent("clear_pending_ai")).toBe(1);
    const note = (out["hud_actions"] as Array<{ action: string; note: string }>)[0];
    expect(note?.action).toBe("ai_mask_failed");
    expect(note?.note).toMatch(/^Lightroom's AI Water mask \(asked for at .*\) did not finish/);
    expect(note?.note).toMatch(/writes, renders and reverts work/);
    expect(note?.note).toMatch(/lr_end_session with outcome "revert" \(snapshot "AVG pre-session .*"\)/);
    expect(note?.note).toMatch(/prefer linear or radial masks/);
    expect(readLog().failures.at(-1)).toMatchObject({ stage: "ai mask (Lightroom's update ended with no result)", error: { code: "AI_MASK_NO_RESULT", recoverable: true } });
    expect((await step(m)).json).not.toHaveProperty("hud_actions"); // told once; the session is free
  });

  it("a revert once the gate is free puts the photo back to the pre-session snapshot, with no restart of Lightroom", async () => {
    const { m, start } = await stuck();
    const process = lr.processStartedAt;
    expect(await fails(m.end({ session_id: ID, outcome: "revert" }))).toMatchObject({ code: "AI_UPDATE_PENDING" });
    lightroomEnds();
    const out = (await m.end({ session_id: ID, outcome: "revert" })).json;
    expect(out).toMatchObject({ ok: true, outcome: "revert", revert: { differing: [] } });
    expect(sent("apply_snapshot")).toBe(1);
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
    expect(lr.settings["Exposure2012"]).toBe(start["Exposure2012"]);
    expect(lr.processStartedAt).toBe(process);
    expect(m.current()).toBeNull();
  });

  it("the Deck's Abort once the gate is free puts the photo back; it does not abandon the edit", async () => {
    const { rig, start } = await stuck();
    lightroomEnds();
    expect(abortClick(rig.manager)).toMatch(/^Abort: /);
    await waitUntil(() => rig.manager.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "aborted", revert: { differing: [] } });
    expect(sent("apply_snapshot")).toBe(1);
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
    expect((await hudAt("aborted")).note).toBe("Aborted: the photo is back as it was before the edit.");
  });

  it("does not free the session when the plugin's guard cannot be dropped: it stays refused, and goes on once it can", async () => {
    const { m } = await stuck();
    lightroomEnds();
    const real = plugin.handlers.get("clear_pending_ai");
    plugin.handlers.set("clear_pending_ai", () => "silent");
    expect(await fails(step(m))).toMatchObject({ code: "AI_UPDATE_PENDING", details: { stuck: true } });
    expect(readLog().failures.at(-1)?.stage).not.toBe("ai mask (Lightroom's update ended with no result)");
    plugin.handlers.set("clear_pending_ai", real ?? (() => "silent"));
    expect((await step(m)).json).toMatchObject({ ok: true });
  });

  it("does not free the session when the plugin has no probe, or the update record is another request's", async () => {
    const { m } = await stuck();
    lightroomEnds();
    lr.masks.probe = "unknown";
    expect(await fails(step(m))).toMatchObject({ code: "AI_UPDATE_PENDING" });
    lr.masks.probe = "known";
    lr.masks.update = lr.masks.update && { ...lr.masks.update, request_id: "another-request" };
    expect(await fails(step(m))).toMatchObject({ code: "AI_UPDATE_PENDING" });
    expect(sent("clear_pending_ai")).toBe(0);
  });
});

describe("issue #181: the Abort while the gate is still held", () => {
  it("abandons the edit and says the photo was NOT put back, with the snapshot that does, and leaves the photo as it was", async () => {
    const { m } = await stuck();
    const before = structuredClone(lr.settings);
    const snapshots = sent("apply_snapshot");
    const out = (await m.end({ session_id: ID, outcome: "abandon" })).json;
    expect(out).toMatchObject({ ok: true, outcome: "abandoned", photo_put_back: false, lightroom_guard: "cleared", ai_mask: { kind: "landscape_water", state: "stuck" } });
    expect(out["note"]).toMatch(/^The photo was NOT put back\. Nothing was read from or written to the photo: it keeps what the session did\. The AI mask's entry stays/);
    expect(out["note"]).toContain(`the snapshot "${String(out["snapshot"])}"`);
    expect(lr.settings).toEqual(before);
    expect(masks()).toHaveLength(1); // the AI mask's entry, still without a result
    expect(sent("apply_snapshot")).toBe(snapshots);
  });

  it("the Deck's Abort: the HUD says the photo was not put back and names the snapshot; the next call is told the same", async () => {
    const { rig } = await stuck();
    const snapshot = readLog().snapshot.name;
    abortClick(rig.manager);
    await waitUntil(() => rig.manager.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "abandoned" });
    const note = (await hudAt("ended")).note;
    expect(note).toBe(`Photo not put back (AI mask stuck). To undo: Develop > Snapshots > "${snapshot}".`);
    expect(note).toBe(abandonedNote({ snapshot: { name: snapshot } } as Session, true));
    expect(Buffer.byteLength(String(note))).toBeLessThanOrEqual(120);
    const later = await fails(step(rig.manager));
    expect(later).toMatchObject({ code: "SESSION_ENDED", details: { outcome: "abandoned", snapshot } });
    expect(later.message).toContain(`the snapshot "${snapshot}" puts it back`);
  });
});
