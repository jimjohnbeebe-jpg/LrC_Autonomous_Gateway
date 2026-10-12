// Masks the tools cannot write themselves are carried (issue #121): a mask pass writes the photo's whole
// table, and the user's own masks beside the one it changes go back unchanged. Only the mask a call names
// is checked: editing an uncaptured one is refused, deleting it is allowed [stated: Jim, 2026-10-11, "Go"
// on docs\reports\phase8.5\mask-carry.md and "Allow"]. Against the Lightroom sim, which keeps a written
// table verbatim except a radial's Flipped (tests\helpers\lightroom-sim-masks.ts flipRadials), already
// Lightroom's own in the entry below.

import { describe, expect, it } from "vitest";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { ID, clean, fails, lr, manager, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

/**
 * Jim's "Add" mask, made by hand in Lightroom: a linear plus a radial in one correction, read back unchanged
 * twice beside a new radial [handle: docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json
 * `table_before[0]`, commit 4cd95aa].
 */
const ADD: Correction = {
  What: "Correction", CorrectionID: "12CCAD35-D822-4624-B14E-B672AE64048F",
  CorrectionMasks: [
    { What: "Mask/Gradient", FullY: 0.005944, MaskValue: 1, FullX: 0.473447, MaskInverted: false, MaskSyncID: "DED433F675575D47B73A2865A55F3F6C", MaskBlendMode: 0, MaskID: "8D091A1D-6F70-4BF4-854C-53A1D3254A84", ZeroX: 0.473118, MaskName: "Linear Gradient 1", MaskActive: true, ZeroY: 0.486962 },
    { What: "Mask/CircularGradient", MaskValue: 1, Right: 0.762243, Left: 0.225905, MaskInverted: false, MaskSyncID: "5EF0432793D8E043BBBEB99F814F11A9", MaskBlendMode: 0, Roundness: 0, Angle: 0, Feather: 25, Midpoint: 50, Flipped: true, Version: 2, Bottom: 1.03685, Top: 0.307317, MaskName: "Radial Gradient 1", MaskActive: true, MaskID: "D2904081-42B5-462D-9A9B-F725A4A7B49B" },
  ],
  LocalHighlights2012: 0, LocalSaturation: 0, CorrectionAmount: 1, LocalTint: 0, LocalExposure2012: 0.25, LocalToningSaturation: 0, CorrectionName: "Add", CorrectionReferenceY: 0.246453,
  LocalSharpness: 0, LocalDefringe: 0, LocalDehaze: 0, LocalExposure: 0, CorrectionActive: true, LocalLuminanceNoise: 0, CorrectionReferenceX: 0.473282, LocalWhites2012: 0, LocalHue: 0,
  LocalBlacks2012: 0, LocalClarity2012: 0, LocalContrast: 0, CorrectionSyncID: "1F443D4193290044B818EBE7E34B3749", LocalBrightness: 0, LocalContrast2012: 0, LocalCurveRefineSaturation: 100,
  LocalShadows2012: 0, LocalGrain: 0, LocalTemperature: 0, LocalMoire: 0, LocalToningHue: 0, LocalClarity: 0, LocalTexture: 0,
};
const ADD_ID = String(ADD["CorrectionID"]);
const RADIAL = captureTable[1] as Correction;
const RADIAL_ID = String(RADIAL["CorrectionID"]);

const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };
const LINEAR = { kind: "linear", name: "AVG bottom", geometry: { zero: { x: 0.5, y: 0.67 }, full: { x: 0.5, y: 0.9 } }, sliders: { "local.exposure": 1 } };

async function beginWithAdd(): Promise<void> {
  clean();
  lr.settings[MASK_TABLE_KEY] = [structuredClone(ADD), structuredClone(RADIAL)];
  await manager.begin({ intent_id: "test_plain", return_image: "none" });
}

describe("mask tools: the user's own masks are carried (issue #121)", () => {
  it("edits the sliders of Jim's hand-made Add, a verified form (issue #131), and keeps its parts as they were", async () => {
    await beginWithAdd();
    const out = await manager.editMask({ ...pass, mask_id: ADD_ID, sliders: { "local.exposure": 0.5 } });
    expect(out.json).toMatchObject({ pass: "1/4", mask: { id: ADD_ID, kind: "mixed", parts: [{ kind: "linear", inverted: false }, { kind: "radial", mode: "add", inverted: false }] } });
    expect(masks()[0]?.["CorrectionMasks"]).toEqual(ADD["CorrectionMasks"]);
  });

  it("creates a mask beside a mask of two components, which reads back unchanged; lr_step never sends the table", async () => {
    await beginWithAdd();
    expect(((await manager.listMasks({ session_id: ID })).json["masks"] as Array<{ kind: string }>).map((m) => m.kind)).toEqual(["mixed", "radial"]);
    const out = await manager.createMask({ ...pass, ...LINEAR });
    expect(out.json).toMatchObject({ pass: "1/4", op: "create", mask: { name: "AVG bottom", kind: "linear" } });
    expect(masks()).toHaveLength(3);
    expect(masks()[0]).toEqual(ADD);
    expect(masks()[1]).toEqual(RADIAL);
    await manager.step({ session_id: ID, settings: { exposure: 0.1 }, rationale: "test", return_image: "none" });
    const sent = plugin.received.filter((r) => r.name === "apply_settings").map((r) => Object.keys(r.payload["settings"] as object));
    expect(sent.at(-1)).not.toContain(MASK_TABLE_KEY);
  });

  it("refuses an edit of the uncaptured mask, edits the radial beside it, and deletes the uncaptured mask", async () => {
    await beginWithAdd();
    // A radial first is not a verified form (params\mask-combine.ts VERIFIED_FORMS); Jim's own "linear, add radial" is (issue #131).
    const parts = ((lr.settings[MASK_TABLE_KEY] as Correction[])[0] as Correction)["CorrectionMasks"] as Array<Record<string, unknown>>;
    parts[0] = structuredClone(parts[1]) as Record<string, unknown>;
    const writes = lr.history.length;
    expect(await fails(manager.editMask({ ...pass, mask_id: ADD_ID, sliders: { "local.exposure": 0.5 } }))).toMatchObject({
      code: "MASKS_UNCAPTURED_KIND",
      recoverable: false,
      message: expect.stringMatching(/the mask the call names, "Add".*"radial, add radial"/),
    });
    expect(lr.history.length).toBe(writes);
    expect(manager.current()?.pass).toBe("0/4");
    const edited = await manager.editMask({ ...pass, mask_id: RADIAL_ID, sliders: { "local.exposure": 0.5 } });
    expect(edited.json).toMatchObject({ pass: "1/4", mask: { id: RADIAL_ID, sliders: { "local.exposure": 0.5 } } });
    expect(masks()[0]?.["CorrectionMasks"]).toEqual([parts[1], parts[1]]);
    const deleted = await manager.deleteMask({ ...pass, mask_id: ADD_ID });
    expect(deleted.json).toMatchObject({ pass: "2/4", op: "delete", deleted: true });
    expect(masks().map((e) => e["CorrectionID"])).toEqual([RADIAL_ID]);
  });

  it("creates beside a mask of two components and deletes it: the other two entries remain", async () => {
    await beginWithAdd();
    await manager.createMask({ ...pass, ...LINEAR });
    await manager.deleteMask({ ...pass, mask_id: ADD_ID });
    expect(masks()).toHaveLength(2);
    expect(masks()[0]).toEqual(RADIAL);
    expect(masks()[1]).toMatchObject({ CorrectionName: "AVG bottom" });
  });
});
