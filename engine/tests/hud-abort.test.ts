// Abort from the HUD or the menu (src/session/hud-actions.ts, io.ts checkAbort; PRD 6.3, FR-4.5,
// PHASE5_PLAN decision 3 and row 5) against the simulated Lightroom: the photo put back exactly from
// the pre-session snapshot, a running step stopped before its next write or export, the click
// answered before the revert, a failed revert and a second click, and the events that are not acted on.

import { describe, expect, it } from "vitest";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { ID, clean, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const step = (rig: ReturnType<typeof hudRig>, settings: Record<string, unknown> = { exposure: 0.1 }) =>
  rig.manager.step({ session_id: ID, settings, rationale: "test" });

/** Hold every `command` until the returned function is called (which also restores its handler). */
function hold(command: string): () => void {
  const handler = plugin.handlers.get(command);
  let release = (): void => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  plugin.handlers.set(command, async (p, id) => {
    await held;
    return handler ? handler(p, id) : "silent";
  });
  return () => {
    if (handler) plugin.handlers.set(command, handler);
    release();
  };
}

const count = (command: string): number => plugin.received.filter((r) => r.name === command).length;

describe("Abort from the HUD", () => {
  it("while Claude is thinking: answers the click, puts the photo back exactly and ends the session", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_prior" });
    await step(rig, { exposure: 0.2 });
    await hudAt("awaiting_claude");
    expect(lr.settings).not.toEqual(start);
    const click = hudEvent(plugin, "hud_abort", { session_id: ID });
    const done = await hudAt("aborted");
    expect(lr.settings).toEqual(start);
    expect(done.note).toBe("Aborted: the photo is back as it was before the session.");
    // The click was answered before the photo was put back.
    const order = plugin.received.map((r) => (r.name === "hud_update" && r.payload["answered_click_id"] === click ? "answer" : r.name));
    expect(order.indexOf("answer")).toBeGreaterThan(-1);
    expect(order.indexOf("answer")).toBeLessThan(order.indexOf("apply_snapshot"));
    expect(rig.events).toEqual([expect.objectContaining({ ok: true, name: "hud_abort", click_id: click, answered: true, note: "Abort: putting the photo back as it was before the session." })]);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "aborted", revert: { differing: [] }, ended_by: { source: "hud", click_id: click, interrupted: null, done_ms: expect.any(Number) } });
    expect(log.hud_events).toEqual([expect.objectContaining({ name: "hud_abort", source: "hud", click_id: click, note: expect.stringMatching(/^Abort: /) })]);
    // Every later call naming the session hears that the user ended it.
    const e = await fails(step(rig));
    expect(e.code).toBe("SESSION_ENDED");
    expect(e.details).toMatchObject({ session_id: ID, outcome: "aborted", source: "hud" });
    expect(e.message).toMatch(/from the HUD .* aborted it: the photo is back/);
  });

  it("during a step: stops it before its next write or export, then puts the photo back", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await hudAt("awaiting_claude");
    const release = hold("apply_settings");
    const pending = step(rig, { exposure: 0.3 });
    await waitUntil(() => plugin.received.some((r) => r.name === "apply_settings"));
    const exports = lr.exports;
    const click = hudEvent(plugin, "hud_abort", { session_id: ID });
    await waitUntil(() => rig.events.length === 1);
    expect(rig.events[0]?.note).toBe("Abort: stopping before the next write or preview, then putting the photo back.");
    release();
    const e = await fails(pending);
    expect(e.code).toBe("SESSION_ENDED");
    expect(e.details).toMatchObject({ outcome: "aborted", state: "reverting" });
    await hudAt("aborted");
    expect(lr.exports).toBe(exports); // no export after the Abort
    expect(plugin.received.filter((r) => r.name === "apply_settings")).toHaveLength(1); // only the write in flight
    expect(lr.settings).toEqual(start);
    expect(readLog()).toMatchObject({ outcome: "aborted", failures: [], ended_by: { click_id: click, interrupted: "step 1" } });
  });

  it("during a step's preview: the guardrail's correction is not written after the Abort", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await hudAt("awaiting_claude");
    const exportsBefore = count("export_preview");
    const release = hold("export_preview");
    // Exposure +1 EV clips the highlights (tonal model): without the Abort, a correction would follow.
    const pending = step(rig, { exposure: 5 });
    await waitUntil(() => count("export_preview") > exportsBefore);
    const writes = count("apply_settings");
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await waitUntil(() => rig.events.length === 1);
    release();
    expect((await fails(pending)).code).toBe("SESSION_ENDED");
    await hudAt("aborted");
    expect(count("apply_settings")).toBe(writes);
    expect(lr.settings).toEqual(start);
  });

  it("wins over Claude's accept that is still reading the photo: no recipe, the photo back", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_prior" });
    await hudAt("awaiting_claude");
    const reads = count("get_settings");
    const release = hold("get_settings");
    const accept = rig.manager.end({ session_id: ID, outcome: "accept" });
    await waitUntil(() => count("get_settings") > reads);
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await waitUntil(() => rig.events.length === 1);
    release();
    expect((await fails(accept)).code).toBe("SESSION_ENDED");
    await hudAt("aborted");
    expect(lr.settings).toEqual(start);
    expect(readLog()).toMatchObject({ outcome: "aborted", recipe_path: null, ended_by: { source: "hud", interrupted: "end (accept)" } });
  });

  it("keeps the session open when the photo cannot be put back; a second click tries again", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_prior" });
    await hudAt("awaiting_claude");
    const snapshot = plugin.handlers.get("apply_snapshot");
    plugin.handlers.set("apply_snapshot", () => ({ ok: false, error: { code: "snapshot_failed", message: "no", recoverable: true } }));
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await waitUntil(() => /^Abort could not put the photo back \(SNAPSHOT_FAILED\)/.test(String(lr.hud.last()?.note ?? "")));
    // Claude hears of the Abort: no more steps, no accept; lr_end_session "revert" stays the way out.
    const e = await fails(step(rig));
    expect([e.code, (e.details as { state: string }).state]).toEqual(["SESSION_ENDED", "revert_failed"]);
    expect(e.message).toMatch(/end the session with lr_end_session outcome "revert"/);
    expect((await fails(rig.manager.end({ session_id: ID, outcome: "accept" }))).code).toBe("SESSION_ENDED");
    if (snapshot) plugin.handlers.set("apply_snapshot", snapshot);
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await hudAt("aborted");
    expect(lr.settings).toEqual(start);
    expect(readLog()).toMatchObject({ outcome: "aborted", hud_events: [expect.anything(), expect.anything()] });
  });

  it("keeps the session open when the photo is only partly back; a second click tries again (Greptile, PR #47)", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_prior" });
    await hudAt("awaiting_claude");
    const snapshot = plugin.handlers.get("apply_snapshot");
    plugin.handlers.set("apply_snapshot", async (p, id) => {
      const reply = snapshot ? await snapshot(p, id) : "silent";
      // A setting Lightroom did not put back.
      lr.settings["Exposure2012"] = 0.77;
      if (reply !== "silent" && reply.ok) (reply.payload as { read_back: Record<string, unknown> }).read_back["Exposure2012"] = 0.77;
      return reply;
    });
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await waitUntil(() => String(lr.hud.last()?.note ?? "").startsWith("Abort left 1 setting(s) different (exposure). Click Abort again."));
    expect(rig.manager.current()?.id).toBe(ID);
    const open = readLog();
    expect(open).toMatchObject({ outcome: null, ended: null, final_settings: null, revert: { differing: ["exposure"] } });
    expect(open.ended_by).toBeUndefined();
    expect((await fails(step(rig))).details).toMatchObject({ state: "revert_failed" });
    if (snapshot) plugin.handlers.set("apply_snapshot", snapshot);
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await hudAt("aborted");
    expect(lr.settings).toEqual(start);
    expect(readLog()).toMatchObject({ outcome: "aborted", revert: { differing: [] } });
  });

  it("arriving during Claude's revert, is logged as the user's (Greptile, PR #47)", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_prior" });
    await hudAt("awaiting_claude");
    const snapshots = count("apply_snapshot");
    const release = hold("apply_snapshot");
    const revert = rig.manager.end({ session_id: ID, outcome: "revert" });
    await waitUntil(() => count("apply_snapshot") > snapshots);
    const click = hudEvent(plugin, "hud_abort", { session_id: ID });
    await waitUntil(() => rig.events.length === 1);
    release();
    expect((await revert).json).toMatchObject({ outcome: "aborted", ended_by: { source: "hud", click_id: click } });
    expect((await hudAt("aborted")).note).toBe("Aborted: the photo is back as it was before the session.");
    expect(lr.settings).toEqual(start);
    expect(count("apply_snapshot")).toBe(snapshots + 1); // the queued Abort found the session ended
    expect(readLog()).toMatchObject({ outcome: "aborted", ended_by: { source: "hud", click_id: click } });
    expect((await fails(step(rig))).code).toBe("SESSION_ENDED");
  });

  it("from the menu: logged and told as the menu's", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    hudEvent(plugin, "hud_abort", { session_id: ID, source: "menu" });
    await hudAt("aborted");
    expect(readLog().ended_by?.source).toBe("menu");
    expect((await fails(step(rig))).message).toMatch(/from Lightroom's menu/);
  });
});

describe("Events not acted on", () => {
  it("another session's event, a repeated click, a malformed event, and Approve (row 6)", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await hudAt("awaiting_claude");
    hudEvent(plugin, "hud_abort", { session_id: "another-session" });
    const click = hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 });
    hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 }, click);
    plugin.send({ id: "evt-bad", type: "evt", name: "hud_abort", payload: { session_id: ID } });
    await waitUntil(() => rig.events.length === 4);
    expect(rig.events.map((e) => [e.ok, e.note ?? e.error])).toEqual([
      [true, "That session is not open in the engine."],
      [true, "Approve is not acted on yet: this engine does not wait for an approval between passes."],
      [false, "a repeat of a click already handled"],
      [false, expect.stringMatching(/^hud_abort: .*click_id/)],
    ]);
    expect(rig.events[0]?.answered).toBe(false);
    await waitUntil(() => lr.hud.last()?.answered_click_id === click);
    expect(plugin.received.some((r) => r.name === "apply_snapshot")).toBe(false);
    expect(rig.manager.current()?.id).toBe(ID);
    expect(readLog().hud_events).toEqual([expect.objectContaining({ name: "hud_approve_pass", pass: 1 })]);
  });
});
