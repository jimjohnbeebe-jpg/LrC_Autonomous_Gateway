// AI masks that cannot leave the photo stuck (src/session/ai-update.ts, ai-masks.ts; GitHub issue #59,
// PR C steps 2b-2d) against the simulated Lightroom (helpers/lightroom-sim-masks.ts): a kind the photo
// lacks (ErrorReason), Lightroom's dialog holding the write gate (the HUD told, nothing written or
// exported meanwhile; the photo put back only when Lightroom reports the update failed or dropped it, D16),
// a slow model that holds the gate and then computes, a dialog that never closes, and an update Lightroom
// dropped. A Lightroom restart's revert is in session-ai-restart.test.ts.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { DIALOG_NOTE, WORKING_NOTE, type HudSink } from "../src/session/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { ID, clean, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const FAST = { computeMs: 2000, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 300 };

async function session(timings: Record<string, number> = {}) {
  clean();
  const notes: string[] = [];
  const hud: HudSink = {
    stage: (s, stage, o) => void notes.push(`${stage}: ${o?.note ?? s.work?.note ?? ""}${o?.closeAfter ? ` (closes after ${o.closeAfter} s)` : ""}`),
    settle: async () => undefined,
  };
  const m = newManager({ hud, aiTimings: { ...FAST, ...timings } });
  await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  const start = structuredClone(lr.settings);
  const create = (kind: string, extra: Record<string, unknown> = {}) => m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind, ...extra });
  return { m, create, notes, start };
}

describe("AI masks: a kind the photo lacks", () => {
  it("takes the mask out when Lightroom answers ErrorReason, says so plainly, and uses no pass", async () => {
    const { m, create } = await session();
    lr.masks.tableRoute = "absent";
    const e = await fails(create("landscape_snow"));
    expect(e).toMatchObject({ code: "MASK_NOTHING_FOUND", recoverable: true, details: { kind: "landscape_snow", error_reason: 1 } });
    expect(e.message).toMatch(/^Lightroom found no Snow in this photo/);
    expect(masks()).toEqual([]);
    expect(m.current()?.pass).toBe("0/4");
  });

  it("does not fall back to LrDevelopController for subject, sky or background either", async () => {
    const { create } = await session();
    lr.masks.tableRoute = "absent";
    expect((await fails(create("sky"))).code).toBe("MASK_NOTHING_FOUND");
    expect(sent("create_ai_mask_dc")).toBe(0);
  });
});

