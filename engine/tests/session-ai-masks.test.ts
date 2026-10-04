// AI masks in a mask pass (src/session/ai-masks.ts; GitHub issue #59) against the simulated Lightroom
// (helpers/lightroom-sim-masks.ts): the table route (the entry in Adobe's form, update_ai_settings,
// the wait for its digest), the fall back to LrDevelopController only after a gate or plugin error, the
// route kept for the session, one person with their point, and FEATURE_UNAVAILABLE with nothing left
// written. Dialogs and kinds the photo lacks: session-ai-dialog.test.ts.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { ID, SHORT, clean, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const component = (e: Correction | undefined): Record<string, unknown> => ((e?.["CorrectionMasks"] as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const pluginError: FakeHandler = () => ({ ok: false, error: { code: "plugin_error", message: "dry: raised", recoverable: false } });

async function session(maxPasses = 4) {
  clean();
  const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
  await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: maxPasses });
  const create = (kind: string, extra: Record<string, unknown> = {}) => m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind, ...extra });
  return { m, create };
}

describe("AI masks: the table route", () => {
  it("writes the entry in Adobe's form, asks Lightroom to compute it, and waits for its digest", async () => {
    const { create } = await session();
    const out = await create("sky", { sliders: { "local.exposure": -0.5 } });
    expect(out.json).toMatchObject({ pass: "1/4", ai: { route: "table" }, mask: { kind: "sky", computed: true, sliders: { "local.exposure": -0.5 } } });
    expect(sent("update_ai_settings")).toBe(1);
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(component(masks()[0])).toMatchObject({ What: "Mask/Image", MaskSubType: 2, MaskVersion: 1, ReferencePoint: "0.500000 0.500000", ErrorReason: 0, MaskDigest: expect.any(String) });
    expect(readLog().passes.at(-1)?.mask?.ai).toMatchObject({ route: "table", update_ms: expect.any(Number), computed_ms: expect.any(Number) });
  });

  it("makes every person's part and every landscape category by the table route", async () => {
    const { create } = await session();
    expect((await create("people_hair")).json).toMatchObject({ ai: { route: "table" }, mask: { kind: "people_hair", computed: true } });
    expect((await create("landscape_water")).json).toMatchObject({ ai: { route: "table" }, mask: { kind: "landscape_water", computed: true } });
    expect(masks().map((e) => [component(e)["MaskSubType"], component(e)["MaskSubCategoryID"]])).toEqual([[3, 5], [0, 50007]]);
  });

  it("writes one person's point as the entry's ReferencePoint and pin", async () => {
    const { create } = await session();
    const out = await create("person_face_skin", { point: { x: 0.492188, y: 0.379412 } });
    expect(out.json).toMatchObject({ ai: { route: "table" }, mask: { kind: "person_face_skin", geometry: { point: { x: 0.492188, y: 0.379412 } } } });
    expect(masks()[0]).toMatchObject({ CorrectionReferenceX: 0.492188, CorrectionReferenceY: 0.379412 });
    expect(component(masks()[0])).toMatchObject({ MaskSubType: 0, MaskSubCategoryID: 2, ReferencePoint: "0.492188 0.379412" });
  });

  it("takes out a mask that does not compute, and does not try LrDevelopController for it", async () => {
    const { m, create } = await session();
    lr.masks.tableRoute = "never";
    const e = await fails(create("sky"));
    expect(e).toMatchObject({ code: "FEATURE_UNAVAILABLE", details: { routes_tried: [{ route: "table", why: expect.stringMatching(/did not compute/) }, { route: "dc", why: expect.stringMatching(/not tried/) }] } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(masks()).toEqual([]);
    expect(m.current()?.pass).toBe("0/4");
  });
});

describe("AI masks: the fall back to LrDevelopController", () => {
  it("after a plugin error: takes the entry out, has Lightroom make the mask, then names it and sets its sliders", async () => {
    const { create } = await session();
    plugin.handlers.set("update_ai_settings", pluginError);
    const out = await create("subject", { name: "AVG her", sliders: { "local.shadows": 30 } });
    expect(out.json).toMatchObject({ ai: { route: "dc", switched_to_develop: true, fallback: expect.stringMatching(/update_ai_settings: dry: raised/) }, mask: { name: "AVG her", kind: "subject", sliders: { "local.shadows": 30 } } });
    expect(lr.history.slice(-3)).toEqual([`AVG ${SHORT} pass 1/4 mask create`, `AVG ${SHORT} pass 1/4 mask ai revert`, `AVG ${SHORT} pass 1/4 mask sliders`]);
    expect(masks()).toHaveLength(1);
    expect(masks()[0]).toMatchObject({ CorrectionName: "AVG her", LocalShadows2012: 0.3 });
  });

  it("goes to LrDevelopController when the plugin lacks update_ai_settings, and keeps that route for the session", async () => {
    const { create } = await session();
    lr.masks.tableRoute = "unavailable";
    expect((await create("background")).json).toMatchObject({ ai: { route: "dc", fallback: expect.stringMatching(/not available/) } });
    const updates = sent("update_ai_settings");
    expect((await create("sky")).json).toMatchObject({ ai: { route: "dc", fallback: expect.stringMatching(/skipped/) } });
    expect(sent("update_ai_settings")).toBe(updates);
    expect(masks()).toHaveLength(2);
  });

  it("FEATURE_UNAVAILABLE when neither route makes it, with nothing left written and the pass not used", async () => {
    const { m, create } = await session();
    lr.masks.tableRoute = "unavailable";
    lr.masks.dc = "unknown";
    const e = await fails(create("sky"));
    expect(e).toMatchObject({ code: "FEATURE_UNAVAILABLE", recoverable: true, details: { routes_tried: [{ route: "table" }, { route: "dc", why: expect.stringMatching(/plugin does not know it/) }], waited_ms: expect.any(Number) } });
    expect(masks()).toEqual([]);
    expect(e.message).toMatch(/showed this pass's attempts gone/);
    expect(m.current()?.pass).toBe("0/4");
  });

  it("takes only this pass's attempt out: a mask the user added meanwhile stays", async () => {
    const { create } = await session();
    plugin.handlers.set("update_ai_settings", (p, id) => {
      (lr.settings[MASK_TABLE_KEY] as Correction[]).push(structuredClone(captureTable[1] as Correction)); // the user's radial
      return pluginError(p, id);
    });
    const out = await create("sky");
    expect(out.json).toMatchObject({ ai: { route: "dc" } });
    expect(masks().map((e) => e["CorrectionName"])).toEqual(["Mask 2", "AVG Sky"]);
  });

  it("finds a Develop mask that showed after the plugin's wait, by reading the table", async () => {
    const { create } = await session();
    lr.masks.tableRoute = "unavailable";
    lr.masks.dc = "late";
    expect((await create("subject")).json).toMatchObject({ ai: { route: "dc" }, mask: { kind: "subject" } });
    expect(masks()).toHaveLength(1);
  });

  it("people and landscape have no Develop route: FEATURE_UNAVAILABLE without trying it", async () => {
    const { create } = await session();
    lr.masks.tableRoute = "unavailable";
    const e = await fails(create("landscape_vegetation"));
    expect(e).toMatchObject({ code: "FEATURE_UNAVAILABLE", details: { routes_tried: [{ route: "table" }, { route: "dc", why: expect.stringMatching(/none for this kind/) }] } });
    expect(sent("create_ai_mask_dc")).toBe(0);
    expect(masks()).toEqual([]);
  });
});
