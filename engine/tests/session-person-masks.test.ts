// One person's mask by instance (src/session/person-masks.ts; GitHub issue #59, PR C step 2c) against the
// simulated Lightroom (helpers/lightroom-sim-masks.ts, capture 4's two people by default): the probe, the
// person picked by the point, the wanted entry written with that instance, no person at the point, no person
// in the photo, and Lightroom changing the entry.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import type { FakeHandler } from "./helpers/fake-plugin.js";
import { ID, SHORT, clean, fails, lr, newManager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const component = (e: Correction | undefined): Record<string, unknown> => ((e?.["CorrectionMasks"] as Record<string, unknown>[] | undefined) ?? [])[0] ?? {};
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;
const RIGHT = { x: 0.570312, y: 0.564706 }; // Jim's click on the right person in capture 4
const LEFT = { x: 0.375, y: 0.661765 };

async function session() {
  clean();
  const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
  await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
  const create = (kind: string, point: { x: number; y: number }, extra: Record<string, unknown> = {}) =>
    m.createMask({ session_id: ID, rationale: "test", return_image: "none", kind, point, ...extra });
  return { m, create };
}

describe("one person's mask, by instance", () => {
  it("Entire Person of the right person: the probe finds the people, the entry is written with instance 1", async () => {
    const { create } = await session();
    const out = await create("person_entire", RIGHT);
    expect(out.json).toMatchObject({ pass: "1/4", ai: { route: "table", instance: 1, people: [expect.any(Object), expect.any(Object)] }, mask: { kind: "person_entire", instance: 1, computed: true } });
    expect(masks()).toHaveLength(1);
    expect(component(masks()[0])).toMatchObject({ MaskSubType: 0, MaskSubCategoryID: 20036, InstanceIDs: [{ InstanceID: 1 }], ReferencePoint: "0.570312 0.564706" });
    expect(lr.history.slice(-2)).toEqual([`AVG ${SHORT} pass 1/4 mask create`, `AVG ${SHORT} pass 1/4 mask person`]);
    expect(sent("update_ai_settings")).toBe(2);
    expect(readLog().passes.at(-1)?.mask).toMatchObject({ kind: "person_entire", after: { instance: 1 }, ai: { instance: 1 } });
  });

  it("Entire Person of the left person: the probe is the mask (instance 0), one write", async () => {
    const { create } = await session();
    expect((await create("person_entire", LEFT)).json).toMatchObject({ ai: { instance: 0 }, mask: { instance: 0 } });
    expect(sent("update_ai_settings")).toBe(1);
    expect(lr.history.at(-1)).toBe(`AVG ${SHORT} pass 1/4 mask create`);
  });

  it("a part of one person: the part's category with the person's instance; lr_list_masks shows the person and the boxes", async () => {
    const { m, create } = await session();
    expect((await create("person_hair", RIGHT, { sliders: { "local.saturation": -20 } })).json).toMatchObject({ mask: { kind: "person_hair", instance: 1, sliders: { "local.saturation": -20 } } });
    expect(component(masks()[0])).toMatchObject({ MaskSubType: 0, MaskSubCategoryID: 5, InstanceIDs: [{ InstanceID: 1 }] });
    const listed = (await m.listMasks({ session_id: ID })).json["masks"] as Array<Record<string, unknown>>;
    expect(listed[0]).toMatchObject({ kind: "person_hair", instance: 1, people: [{ left: 0.156001 }, { left: 0.349014 }] });
  });

  it("no person at the point: MASK_NOTHING_FOUND with every person's box, the probe taken out, no pass used", async () => {
    const { m, create } = await session();
    const e = await fails(create("person_face_skin", { x: 0.95, y: 0.1 }));
    expect(e).toMatchObject({ code: "MASK_NOTHING_FOUND", recoverable: true, details: { people: [expect.any(Object), expect.any(Object)], point: { x: 0.95, y: 0.1 } } });
    expect(e.message).toMatch(/^No person at the point \(0\.95, 0\.1\): Lightroom found 2 people \(person 0: left 0\.156/);
    expect(masks()).toEqual([]);
    expect(m.current()?.pass).toBe("0/4");
  });

  it("no person in the photo: Lightroom's ErrorReason, MASK_NOTHING_FOUND", async () => {
    const { create } = await session();
    lr.masks.people = [];
    expect(await fails(create("person_entire", RIGHT))).toMatchObject({ code: "MASK_NOTHING_FOUND", details: { error_reason: 1 } });
    expect(masks()).toEqual([]);
  });

  it("Lightroom changing the entry into another kind is a failure: the mask is taken out, no fallback", async () => {
    const { create } = await session();
    lr.masks.personDrift = true;
    const e = await fails(create("person_entire", RIGHT));
    expect(e).toMatchObject({ code: "FEATURE_UNAVAILABLE", details: { routes_tried: [{ route: "table", why: expect.stringMatching(/MaskSubType 3, category 13, instance null/) }, { route: "dc", why: expect.stringMatching(/none for this kind/) }] } });
    expect(masks()).toEqual([]);
  });

  it("a probe that Lightroom gave the person at the point is the mask: one write, any instance accepted", async () => {
    const { create } = await session();
    lr.masks.instanceFromPoint = true;
    expect((await create("person_entire", RIGHT)).json).toMatchObject({ ai: { instance: 1 }, mask: { instance: 1 } });
    expect(sent("update_ai_settings")).toBe(1);
    expect(component(masks()[0])).toMatchObject({ MaskSubCategoryID: 20036, InstanceIDs: [{ InstanceID: 1 }] });
  });

  it("keeps the probe's own times in the log when the wanted entry is written after it", async () => {
    const { create } = await session();
    await create("person_hair", RIGHT);
    expect(readLog().passes.at(-1)?.mask?.ai).toMatchObject({ probe: { update_ms: expect.any(Number), computed_ms: expect.any(Number) }, update_ms: expect.any(Number) });
  });

  it("a failed write of the wanted entry leaves nothing behind: the probe is taken out", async () => {
    const { create } = await session();
    const real = plugin.handlers.get("apply_settings") as FakeHandler;
    plugin.handlers.set("apply_settings", (p, id) =>
      String(p["history_name"]).endsWith("mask person") ? { ok: false, error: { code: "write_failed", message: "dry: refused", recoverable: false } } : real(p, id),
    );
    const e = await fails(create("person_hair", RIGHT));
    expect(e.details).toMatchObject({ routes_tried: [{ route: "table", why: expect.stringMatching(/writing the person mask of person 1 failed: dry: refused/) }, { route: "dc" }] });
    expect(masks()).toEqual([]);
  });

  it("the wanted entry changed by Lightroom once computed is a failure too, and taken out", async () => {
    const { create } = await session();
    lr.masks.personDrift = "wanted";
    const e = await fails(create("person_hair", RIGHT));
    expect(e.details).toMatchObject({ routes_tried: [{ route: "table", why: expect.stringMatching(/not person_hair of person 1/) }, { route: "dc" }] });
    expect(masks()).toEqual([]);
  });
});
