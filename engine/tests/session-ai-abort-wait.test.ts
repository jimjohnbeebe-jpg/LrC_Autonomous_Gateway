// GitHub issue #181, decision 2 [stated: Jim, 2026-10-18, "Abort ends the wait now"]: the Deck's Abort during the engine's
// wait for an AI mask (src/session/ai-update.ts watch) ends the wait at its next read; the Abort's revert then goes ahead if
// Lightroom's result has shown, else the edit is abandoned (src/session/hud-actions.ts finishAbort, abandon.ts): nothing
// written, the photo NOT put back, the pre-session snapshot named, and the plugin's guard kept while Lightroom likely still
// computes (D16; the review of #181); a Lightroom restart under the wait puts the photo back instead (restart.ts). The pending lr_create_mask fails with SESSION_ENDED, not
// LIGHTROOM_STUCK. Races: Abort before the update is sent, during the wait, after the result arrived, and pressed twice.
// Against the Lightroom sim (helpers/lightroom-sim-masks.ts): gate "slow" holds the gate with the update "running" for
// `heldProbes` probes, and `release()` computes the mask.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY } from "../src/params/index.js";
import { ABORT_AI, abandonedNote, type Session, type SessionManager } from "../src/session/index.js";
import { FINISHING_NOTE } from "../src/session/abandon.js";
import { waitUntil, type FakeHandler } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { restartLightroom } from "./helpers/lightroom-sim-masks.js";
import { ID, clean, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

/** Lightroom's real poll (250 ms doubling to 1 s), so the test also times how soon the wait ends. */
const T = { computeMs: 60_000, dcWaitMs: 300, pollMs: 250, pollMaxMs: 1000, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 60_000, clearMs: 100 };
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const masks = (): unknown[] => (lr.settings[MASK_TABLE_KEY] ?? []) as unknown[];
const step = (m: SessionManager) => m.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" });
let clicks = 0;
const abortClick = (m: SessionManager): string =>
  m.userAction({ name: "hud_abort", payload: { session_id: ID, seq_seen: 1, click_id: `abort-wait-${++clicks}`, source: "hud" }, received: new Date(), t0: performance.now() });

/** A session waiting for an AI Water mask: Lightroom's update runs and holds the gate (the mask computes on release()). */
async function waiting() {
  clean();
  const rig = hudRig({ aiTimings: T });
  await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  const start = structuredClone(lr.settings);
  [lr.masks.gate, lr.masks.heldProbes] = ["slow", 1_000_000];
  const pending = rig.manager.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "landscape_water" });
  pending.catch(() => undefined); // awaited by each test
  await waitUntil(() => sent("probe_write_gate") > 0, 3000); // the wait is under way, the gate read held
  return { rig, m: rig.manager, start, pending };
}

