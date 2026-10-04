// The HUD's updates from the session loop (src/hud/, src/session/manager.ts; PRD 6.3, PHASE5_PLAN
// row 5) against the simulated Lightroom and its simulated HUD, which takes updates by the plugin's
// rules (tests/helpers/lightroom-sim-hud.ts): the stages, the state each update carries, the copies
// listed before they are selected, and the state sent again after a drop.

import { describe, expect, it } from "vitest";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig, stagesOf } from "./helpers/hud-harness.js";
import { ID, clean, client, fails, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const step = (rig: ReturnType<typeof hudRig>, settings: Record<string, unknown>, target?: "A" | "B" | "C") =>
  rig.manager.step({ session_id: ID, ...(target ? { target } : {}), settings, rationale: "test" });

describe("HUD updates from a Converge session", () => {
  it("reports each stage, opens the HUD once, keeps seq rising, and carries the whole state", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const last = await hudAt("awaiting_claude");
    expect(stagesOf(rig)).toEqual(["begin", "pass0", "acquiring_preview", "metrics", "awaiting_claude"]);
    expect(lr.hud.taken[0]).toMatchObject({ stage: "begin", open: true, seq: 1 });
    expect(lr.hud.taken.slice(1).some((u) => u.open)).toBe(false);
    expect(lr.hud.opened).toBe(1);
    expect(lr.hud.taken.map((u) => u.seq)).toEqual(lr.hud.taken.map((_, i) => i + 1));
    expect([lr.hud.notTaken, lr.hud.refused, rig.hud.stats.invalid, rig.hud.stats.failed]).toEqual([[], [], 0, 0]);
    expect(last).toMatchObject({
      session_id: ID,
      mode: "converge",
      pass: 0,
      max_passes: 4,
      session_photos: ["SIM-UUID"],
      target: { uuid: "SIM-UUID", filename: "20260907-_OZ80093.NEF", iso: 64, shutter: "1/250 s", aperture: "f/8", lens: "NIKKOR Z 24-120mm f/4 S", lens_profile: "on" },
      settings: { mode: "autonomous", max_passes: 4, long_edge: 1600, quality: 75, clip_high_pct: 0.5, clip_low_pct: 1, decay: [1, 0.6, 0.4, 0.25] },
      deltas: [],
      guardrail: { status: "green" },
      snapshot: expect.stringMatching(/^AVG pre-session \d{4}-\d\d-\d\dT/),
    });
    // Every update of the open session carries the HUD's Put back (plugin 0.12.0): the master's pre-session snapshot.
    const snap = (plugin.received.find((r) => r.name === "create_snapshot")?.payload ?? {}) as { name?: string };
    expect(lr.hud.taken.every((u) => u.put_back?.photo_uuid === "SIM-UUID" && u.put_back.snapshot_name === snap.name && u.put_back.snapshot_name === u.snapshot)).toBe(true);
    expect(last.put_back?.snapshot_id).toEqual(expect.any(String));
    expect(last.settings?.variant_count).toBeUndefined();
    // The first update the HUD took is in the tool log's record (tools-shared.ts).
    expect(rig.records).toEqual([expect.objectContaining({ ok: true, stage: "begin", seq: 1, result: { applied: true, shown: true, opened: true } })]);
  });

  it("shows a step's deltas and guardrail status, then Claude's accept", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await step(rig, { exposure: 0.2, contrast: 10 });
    await waitUntil(() => lr.hud.last()?.pass === 1 && lr.hud.last()?.stage === "awaiting_claude");
    expect(stagesOf(rig).slice(5)).toEqual(["applying", "acquiring_preview", "metrics", "awaiting_claude"]);
    expect(lr.hud.last()).toMatchObject({
      deltas: [
        { slider: "Exposure", before: 0, after: 0.2, delta: "+0.2" },
        { slider: "Contrast", before: 0, after: 10, delta: "+10" },
      ],
      guardrail: { status: "green" },
    });
    // Capped and then corrected: the correction is the status shown.
    await step(rig, { exposure: 5 });
    await waitUntil(() => lr.hud.last()?.pass === 2 && lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()?.guardrail).toMatchObject({ status: "corrected", reason: expect.stringMatching(/^Highlight clipping was \d+(\.\d+)? % \(limit 0\.5 %\); corrected\.$/) });
    await step(rig, { clarity: 100 });
    await waitUntil(() => lr.hud.last()?.pass === 3 && lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()?.guardrail).toMatchObject({ status: "clamped", reason: expect.stringMatching(/^Clarity: change held to ±\d+(\.\d+)? this pass\.$/) });
    await rig.manager.end({ session_id: ID, outcome: "accept" });
    const accepted = await hudAt("accepted");
    expect(accepted.note).toBe("Claude accepted: the edit is kept.");
    expect(accepted.put_back).toBeUndefined(); // an ended session has nothing to put back
  });

  it("shows a changed selection, a failed call and Claude's revert", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    lr.selected = "SOMEONE-ELSE";
    expect((await fails(step(rig, { exposure: 0.1 }))).code).toBe("TARGET_CHANGED");
    expect((await hudAt("target_changed")).note).toBe("Another photo was selected, so nothing was changed; the edit is still open.");
    lr.selected = "SIM-UUID";
    lr.exportError = "disk full";
    await fails(step(rig, { exposure: 0.1 }));
    await waitUntil(() => lr.hud.last()?.note === "Claude's last call failed; the edit is still open.");
    expect(lr.hud.last()?.stage).toBe("awaiting_claude");
    lr.exportError = null;
    await rig.manager.end({ session_id: ID, outcome: "revert" });
    expect((await hudAt("ended")).note).toMatch(/Claude reverted/);
  });

  it("sends nothing to a plugin before 0.12.0, which would refuse the put_back field", async () => {
    lr.pluginVersion = "0.11.0";
    plugin.dropEventClient(); // the next hello reports 0.11.0
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await rig.manager.end({ session_id: ID, outcome: "revert" });
    expect(plugin.received.filter((r) => r.name === "hud_update")).toEqual([]);
    expect(rig.hud.stats.sent).toBe(0);
  });

  it("does not send an update that breaks the contract", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await hudAt("awaiting_claude");
    const taken = lr.hud.taken.length;
    (rig.manager as unknown as { session: { master: { uuid: string } } }).session.master.uuid = "x".repeat(65);
    await rig.manager.setRegions({ session_id: ID, regions: [] });
    await waitUntil(() => rig.hud.stats.invalid === 1);
    expect(lr.hud.taken.length).toBe(taken);
    expect(rig.records.at(-1)).toMatchObject({ ok: false, error: expect.stringMatching(/^not sent: /) });
  });
});

