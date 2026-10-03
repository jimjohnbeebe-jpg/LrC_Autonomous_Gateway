// approve_each_pass with the HUD (src/session/approval.ts, hud-actions.ts, hud/payload.ts; PRD 6.3,
// PHASE5_PLAN decision 4 and row 6) against the simulated Lightroom and its HUD: Approve is offered
// once a pass is shown, a click releases a waiting step or approves ahead of Claude's call, the
// user's Abort and Accept end a wait at once (PHASE5_PLAN "From row 5"), and stale clicks change
// nothing.

import { describe, expect, it } from "vitest";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig, type HudRig } from "./helpers/hud-harness.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { ID, clean, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const approveMode = (): void => {
  lr.prefs = { ...defaultSimPrefs(), mode: "approve_each_pass" };
};
const step = (rig: HudRig, settings: Record<string, unknown> = { exposure: 0.2 }) => rig.manager.step({ session_id: ID, settings, rationale: "test" });
const count = (command: string): number => plugin.received.filter((r) => r.name === command).length;
const note = (): string => String(lr.hud.last()?.note ?? "");
/** A step waiting for the approval of pass 1: the HUD says so. */
const waitingFor = (pass: number) => waitUntil(() => lr.hud.last()?.stage === "awaiting_approval" && note().startsWith(`Claude's pass ${pass + 1} waits`));

/** A session in approve_each_pass mode with pass 1 made; the HUD offers Approve pass 1. */
async function afterPass1(waitMs: number): Promise<HudRig> {
  clean();
  approveMode();
  const rig = hudRig({ approvalWaitMs: waitMs });
  await rig.manager.begin({ intent_id: "test_plain", return_image: "none" });
  await hudAt("awaiting_claude");
  expect(lr.hud.last()?.approve_pass).toBeUndefined(); // pass 0: nothing to approve
  await step(rig);
  await hudAt("awaiting_approval");
  return rig;
}

describe("approve_each_pass: the HUD's Approve", () => {
  it("is offered once a pass is shown, and a step waiting for it goes ahead on the click", async () => {
    const rig = await afterPass1(20000);
    expect(lr.hud.last()).toMatchObject({ pass: 1, approve_pass: 1, note: "Approve pass 1 to let Claude make the next pass, or tell Claude in chat." });
    const waiting = step(rig, { exposure: -0.1 });
    await waitingFor(1);
    expect(lr.hud.last()).toMatchObject({ pass: 1, approve_pass: 1 });
    const click = hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 });
    const out = await waiting;
    expect(out.json).toMatchObject({ pass: "2/4", approval: { pass: 1, by: "hud" } });
    expect(rig.events).toEqual([expect.objectContaining({ ok: true, name: "hud_approve_pass", click_id: click, answered: true, note: "Approved pass 1: Claude's next pass goes ahead." })]);
    await waitUntil(() => lr.hud.last()?.approve_pass === 2);
    expect(lr.hud.last()).toMatchObject({ stage: "awaiting_approval", pass: 2 });
    const log = readLog();
    expect(log.approvals).toEqual([{ at: expect.any(String), target: "master", pass: 1, by: "hud" }]);
    expect(log.hud_events).toEqual([expect.objectContaining({ name: "hud_approve_pass", pass: 1, note: "Approved pass 1: Claude's next pass goes ahead." })]);
  });

  it("before Claude's next call: the HUD goes to awaiting Claude, and the next step does not wait", async () => {
    const rig = await afterPass1(20000);
    const click = hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 });
    await waitUntil(() => lr.hud.last()?.answered_click_id === click);
    expect(lr.hud.last()).toMatchObject({ stage: "awaiting_claude", note: "Approved pass 1: Claude goes on at its next call." });
    expect(lr.hud.last()?.approve_pass).toBeUndefined();
    const out = await step(rig, { exposure: -0.1 });
    expect(out.json).toMatchObject({ pass: "2/4", approval: { pass: 1, by: "hud", waited_ms: 0 } });
  });

  it("lr_approve_pass while Claude is between calls updates the HUD", async () => {
    const rig = await afterPass1(20000);
    await rig.manager.approvePass({ session_id: ID, confirmed: true });
    await waitUntil(() => lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()).toMatchObject({ note: "Pass 1 approved in chat: Claude goes on at its next call." });
    expect(lr.hud.last()?.approve_pass).toBeUndefined();
  });

  it("stale and repeated clicks change nothing", async () => {
    clean();
    approveMode();
    const rig = hudRig({ approvalWaitMs: 20000 });
    await rig.manager.begin({ intent_id: "test_plain", return_image: "none" });
    await hudAt("awaiting_claude");
    hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 });
    await waitUntil(() => rig.events.length === 1);
    await step(rig);
    await hudAt("awaiting_approval");
    hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 2 });
    hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 });
    hudEvent(plugin, "hud_approve_pass", { session_id: ID, pass: 1 });
    await waitUntil(() => rig.events.length === 4);
    expect(rig.events.map((e) => e.note)).toEqual([
      "No pass is waiting for approval.",
      "Pass 2 is not the one waiting for approval; pass 1 is.",
      "Approved pass 1: Claude goes on at its next call.",
      "Pass 1 is approved already.",
    ]);
    expect(readLog().approvals?.length).toBe(1);
  });

  it("after a wait in vain, the HUD still offers Approve", async () => {
    const rig = await afterPass1(150);
    expect((await fails(step(rig, { exposure: -0.1 }))).code).toBe("AWAITING_APPROVAL");
    await waitUntil(() => lr.hud.last()?.stage === "awaiting_approval" && note().startsWith("Approve pass 1"));
    expect(lr.hud.last()).toMatchObject({ pass: 1, approve_pass: 1 });
  });

  it("autonomous mode offers no Approve", async () => {
    clean();
    const rig = hudRig({ approvalWaitMs: 20000 });
    await rig.manager.begin({ intent_id: "test_plain", return_image: "none" });
    await step(rig);
    await hudAt("awaiting_claude");
    expect(lr.hud.last()?.approve_pass).toBeUndefined();
    expect(lr.hud.taken.some((u) => u.approve_pass !== undefined || u.stage === "awaiting_approval")).toBe(false);
  });
});

