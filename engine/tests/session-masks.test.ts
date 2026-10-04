// The mask tools inside a session (src/session/masks.ts; GitHub issue #59, PR C step 2) against the
// simulated Lightroom, whose masks are the table its apply_settings writes: a listing without a pass,
// one pass per change, refusals before anything is written, the race check, the mask-only undo,
// convergence and the cap, the revert and the accept, Variants mode and an older plugin. The sim
// renders global settings only; a test that needs a mask to change the render says so.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { dayStamp } from "../src/log/index.js";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { waitUntil, type FakeHandler } from "./helpers/fake-plugin.js";
import { hudRig } from "./helpers/hud-harness.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { defaultSimPrefs } from "./helpers/lightroom-sim-prefs.js";
import { ID, SHORT, clean, client, fails, logDir, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const begin = (extra: Record<string, unknown> = {}, m = manager) => m.begin({ intent_id: "test_plain", return_image: "none", ...extra });
const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const LINEAR = { kind: "linear", name: "AVG bottom", geometry: { zero: { x: 0.5, y: 0.67 }, full: { x: 0.5, y: 0.9 } }, sliders: { "local.exposure": 1 } };
const create = (args: Record<string, unknown> = LINEAR, m = manager) => m.createMask({ ...pass, kind: "linear", ...args });
const idOf = (out: { json: Record<string, unknown> }): string => (out.json["mask"] as { id: string }).id;

/** The sim renders global settings only: while the photo has masks, render it 3 EV brighter (a mask that clips). */
function masksBrighten(): void {
  const real = plugin.handlers.get("export_preview") as FakeHandler;
  plugin.handlers.set("export_preview", async (p, id) => {
    const saved = lr.settings["Exposure2012"];
    if (masks().length > 0) lr.settings["Exposure2012"] = Number(saved) + 3;
    try {
      return await real(p, id);
    } finally {
      lr.settings["Exposure2012"] = saved;
    }
  });
}

describe("mask tools: list and passes", () => {
  it("lists the photo's masks with their kinds, without a pass or a write", async () => {
    clean();
    lr.settings[MASK_TABLE_KEY] = structuredClone(captureTable);
    await begin();
    const writes = lr.history.length;
    const out = await manager.listMasks({ session_id: ID });
    expect(out.json).toMatchObject({ pass: "0/4", count: 5 });
    expect((out.json["masks"] as Array<{ kind: string }>).map((m) => m.kind)).toEqual(["linear", "radial", "sky", "subject", "luminance"]);
    expect((out.json["local_sliders"] as Record<string, number[]>)["local.exposure"]).toEqual([-4, 4]);
    expect(lr.history.length).toBe(writes);
  });

  it("creates a linear mask as one pass: History name, stored values, the log's mask entry, the image", async () => {
    clean();
    await begin();
    const out = await manager.createMask({ ...pass, ...LINEAR, return_image: "after" });
    expect(out.json).toMatchObject({ pass: "1/4", op: "create", mask: { name: "AVG bottom", kind: "linear", sliders: { "local.exposure": 1 } }, passes_left: 3, cap_reached: false });
    expect(out.image).toBeInstanceOf(Buffer);
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 1/4 mask create`);
    expect(masks()).toHaveLength(1);
    expect(masks()[0]).toMatchObject({ CorrectionName: "AVG bottom", LocalExposure2012: 0.25 });
    expect((masks()[0]?.["CorrectionMasks"] as Record<string, unknown>[])[0]).toMatchObject({ What: "Mask/Gradient", ZeroY: 0.67, FullY: 0.9 });
    const logged = readLog().passes.at(-1);
    expect(logged).toMatchObject({ n: 1, kind: "mask", changes: [], mask: { op: "create", kind: "linear", before: null, after: { name: "AVG bottom" } } });
    expect(plugin.received.some((r) => r.name === "update_ai_settings")).toBe(false);
  });

  it("edits, renames, hides and deletes by id; deleting the last mask writes an empty table", async () => {
    clean();
    await begin({ max_passes: 6 });
    const id = idOf(await create());
    const edited = await manager.editMask({ ...pass, mask_id: id, sliders: { "local.toning_hue": 180, "local.contrast": -20 }, name: "AVG renamed" });
    expect(edited.json["mask"]).toMatchObject({ id, name: "AVG renamed", sliders: { "local.exposure": 1, "local.toning_hue": 180, "local.contrast": -20 } });
    expect(masks()[0]).toMatchObject({ LocalToningHue: 180, LocalContrast2012: -0.2, CorrectionName: "AVG renamed" });
    await manager.editMask({ ...pass, mask_id: id, active: false });
    expect(masks()[0]?.["CorrectionActive"]).toBe(false);
    const deleted = await manager.deleteMask({ ...pass, mask_id: id });
    expect(deleted.json).toMatchObject({ pass: "4/6", op: "delete", deleted: true, masks: [] });
    expect(masks()).toEqual([]);
    expect(readLog().passes.map((p) => p.mask?.op ?? p.kind)).toEqual(["pass0", "create", "edit", "edit", "delete"]);
  });

  it("refuses an unknown id, a refused kind and a change to nothing, with nothing written and no pass used", async () => {
    clean();
    await begin();
    const id = idOf(await create());
    const writes = lr.history.length;
    expect(await fails(manager.deleteMask({ ...pass, mask_id: "NOPE" }))).toMatchObject({ code: "MASK_NOT_FOUND", recoverable: false });
    expect(await fails(create({ kind: "brush" }))).toMatchObject({ code: "MASK_KIND_NOT_SUPPORTED", message: expect.stringMatching(/strokes/) });
    expect(await fails(manager.editMask({ ...pass, mask_id: id, name: "AVG bottom" }))).toMatchObject({ code: "NO_CHANGE" });
    expect(lr.history.length).toBe(writes);
    expect(manager.current()?.pass).toBe("1/4");
  });
});

describe("mask tools: the photo changing, the guardrail, convergence and the cap", () => {
  it("stops with MASKS_CHANGED, nothing written, when Lightroom's masks change while the pass prepares", async () => {
    clean();
    await begin();
    lr.settings["Exposure2012"] = Number(lr.settings["Exposure2012"]) + 0.05; // so the pass renders the photo first
    const real = plugin.handlers.get("export_preview") as FakeHandler;
    plugin.handlers.set("export_preview", (p, id) => {
      lr.settings[MASK_TABLE_KEY] = [structuredClone(captureTable[0])]; // the user adds a mask meanwhile
      return real(p, id);
    });
    const writes = lr.history.length;
    expect(await fails(create())).toMatchObject({ code: "MASKS_CHANGED", recoverable: true });
    expect(lr.history.length).toBe(writes);
    expect(manager.current()?.pass).toBe("0/4");
  });

  it("renders again before a step when a mask was added in Lightroom since the last render", async () => {
    clean();
    await begin();
    lr.settings[MASK_TABLE_KEY] = [structuredClone(captureTable[1])];
    const out = await manager.step({ session_id: ID, settings: { exposure: 0.1 }, rationale: "test", return_image: "none" });
    expect(out.json["metrics_refreshed"]).toBeDefined();
  });

  it("undoes a mask pass that clips, by writing the table back; the global settings stay", async () => {
    clean();
    await begin();
    masksBrighten();
    const before = structuredClone(lr.settings);
    const out = await create();
    expect(out.json).toMatchObject({ pass: "1/4", undone: { limit: "clip_high" }, masks: [], guardrail_actions: [{ kind: "reverted", limit: "clip_high" }] });
    expect(lr.history.slice(-2)).toEqual([`AVG ${SHORT} pass 1/4 mask create`, `AVG ${SHORT} pass 1/4 clip revert`]);
    expect(readLog().passes.at(-1)?.mask).toMatchObject({ name: "AVG bottom", after: null });
    expect(masks()).toEqual([]);
    expect({ ...lr.settings, [MASK_TABLE_KEY]: undefined }).toEqual({ ...before, [MASK_TABLE_KEY]: undefined });
  });

  it("reports a clip undo of the first mask that did not take as unmet, and keeps the mask", async () => {
    clean();
    await begin();
    masksBrighten();
    const real = plugin.handlers.get("apply_settings") as FakeHandler;
    plugin.handlers.set("apply_settings", (p, id) => {
      const table = (p["settings"] as Record<string, unknown>)[MASK_TABLE_KEY];
      return Array.isArray(table) && table.length === 0 ? real({ ...p, settings: { Exposure2012: lr.settings["Exposure2012"] } }, id) : real(p, id);
    });
    const out = await create();
    expect(out.json).toMatchObject({ guardrail_actions: [{ kind: "unmet", limit: "clip_high", reason: expect.stringMatching(/did not take.*the mask change stays/) }], masks: [{ name: "AVG bottom" }] });
    expect(out.json["undone"]).toBeUndefined();
  });

  it("an undone delete says deleted: false, and the HUD says the change was undone", async () => {
    clean();
    lr.settings[MASK_TABLE_KEY] = [structuredClone(captureTable[0])];
    const rig = hudRig();
    await begin({}, rig.manager);
    masksBrighten(); // the photo is brighter while it has masks: deleting the mask makes it darker, which does not clip
    const realExport = plugin.handlers.get("export_preview") as FakeHandler;
    plugin.handlers.set("export_preview", async (p, id) => {
      const saved = lr.settings["Blacks2012"];
      if (masks().length === 0) lr.settings["Blacks2012"] = -100; // without the mask the shadows crush
      try {
        return await realExport(p, id);
      } finally {
        lr.settings["Blacks2012"] = saved;
      }
    });
    const id = String((captureTable[0] as Correction)["CorrectionID"]);
    const out = await rig.manager.deleteMask({ ...pass, mask_id: id });
    expect(out.json).toMatchObject({ deleted: false, undone: { limit: "clip_low" } });
    await waitUntil(() => lr.hud.last()?.pass === 1 && lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()?.deltas).toEqual([{ slider: "Mask 1", after: "change undone" }]);
  });

  it("may follow convergence and clears it; the cap still holds", async () => {
    clean();
    await begin({ max_passes: 3 });
    expect((await manager.step({ session_id: ID, settings: { exposure: 0.02 }, rationale: "test", return_image: "none" })).json).toMatchObject({ converged_by_metrics: true });
    expect((await create()).json).toMatchObject({ pass: "2/3", cap_reached: false });
    await manager.step({ session_id: ID, settings: { exposure: -0.1 }, rationale: "test", return_image: "none" }); // no CONVERGED: the mask pass cleared it
    expect(await fails(create())).toMatchObject({ code: "CAP_REACHED", message: expect.stringMatching(/raise max_passes/) });
  });

  it("approve_each_pass: a mask pass after a converged pass waits for its approval", async () => {
    clean();
    lr.prefs = { ...defaultSimPrefs(), mode: "approve_each_pass" };
    const m = (await import("./helpers/session-harness.js")).newManager({ approvalWaitMs: 150 });
    await begin({}, m);
    await m.step({ session_id: ID, settings: { exposure: 0.02 }, rationale: "test", return_image: "none" });
    expect(await fails(create(LINEAR, m))).toMatchObject({ code: "AWAITING_APPROVAL", message: expect.stringMatching(/call lr_create_mask again/) });
    await m.approvePass({ session_id: ID, confirmed: true });
    expect((await create(LINEAR, m)).json).toMatchObject({ pass: "2/4", approval: { pass: 1, by: "claude" } });
  });
});

describe("mask tools: the session's end, Variants mode, an older plugin, the HUD", () => {
  it("revert takes the masks away with the snapshot; masks left over are named in revert.differing", async () => {
    clean();
    await begin();
    await create();
    const out = await manager.end({ session_id: ID, outcome: "revert" });
    expect(out.json).toMatchObject({ revert: { differing: [] } });
    expect(masks()).toEqual([]);
  });

  it("names masks the snapshot did not take away", async () => {
    clean();
    await begin();
    await create();
    lr.snapshots.set("SNAP-1", { ...(lr.snapshots.get("SNAP-1") as object), [MASK_TABLE_KEY]: [structuredClone(captureTable[0])] });
    expect((await manager.end({ session_id: ID, outcome: "revert" })).json).toMatchObject({ revert: { differing: ["masks"] } });
  });

  it("accept says the masks stay on the photo and are not in the recipe", async () => {
    clean();
    await begin();
    await create();
    const out = await manager.end({ session_id: ID, outcome: "accept" });
    expect(out.json["masks_note"]).toMatch(/keeps its mask; the recipe carries the global settings only/);
    const recipe = JSON.parse(readFileSync(path.join(logDir, `${dayStamp(new Date())}-${SHORT}.recipe.json`), "utf8")) as { masks?: number };
    expect(recipe.masks).toBe(1);
  });

  it("refuses mask writes while the photo has a mask it cannot write back; lr_step never sends the mask table", async () => {
    clean();
    const two = structuredClone(captureTable[0]) as Correction;
    (two["CorrectionMasks"] as unknown[]).push(structuredClone((captureTable[1] as Correction)["CorrectionMasks"] as unknown[])[0]);
    lr.settings[MASK_TABLE_KEY] = [two, structuredClone(captureTable[2])];
    await begin();
    const writes = lr.history.length;
    expect(await fails(create())).toMatchObject({ code: "MASKS_UNCAPTURED_KIND", recoverable: false, message: expect.stringMatching(/"Mask 1".*2 components.*left untouched/) });
    expect(lr.history.length).toBe(writes);
    expect((await manager.listMasks({ session_id: ID })).json).toMatchObject({ count: 2 });
    await manager.step({ session_id: ID, settings: { exposure: 0.1 }, rationale: "test", return_image: "none" });
    const sent = plugin.received.filter((r) => r.name === "apply_settings").map((r) => Object.keys(r.payload["settings"] as object));
    expect(sent.flat()).not.toContain(MASK_TABLE_KEY);
  });

  it("Variants mode: masks are refused before the pick", async () => {
    clean();
    await manager.begin({ intent_id: "test_variants", mode: "variants", variant_count: 2, return_image: "none" });
    expect(await fails(create({ ...LINEAR, target: "A" }))).toMatchObject({ code: "MASKS_AFTER_PICK" });
  });

  it("refuses the mask writes on a plugin before 0.14.0; the listing still reads", async () => {
    clean();
    await begin();
    const hello = client.hello();
    const old = vi.spyOn(client, "hello").mockReturnValue(hello ? { ...hello, plugin_version: "0.13.0" } : null);
    expect(await fails(create())).toMatchObject({ code: "PLUGIN_TOO_OLD", message: expect.stringMatching(/0\.14\.0 or later.*runs 0\.13\.0/) });
    expect((await manager.listMasks({ session_id: ID })).json).toMatchObject({ count: 0 });
    old.mockRestore();
  });

  it("shows a mask pass in the HUD in the Masking panel's words", async () => {
    clean();
    const rig = hudRig();
    await begin({}, rig.manager);
    await create(LINEAR, rig.manager);
    await waitUntil(() => lr.hud.last()?.pass === 1 && lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.last()?.deltas).toEqual([
      { slider: "AVG bottom", after: "new mask" },
      { slider: "AVG bottom · Exposure", before: 0, after: 1, delta: "+1" },
    ]);
  });
});
