// The mask tools on a cropped photo (GitHub issue #179) against the simulated Lightroom: geometry is given
// and listed in the preview's frame and written into the uncropped photo through the photo's crop
// (src/params/crop-frame.ts); a mask mostly outside the crop warns; a mirrored photo refuses geometry.
// Whether Lightroom places it so is [unverified] until `npm run masks:crop` (docs\reports\phase9\issue179.md).

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { ID, clean, fails, lr, manager, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const begin = () => manager.begin({ intent_id: "test_plain", return_image: "none", max_passes: 6 });
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const table = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const part = (i = 0): Record<string, number> => (table()[i]?.["CorrectionMasks"] as Array<Record<string, number>>)[0] as Record<string, number>;
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
    expect(await listed()).toEqual({ unavailable: expect.stringMatching(/^not shown: the photo's orientation is "BA"/) });
    const writes = lr.history.length;
    expect(await fails(manager.createMask({ ...pass, kind: "linear", geometry: FOREGROUND }))).toMatchObject({ code: "CROP_FRAME_UNSUPPORTED", message: expect.stringMatching(/Nothing was written/) });
    expect(lr.history.length).toBe(writes);
  });
});