describe("approve_each_pass: Abort and Accept while a step waits", () => {
  it("Abort ends the wait at once and puts the photo back", async () => {
    clean();
    const start = structuredClone(lr.settings);
    const rig = await afterPass1(30000);
    const applies = count("apply_settings");
    const waiting = step(rig, { exposure: -0.1 });
    await waitingFor(1);
    const clicked = performance.now();
    const click = hudEvent(plugin, "hud_abort", { session_id: ID });
    const e = await fails(waiting);
    expect(performance.now() - clicked).toBeLessThan(2000);
    expect(e).toMatchObject({ code: "SESSION_ENDED", details: { outcome: "aborted", source: "hud" } });
    await hudAt("aborted");
    expect(lr.settings).toEqual(start);
    expect(count("apply_settings")).toBe(applies); // nothing of pass 2 was written
    expect(readLog()).toMatchObject({ outcome: "aborted", ended_by: { source: "hud", click_id: click, interrupted: "step 2 (waiting for approval)" } });
  });

  it("Accept ends the wait at once, writes nothing more and keeps the edit", async () => {
    const rig = await afterPass1(30000);
    const applies = count("apply_settings");
    const waiting = step(rig, { exposure: -0.1 });
    await waitingFor(1);
    const clicked = performance.now();
    hudEvent(plugin, "hud_accept", { session_id: ID });
    const e = await fails(waiting);
    expect(performance.now() - clicked).toBeLessThan(2000);
    expect(e).toMatchObject({ code: "AWAITING_APPROVAL", recoverable: false, message: expect.stringMatching(/clicked Accept .*nothing was written/) });
    await hudAt("accepted");
    expect(count("apply_settings")).toBe(applies);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "accept", ended_by: { source: "hud" } });
    expect(log.passes.map((p) => p.n)).toEqual([0, 1]);
  });

  // Greptile, PR #48: the client handles every line of a read before the woken step resumes [handle:
  // engine\src\bridge\client.ts onData, the `for (const line of lines)` loop]; either order of the
  // two clicks must end the wait with nothing written.
  it.each([
    ["Accept then Approve", ["hud_accept", "hud_approve_pass"], "Accept came first: the edit is being kept, and no further pass is made."],
    ["Approve then Accept", ["hud_approve_pass", "hud_accept"], "Approved pass 1: Claude's next pass goes ahead."],
  ])("%s in one bridge read: Accept ends the wait, and nothing more is written", async (_order, names, approveNote) => {
    const rig = await afterPass1(30000);
    const applies = count("apply_settings");
    const waiting = step(rig, { exposure: -0.1 });
    await waitingFor(1);
    const evt = (name: string) =>
      JSON.stringify({ id: `evt-batch-${name}`, type: "evt", name, ts: new Date().toISOString(), payload: { session_id: ID, seq_seen: 1, source: "hud", click_id: `batch-${name}`, ...(name === "hud_approve_pass" ? { pass: 1 } : {}) } }) + "\n";
    plugin.writeRaw(names.map(evt).join(""));
    const e = await fails(waiting);
    expect(e).toMatchObject({ code: "AWAITING_APPROVAL", recoverable: false });
    await hudAt("accepted");
    expect(count("apply_settings")).toBe(applies);
    expect(readLog().passes.map((p) => p.n)).toEqual([0, 1]);
    expect(rig.events.find((r) => r.name === "hud_approve_pass")?.note).toBe(approveNote);
  });
});