describe("A failed update", () => {
  it("is tried again, so the HUD is not left behind until the next stage (Greptile, PR #47)", async () => {
    clean();
    const rig = hudRig();
    const update = plugin.handlers.get("hud_update");
    let fail = true;
    plugin.handlers.set("hud_update", (p, id) => {
      if (fail && p["stage"] === "awaiting_claude") {
        fail = false;
        return { ok: false, error: { code: "busy", message: "try later", recoverable: true } };
      }
      return update ? update(p, id) : "silent";
    });
    await rig.manager.begin({ intent_id: "test_plain" });
    // Begin's last update failed, and nothing else changes the stage: only the retry brings it.
    await hudAt("awaiting_claude", 5000);
    expect([rig.hud.stats.failed, fail]).toEqual([1, false]);
  });

  it("gives each new stage its own retries, so a new session's HUD is not left behind (Greptile, PR #47)", async () => {
    clean();
    const rig = hudRig({}, { retryMs: 20 });
    const update = plugin.handlers.get("hud_update");
    let failing = Number.POSITIVE_INFINITY; // how many more updates fail
    plugin.handlers.set("hud_update", (p, id) => {
      if (failing > 0) {
        failing--;
        return { ok: false, error: { code: "busy", message: "try later", recoverable: true } };
      }
      return update ? update(p, id) : "silent";
    });
    await rig.manager.begin({ intent_id: "test_plain" });
    // Every update of begin fails, and the retries run out.
    await waitUntil(() => rig.hud.stats.failed >= 4);
    await new Promise((r) => setTimeout(r, 200));
    const failed = rig.hud.stats.failed;
    expect(lr.hud.taken).toEqual([]);
    // Updates work again after one more failure: the next stage's own retry brings the state.
    failing = 1;
    await rig.manager.setRegions({ session_id: ID, regions: [] });
    await hudAt("awaiting_claude", 2000);
    expect(rig.hud.stats.failed).toBe(failed + 1);
  });
});

describe("HUD updates from a Variants session", () => {
  it("lists every copy before selecting it, and offers the pick once each copy has its pass", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
    const received = plugin.received;
    const selects = received.flatMap((r, i) => (r.name === "select_photo" ? [{ i, uuid: String(r.payload["uuid"]) }] : []));
    expect(selects.length).toBeGreaterThan(0);
    for (const { i, uuid } of selects) {
      const listed = received.slice(0, i).some((r) => r.name === "hud_update" && (r.payload["session_photos"] as string[] | undefined)?.includes(uuid));
      expect(listed, `an update listing ${uuid} before its select_photo`).toBe(true);
    }
    for (const t of ["A", "B", "C"] as const) await step(rig, { exposure: 0.1 }, t);
    const pick = await hudAt("awaiting_pick");
    expect(pick).toMatchObject({ mode: "variants", variants: ["A", "B", "C"], session_photos: ["SIM-UUID", "SIM-COPY-1", "SIM-COPY-2", "SIM-COPY-3"], settings: { variant_count: 3 } });
    expect(pick.target).toMatchObject({ uuid: "SIM-COPY-3", copy_name: "AVG test_variants C" });
    expect(pick.put_back?.photo_uuid).toBe("SIM-UUID"); // the master's snapshot, whichever copy is the target
    expect(lr.hud.notTaken).toEqual([]);
  });
});

describe("A session rides out a drop", () => {
  it("sends the session's state again after a reconnect", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const seq = (await hudAt("awaiting_claude")).seq;
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    await waitUntil(() => (lr.hud.last()?.seq ?? 0) > seq);
    expect(lr.hud.last()).toMatchObject({ session_id: ID, stage: "awaiting_claude" });
    expect(lr.hud.last()?.open).toBeUndefined();
  });

  it("a write cut off by a drop says it may have been written; the session stays open", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const apply = plugin.handlers.get("apply_settings");
    plugin.handlers.set("apply_settings", () => "silent");
    const pending = step(rig, { exposure: 0.2 });
    await waitUntil(() => plugin.received.some((r) => r.name === "apply_settings"));
    plugin.dropEventClient();
    const e = await fails(pending);
    expect(e.code).toBe("BRIDGE_DISCONNECTED");
    expect(e.message).toMatch(/"AVG abcdef pass 1\/4" was sent and may have been written; the next lr_step reads the photo first/);
    expect(e.details).toMatchObject({ maybe_written: true, history_name: "AVG abcdef pass 1/4", session_id: ID });
    if (apply) plugin.handlers.set("apply_settings", apply);
    await client.waitConnected(2000);
    expect(rig.manager.current()?.id).toBe(ID);
    expect((await step(rig, { exposure: 0.2 })).json).toMatchObject({ ok: true, pass: "1/4" });
  });
});
