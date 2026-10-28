// The mask tools on a cropped photo (GitHub issue #179) against the simulated Lightroom: geometry is given
// and listed in the preview's frame and written into the uncropped photo through the photo's crop
// (src/params/crop-frame.ts); a mask mostly outside the crop warns; a mirrored photo refuses geometry.
// Whether Lightroom places it so is [unverified] until `npm run masks:crop` (docs\reports\phase9\issue179.md).

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, boxToView, cropFrame, toView, type Correction } from "../src/params/index.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { ID, clean, fails, lr, manager, newManager, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const begin = () => manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 6 });
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const table = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const part = (i = 0, j = 0): Record<string, number> => (table()[i]?.["CorrectionMasks"] as Array<Record<string, number>>)[j] as Record<string, number>;
/** DSC_0031's recorded crop (tests\fixtures\s10-rendered-dsc0031.json). */
const DSC0031 = { CropLeft: 0.008115, CropTop: 0.027339, CropRight: 0.942612, CropBottom: 0.961839, CropAngle: 0, orientation: "AB" };
const FOREGROUND = { zero: { x: 0.5, y: 0.64 }, full: { x: 0.5, y: 1 } };
const geometryOf = (out: { json: Record<string, unknown> }): Record<string, unknown> => (out.json["mask"] as { geometry: Record<string, unknown> }).geometry;
const listed = async (): Promise<Record<string, unknown> | undefined> => ((await manager.listMasks({ session_id: ID })).json["masks"] as Array<{ geometry?: Record<string, unknown> }>)[0]?.geometry;