describe("issue #181: Abort during the AI mask's wait", () => {
  it("ends the wait within about a second (Lightroom answering reads) and abandons the edit: nothing written, the photo NOT put back, the guard kept, the trace logged", async () => {
    const { m, pending } = await waiting();
    const snapshot = readLog().snapshot.name;
    const [writes, snapshots] = [sent("apply_settings"), sent("apply_snapshot")];
    const t0 = performance.now();
    expect(abortClick(m)).toBe(ABORT_AI);
    const e = await fails(pending);
    expect(performance.now() - t0).toBeLessThan(1500); // the next read, at most pollMaxMs (1 s) later [the read in flight in the sim is ~0 ms]
    expect(e).toMatchObject({ code: "SESSION_ENDED", details: { outcome: "aborted", state: "ending", snapshot, ai_mask: { kind: "landscape_water" } } });
    expect(e.message).toContain("Lightroom's AI Water mask had no result, so the wait for it ended. The session ends now");
    expect(e.message).toContain(`otherwise it is NOT put back, it keeps the session's edits, and the snapshot "${snapshot}" puts it back (Develop > Snapshots) once the mask's shape shows in Lightroom`);
    await waitUntil(() => m.current() === null, 3000);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "abandoned", ended_by: { source: "hud" }, revert: null });
    const trace = log.failures.find((f) => f.stage === "ai mask (wait ended by the user's Abort)");
    expect(trace).toMatchObject({ error: { code: "SESSION_ENDED" }, ai_trace: { kind: "landscape_water", sent: expect.any(String) } });
    expect([sent("apply_settings"), sent("apply_snapshot"), sent("clear_pending_ai")]).toEqual([writes, snapshots, 0]); // the guard kept
    expect(lr.masks.guard.size).toBe(1);
    expect(masks()).toHaveLength(1); // the AI mask's entry, still without a result
    expect((await hudAt("ended")).note).toBe(FINISHING_NOTE);
    expect(abandonedNote({ snapshot: { name: snapshot } } as Session, true, true)).toBe(FINISHING_NOTE);
    expect(Buffer.byteLength(FINISHING_NOTE)).toBeLessThanOrEqual(120);
    const later = await fails(step(m));
    expect(later).toMatchObject({ code: "SESSION_ENDED", details: { outcome: "abandoned", snapshot, ai_finishing: true } });
    expect(later.message).toContain("Lightroom is still finishing the AI mask: tell the user to wait until its shape shows in Lightroom before clicking the snapshot");
  });

  it("pressed twice: the second click says it is under way, one abandon, no clear_pending_ai (the guard kept); a click after the end says the photo was left", async () => {
    const { m, pending } = await waiting();
    expect(abortClick(m)).toBe(ABORT_AI);
    expect(abortClick(m)).toBe("Abort is already under way.");
    expect(await fails(pending)).toMatchObject({ code: "SESSION_ENDED" });
    await waitUntil(() => m.current() === null, 3000);
    expect(sent("clear_pending_ai")).toBe(0);
    expect(readLog().outcome).toBe("abandoned");
    expect(abortClick(m)).toBe("This edit had already ended: the photo was left as it was.");
  });

  it("the result shows right after the Abort: the revert goes ahead and puts the photo back (aborted, not abandoned)", async () => {
    const { m, start, pending } = await waiting();
    expect(abortClick(m)).toBe(ABORT_AI);
    lr.masks.release(); // Lightroom finishes before the Abort's revert reads the table
    lr.masks.held = 0;
    expect(await fails(pending)).toMatchObject({ code: "SESSION_ENDED" });
    await waitUntil(() => m.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "aborted", revert: { differing: [] } });
    expect([sent("apply_snapshot"), sent("clear_pending_ai")]).toEqual([1, 0]);
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
    expect((await hudAt("aborted")).note).toBe("Aborted: the photo is back as it was before the edit.");
  });

  it("the result arrived before the Abort but the call has not returned: the call stops before its next write or render, and the photo is put back", async () => {
    const { m, start, pending } = await waiting();
    const read = plugin.handlers.get("get_settings") as FakeHandler;
    let clicked = "";
    plugin.handlers.set("get_settings", async (p, id) => {
      const reply = await read(p, id);
      if (lr.masks.held === 0 && !clicked) clicked = abortClick(m); // the read that shows the result is on its way back
      return reply;
    });
    lr.masks.release();
    lr.masks.held = 0;
    const e = await fails(pending);
    expect(clicked).toBe(ABORT_AI); // the engine had not seen the result yet
    expect(e).toMatchObject({ code: "SESSION_ENDED", details: { state: "reverting" } }); // the result came: the photo goes back
    await waitUntil(() => m.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "aborted", revert: { differing: [] } });
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
    plugin.handlers.set("get_settings", read);
  });

  it("Abort before the update request is sent: no update goes out, and the photo is put back", async () => {
    clean();
    const rig = hudRig({ aiTimings: T });
    await rig.manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const start = structuredClone(lr.settings);
    const write = plugin.handlers.get("apply_settings") as FakeHandler;
    let note = "";
    plugin.handlers.set("apply_settings", async (p, id) => {
      if (!note) note = abortClick(rig.manager); // during the write of the mask's entry, before update_ai_settings
      return write(p, id);
    });
    const e = await fails(rig.manager.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "landscape_water" }));
    plugin.handlers.set("apply_settings", write);
    expect(note).toBe("Abort: stopping before the next change or preview, then putting the photo back.");
    expect(e).toMatchObject({ code: "SESSION_ENDED", details: { state: "reverting" } });
    expect(sent("update_ai_settings")).toBe(0);
    await waitUntil(() => rig.manager.current() === null, 3000);
    expect(readLog()).toMatchObject({ outcome: "aborted", revert: { differing: [] } });
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
  });

  it("Lightroom restarting under the wait (the bridge dropped), then Abort: the photo is put back as after a restart, not abandoned", async () => {
    const { m, start, pending } = await waiting();
    restartLightroom(lr, plugin); // the user restarts a Lightroom that seemed hung: the bridge drops, the wait ends
    expect(abortClick(m)).toBe(ABORT_AI); // before the new Lightroom connects: the Abort's revert runs before the restart's
    expect(await fails(pending)).toMatchObject({ code: "SESSION_ENDED" });
    await waitUntil(() => m.current() === null, 5000);
    expect(readLog()).toMatchObject({ revert: { differing: [] }, ended_by: { source: "engine", reason: expect.stringMatching(/^Lightroom restarted/) } });
    expect(readLog().outcome).not.toBe("abandoned");
    expect(masks()).toEqual(start[MASK_TABLE_KEY] ?? []);
  });

  it("Lightroom restarting under the wait, then Abort whose put-back fails: the Deck says so and the edit stays open for a second click (Greptile, PR #183)", async () => {
    const { m, pending } = await waiting();
    plugin.handlers.set("apply_snapshot", () => ({ ok: false, error: { code: "snapshot_failed", message: "test: the snapshot did not apply", recoverable: true } }));
    restartLightroom(lr, plugin);
    expect(abortClick(m)).toBe(ABORT_AI);
    expect(await fails(pending)).toMatchObject({ code: "SESSION_ENDED" });
    await waitUntil(() => String(lr.hud.last()?.note ?? "").startsWith("Lightroom restarted, but Abort could not put the photo back"), 5000);
    expect(lr.hud.last()).toMatchObject({ stage: "awaiting_claude", note: "Lightroom restarted, but Abort could not put the photo back. Click Abort again." });
    expect(m.current()).not.toBeNull(); // not abandoned: a second click tries again
  });
});
