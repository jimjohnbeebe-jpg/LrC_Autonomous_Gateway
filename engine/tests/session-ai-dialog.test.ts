// AI masks that cannot leave the photo stuck (src/session/ai-update.ts, ai-masks.ts; GitHub issue #59,
// PR C step 2b) against the simulated Lightroom (helpers/lightroom-sim-masks.ts): a kind the photo
// lacks (ErrorReason), Lightroom's dialog holding the write gate (the HUD told, nothing written or
// exported meanwhile, then the photo put back and the session ended), a slow model that holds the gate
// and then computes, a dialog that never closes, and an update Lightroom dropped.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { DIALOG_NOTE, type HudSink } from "../src/session/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { ID, clean, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const FAST = { computeMs: 2000, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, graceMs: 40, dialogWaitMs: 2000 };

async function session(timings: Record<string, number> = {}) {
  clean();
  const notes: string[] = [];
  const hud: HudSink = {
    stage: (s, stage, o) => void notes.push(`${stage}: ${o?.note ?? s.work?.note ?? ""}`),
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
  it("tells the user to click OK, writes and exports nothing while it is open, then puts the photo back and ends the session", async () => {
    const { m, create, notes, start } = await session();
    lr.masks.gate = "dialog";
    lr.masks.heldProbes = 4;
    const e = await fails(create("sky", { sliders: { "local.exposure": -0.5 } }));
    expect(e).toMatchObject({ code: "LIGHTROOM_DIALOG", recoverable: false, details: { session_id: ID, reverted: true, outcome: "revert", ended_by: "engine" } });
    expect(e.message).toMatch(/put the photo back as it was before the session/);
    expect(notes).toContain(`applying: ${DIALOG_NOTE}`);
    expect(notes.at(-1)).toBe("ended: Lightroom was busy or showed a dialog, so the photo was put back as it was before the edit.");
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

  it("when the dialog stays open: says what to do, keeps the session open, and writes nothing more until it ends", async () => {
    const { m, create } = await session({ dialogWaitMs: 100 });
    lr.masks.gate = "dialog";
    lr.masks.heldProbes = 1_000_000;
    const e = await fails(create("people_face_skin"));
    expect(e).toMatchObject({ code: "LIGHTROOM_DIALOG", details: { reverted: false } });
    expect(e.message).toMatch(/if a dialog is open in Lightroom, click OK; then call lr_end_session with outcome "revert"/);
    expect(e.message).toMatch(/open the Snapshots panel and click "AVG pre-session/);
    expect(m.current()?.id).toBe(ID);
    const step = await fails(m.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" }));
    expect(step.code).toBe("AI_UPDATE_PENDING");
    lr.masks.held = 0; // the user clicks OK
    expect((await m.end({ session_id: ID, outcome: "revert" })).json).toMatchObject({ outcome: "revert", revert: { differing: [] } });
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

  it("an update whose answer does not come (the gate held at once) is watched, then put back as a dialog", async () => {
    const { m, create } = await session({ replyMs: 50 });
    const real = plugin.handlers.get("update_ai_settings") as FakeHandler;
    plugin.handlers.set("update_ai_settings", (p, id) => {
      [lr.masks.gate, lr.masks.heldProbes] = ["dialog", 3];
      void real(p, id);
      lr.masks.gate = "free";
      return "silent";
    });
    expect(await fails(create("sky"))).toMatchObject({ code: "LIGHTROOM_DIALOG", details: { reverted: true } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(m.current()).toBeNull();
  });

  it("stops probing once the update is over and the gate reads free", async () => {
    const { create } = await session({ computeMs: 300 });
    lr.masks.tableRoute = "never";
    expect((await fails(create("sky"))).code).toBe("FEATURE_UNAVAILABLE");
    expect(sent("probe_write_gate")).toBe(1);
  });
});