describe("mask tools on a cropped photo (issue #179)", () => {
  it("writes the issue's foreground gradient into the crop, and lists it as written", async () => {
    clean();
    Object.assign(lr.settings, DSC0031);
    await begin();
    const out = await manager.createMask({ ...pass, kind: "linear", name: "AVG foreground", geometry: FOREGROUND, sliders: { "local.exposure": -0.25 } });
    const [t, b] = [DSC0031.CropTop, DSC0031.CropBottom];
    expect(part().ZeroY).toBeCloseTo(t + 0.64 * (b - t), 9);
    expect(part().FullY).toBeCloseTo(b, 9);
    expect(table()[0]?.["CorrectionReferenceY"]).toBeCloseTo(t + 0.82 * (b - t), 9); // the pin at the gradient's centre, in the photo
    expect(geometryOf(out)).toEqual(FOREGROUND);
    expect(await listed()).toEqual(FOREGROUND);
    expect(out.json["warnings"]).toBeUndefined();
  });

  it("writes a radial on an angled crop turned with it, reads it back as the box given, and keeps the rest of the box on an edit", async () => {
    clean();
    Object.assign(lr.settings, { ...DSC0031, CropAngle: 10 });
    await begin();
    const box = { left: 0.2, top: 0.3, right: 0.45, bottom: 0.5 };
    const out = await manager.createMask({ ...pass, kind: "radial", geometry: box, sliders: { "local.exposure": 1 } });
    expect(part().Angle).toBe(10);
    const g = geometryOf(out);
    for (const k of ["left", "top", "right", "bottom"] as const) expect(g[k]).toBeCloseTo(box[k], 6);
    const id = (out.json["mask"] as { id: string }).id;
    const edited = await manager.editMask({ ...pass, mask_id: id, geometry: { right: 0.6 } });
    const e = geometryOf(edited);
    for (const k of ["left", "top", "bottom"] as const) expect(e[k]).toBeCloseTo(box[k], 6);
    expect(e["right"]).toBeCloseTo(0.6, 6);
  });

  it("warns when a gradient lies mostly outside the crop, in the result and the session log", async () => {
    clean();
    Object.assign(lr.settings, { CropLeft: 0, CropTop: 0, CropRight: 1, CropBottom: 0.5, CropAngle: 0, orientation: "AB" });
    await begin();
    const out = await manager.createMask({ ...pass, kind: "linear", name: "AVG edge", geometry: { zero: { x: 0.5, y: 0.99 }, full: { x: 0.5, y: 1 } } });
    expect(out.json["warnings"]).toEqual([expect.stringMatching(/^99 % of mask "AVG edge" lies outside the preview/)]);
    expect(readLog().passes.at(-1)).toMatchObject({ kind: "mask", warnings: [expect.stringMatching(/AVG edge/)] });
  });

  it("refuses geometry on a mirrored photo before anything is written, and lists its masks without geometry", async () => {
    clean();
    Object.assign(lr.settings, { ...DSC0031, orientation: "BA", [MASK_TABLE_KEY]: structuredClone(captureTable) });
    await begin();
    expect(await listed()).toEqual({ unavailable: expect.stringMatching(/^not shown: the photo is mirrored \(orientation "BA"\)/) });
    const writes = lr.history.length;
    expect(await fails(manager.createMask({ ...pass, kind: "linear", geometry: FOREGROUND }))).toMatchObject({ code: "CROP_FRAME_UNSUPPORTED", message: expect.stringMatching(/Nothing was written/) });
    expect(lr.history.length).toBe(writes);
  });

  it.each([["uncropped", {}], ["cropped", DSC0031]])("keeps a turned radial of the user's on a feather-only edit, and refuses to move one side of it (%s)", async (_, crop) => {
    clean();
    Object.assign(lr.settings, crop);
    await begin();
    const id = ((await manager.createMask({ ...pass, kind: "radial", geometry: { left: 0.3, top: 0.2, right: 0.5, bottom: 0.6 } })).json["mask"] as { id: string }).id;
    const user = { Left: 0.3, Top: 0.2, Right: 0.5, Bottom: 0.6, Angle: 30 };
    Object.assign(part(), user); // drawn turned in Lightroom
    await manager.editMask({ ...pass, mask_id: id, geometry: { feather: 80 } });
    expect(part()).toMatchObject({ ...user, Feather: 80 });
    expect(await fails(manager.editMask({ ...pass, mask_id: id, geometry: { right: 0.7 } }))).toMatchObject({ code: "INVALID_ARGUMENTS", message: expect.stringMatching(/turned 30 degrees/) });
    expect(part()).toMatchObject(user);
  });

  it("writes a combined mask's added linear part through the crop", async () => {
    clean();
    Object.assign(lr.settings, DSC0031);
    await begin();
    const id = ((await manager.createMask({ ...pass, kind: "linear", geometry: FOREGROUND })).json["mask"] as { id: string }).id;
    await manager.editMask({ ...pass, mask_id: id, combine: { mode: "subtract", kind: "linear", geometry: { zero: { x: 0.5, y: 0.2 }, full: { x: 0.5, y: 0 } } } });
    const [t, b] = [DSC0031.CropTop, DSC0031.CropBottom];
    expect(part(0, 1).ZeroY).toBeCloseTo(t + 0.2 * (b - t), 9);
    expect(part(0, 1).FullY).toBeCloseTo(t, 9);
  });

  it("finds a person by a point of the preview, and gives the point and the people's boxes in the preview's frame", async () => {
    clean();
    Object.assign(lr.settings, DSC0031);
    const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const f = cropFrame(DSC0031, null);
    const right = toView(f, { x: 0.570312, y: 0.564706 }); // inside the sim's second person, in the photo
    const out = await m.createMask({ ...pass, kind: "person_entire", point: right });
    expect(out.json).toMatchObject({ ai: { instance: 1 }, mask: { instance: 1 } });
    const [x, y] = String(part()["ReferencePoint"]).split(" ").map(Number);
    expect([x, y]).toEqual([expect.closeTo(0.570312, 5), expect.closeTo(0.564706, 5)]);
    const shown = boxToView(f, { left: 0.156001, top: 0.374479, right: 0.532342, bottom: 0.785937 });
    expect((out.json["mask"] as { people: Array<{ left: number }> }).people[0]?.left).toBeCloseTo(shown.left, 6);
    const e = await fails(m.createMask({ ...pass, kind: "person_face_skin", point: { x: 0.95, y: 0.1 } }));
    expect(e).toMatchObject({ code: "MASK_NOTHING_FOUND", details: { point: { x: expect.closeTo(0.95, 6), y: expect.closeTo(0.1, 6) }, people: [{ left: expect.closeTo(shown.left, 6) }, expect.any(Object)] } });
  });

  it("writes and lists a gradient on a portrait photo Lightroom turns a quarter (BC)", async () => {
    clean();
    Object.assign(lr.settings, { CropLeft: 0, CropTop: 0, CropRight: 1, CropBottom: 1, CropAngle: 0, orientation: "BC" });
    await begin();
    await manager.createMask({ ...pass, kind: "linear", geometry: FOREGROUND });
    expect(part()).toMatchObject({ ZeroX: 0.64, ZeroY: 0.5, FullX: 1, FullY: 0.5 });
    expect(await listed()).toEqual(FOREGROUND);
  });
});