describe("AI masks: Lightroom's dialog", () => {
  it("tells the user to click OK, writes and exports nothing while it is open; when Lightroom then reports the update failed, puts the photo back and ends the session", async () => {
    const { m, create, notes, start } = await session();
    [lr.masks.gate, lr.masks.heldProbes, lr.masks.releaseState] = ["dialog", 4, "failed"];
    const e = await fails(create("sky", { sliders: { "local.exposure": -0.5 } }));
    expect(e).toMatchObject({ code: "LIGHTROOM_DIALOG", recoverable: false, details: { session_id: ID, reverted: true, outcome: "revert", ended_by: "engine" } });
    expect(e.message).toMatch(/put the photo back as it was before the session/);
    expect(notes).toContain(`applying: ${DIALOG_NOTE}`);
    expect(notes.at(-1)).toBe("ended: Lightroom was busy or showed a dialog, so the photo was put back as it was before the edit. (closes after 10 s)");
    expect(notes).toContain(`applying: ${WORKING_NOTE}`);
    expect(DIALOG_NOTE).toBe("Lightroom is busy or shows a dialog: if a dialog is open in Lightroom, click OK.");
    expect(lr.masks.blocked).toEqual([]);
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(lr.settings[MASK_TABLE_KEY] ?? []).toEqual(start[MASK_TABLE_KEY] ?? []);
    expect(lr.settings["Exposure2012"]).toBe(start["Exposure2012"]);
    expect(m.current()).toBeNull();
    const log = readLog();
    expect(log).toMatchObject({ outcome: "revert", ended_by: { source: "engine", reason: expect.stringMatching(/dialog/) }, revert: { differing: [] } });
    expect(log.failures.at(-1)?.error.code).toBe("LIGHTROOM_DIALOG");
  });

  it("a dialog closed with no mask computed: writes nothing, neither 60 s after nor at the time limit (LIGHTROOM_STUCK), the session open (D16)", async () => {
    const { m, create, notes } = await session({ computeMs: 400 });
    [lr.masks.gate, lr.masks.heldProbes] = ["dialog", 3];
    const snapshots = sent("apply_snapshot");
    const e = await fails(create("sky"));
    expect(e).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(e.message).toMatch(/no result within 0 minutes, Lightroom's update done/);
    expect(notes).toContain(`applying: ${DIALOG_NOTE}`);
    expect(sent("apply_snapshot")).toBe(snapshots);
    expect(lr.masks.blocked).toEqual([]);
    expect(m.current()?.id).toBe(ID);
  });

  it("goes on when the gate was held by a slow model that then computed: nothing is reverted", async () => {
    const { m, create, notes } = await session();
    lr.masks.gate = "slow";
    lr.masks.heldProbes = 3;
    const out = await create("landscape_vegetation");
    expect(out.json).toMatchObject({ ok: true, pass: "1/4", ai: { route: "table" }, mask: { computed: true } });
    expect(notes).toContain(`applying: ${DIALOG_NOTE}`);
    expect(readLog().passes.at(-1)?.mask?.ai).toMatchObject({ route: "table", dialog_ms: expect.any(Number) });
    expect(m.current()?.id).toBe(ID);
  });

  it("when Lightroom's update still runs after the time is up: says it seems stuck, writes nothing, keeps the session open and refuses its revert", async () => {
    const { m, create, notes } = await session({ computeMs: 200, stuckProbesMs: 10_000 });
    lr.masks.gate = "dialog";
    lr.masks.heldProbes = 1_000_000;
    const snapshots = sent("apply_snapshot");
    const e = await fails(create("people_face_skin"));
    expect(e).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(e.message.startsWith("Lightroom's AI mask computation seems stuck (the AI People - Face Skin mask: no result within 0 minutes, Lightroom's update running).")).toBe(true);
    expect(e.message).toContain("restart Lightroom (File > Exit, then start it again). Once it is back, the engine notices the restart");
    expect(sent("apply_snapshot")).toBe(snapshots);
    expect(notes.at(-1)).toBe("awaiting_claude: Lightroom's AI mask seems stuck. Restart Lightroom: the photo is then put back by itself.");
    expect(m.current()?.id).toBe(ID);
    const step = await fails(m.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" }));
    expect(step).toMatchObject({ code: "AI_UPDATE_PENDING", recoverable: false });
    lr.masks.held = 0; // the user clicks OK; still no result
    expect(await fails(m.end({ session_id: ID, outcome: "revert" }))).toMatchObject({ code: "AI_UPDATE_PENDING" });
    expect(sent("apply_snapshot")).toBe(snapshots);
  });
});

describe("AI masks: an update Lightroom dropped or that raised", () => {
  it("an update that raised with the gate free is a plugin error: LrDevelopController makes subject, sky and background", async () => {
    const { create } = await session();
    lr.masks.tableRoute = "failed";
    expect((await create("subject")).json).toMatchObject({ ai: { route: "dc", fallback: expect.stringMatching(/updateAISettings raised in Lightroom: dry/) } });
    lr.masks.dc = "unknown";
    const e = await fails(create("person_entire", { point: { x: 0.5, y: 0.6 } }));
    expect(e.details).toMatchObject({ routes_tried: [{ route: "table", why: expect.stringMatching(/raised in Lightroom/) }, { route: "dc", why: expect.stringMatching(/none for this kind/) }] });
  });

  it("an update Lightroom dropped (the gate stayed held) is handled as a dialog: the photo is put back, no fallback", async () => {
    const { m, create } = await session();
    lr.masks.tableRoute = "abandoned";
    expect(await fails(create("subject"))).toMatchObject({ code: "LIGHTROOM_DIALOG", details: { reverted: true } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(m.current()).toBeNull();
  });

  it("after a busy gate, an update that then reports it raised is still a dialog: the photo is put back, no fallback", async () => {
    const { m, create } = await session();
    [lr.masks.gate, lr.masks.heldProbes, lr.masks.releaseState] = ["dialog", 3, "failed"];
    expect(await fails(create("sky"))).toMatchObject({ code: "LIGHTROOM_DIALOG", details: { reverted: true } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(lr.masks.blocked).toEqual([]);
    expect(m.current()).toBeNull();
  });

  it("an update whose answer does not come (the gate held at once) is watched, then put back as a dialog once it reports it failed", async () => {
    const { m, create } = await session({ replyMs: 50 });
    const real = plugin.handlers.get("update_ai_settings") as FakeHandler;
    plugin.handlers.set("update_ai_settings", (p, id) => {
      [lr.masks.gate, lr.masks.heldProbes, lr.masks.releaseState] = ["dialog", 3, "failed"];
      void real(p, id);
      lr.masks.gate = "free";
      return "silent";
    });
    expect(await fails(create("sky"))).toMatchObject({ code: "LIGHTROOM_DIALOG", details: { reverted: true } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(m.current()).toBeNull();
  });

  it("takes the update's state only from its own request: another request's failure is not this one's", async () => {
    const { m, create } = await session({ computeMs: 300 });
    [lr.masks.tableRoute, lr.masks.foreignUpdate] = ["failed", true];
    expect(await fails(create("subject"))).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(m.current()?.id).toBe(ID);
  });

  it("stops probing once the update is over and the gate reads free; no result in time: Lightroom said to seem stuck, nothing written (D16)", async () => {
    const { m, create } = await session({ computeMs: 300 });
    lr.masks.tableRoute = "never";
    const snapshots = sent("apply_snapshot");
    const e = await fails(create("sky"));
    expect(e).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(sent("probe_write_gate")).toBe(1);
    expect(sent("apply_snapshot")).toBe(snapshots);
    expect(m.current()?.id).toBe(ID);
  });

  it("never puts the photo back while Lightroom's update still runs, though its gate is free again", async () => {
    const { m, create } = await session({ computeMs: 400 });
    [lr.masks.gate, lr.masks.heldProbes, lr.masks.releaseState] = ["dialog", 2, "running"];
    const snapshots = sent("apply_snapshot");
    expect(await fails(create("sky"))).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(sent("apply_snapshot")).toBe(snapshots);
    expect(m.current()?.id).toBe(ID);
  });

  it("probes that go unanswered: Lightroom seems stuck, nothing written", async () => {
    const { m, create } = await session({ computeMs: 5000, stuckProbesMs: 150 });
    [lr.masks.tableRoute, lr.masks.probe] = ["never", "silent"];
    const snapshots = sent("apply_snapshot");
    const e = await fails(create("sky"));
    expect(e).toMatchObject({ code: "LIGHTROOM_STUCK", details: { reverted: false } });
    expect(e.message).toMatch(/did not answer the gate probes/);
    expect(sent("apply_snapshot")).toBe(snapshots);
    expect(m.current()?.id).toBe(ID);
  });
});
