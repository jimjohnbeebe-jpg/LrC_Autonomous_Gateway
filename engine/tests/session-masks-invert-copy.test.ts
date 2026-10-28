// Issue #217 row 2: lr_edit_mask `copy: true` with `inverted: true` (params\mask-copy.ts), in a session against the
// Lightroom sim. The masks copied are Lightroom's own where a capture has one: the hand-painted brush and the colour
// range [handle: docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json `table_before`]. What
// Lightroom makes of a copy is Jim's `npm run masks:parity`.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOp, MASK_TABLE_KEY, precheck, readTable, type Correction } from "../src/params/index.js";
import { ID, clean, fails, lr, newManager, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const carry = JSON.parse(readFileSync(new URL("../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json", import.meta.url), "utf8")) as { table_before: Correction[] };
const named = (n: string): Correction => structuredClone(carry.table_before.find((e) => e["CorrectionName"] === n) as Correction);
const masks = (): Correction[] => (lr.settings[MASK_TABLE_KEY] ?? []) as Correction[];
const partOf = (e: Correction | undefined): Record<string, unknown> => ((e?.["CorrectionMasks"] as Array<Record<string, unknown>>)[0] ?? {});
const pass = { session_id: ID, rationale: "test", return_image: "none" as const };

async function session(table: Correction[]) {
  clean();
  lr.settings[MASK_TABLE_KEY] = table;
  const m = newManager({ aiTimings: { computeMs: 300, dcWaitMs: 300, pollMs: 10, pollMaxMs: 20 } });
  await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 6 });
  return m;
}

describe("an inverted copy of a mask, pure", () => {
  it("clones Lightroom's brush with fresh ids for the correction, its part and every stroke, inverted, after the other masks", () => {
    const brush = named("Brush");
    const plan = applyOp([brush], { op: "edit", mask_id: String(brush["CorrectionID"]), inverted: true, copy: true, sliders: { "local.exposure": -1 } });
    const [orig, copy] = plan.entries as [Correction, Correction];
    expect(orig).toEqual(brush);
    expect(copy["CorrectionName"]).toBe("Brush inverted");
    expect(copy["LocalExposure2012"]).toBe(-0.25);
    const [a, b] = [partOf(brush), partOf(copy)];
    expect(b["MaskInverted"]).toBe(true);
    const ids = (c: Correction, p: Record<string, unknown>) => [c["CorrectionID"], c["CorrectionSyncID"], p["MaskID"], p["MaskSyncID"], ...(p["Masks"] as Array<Record<string, unknown>>).flatMap((s) => [s["MaskID"], s["MaskSyncID"]])];
    const [was, now] = [ids(brush, a), ids(copy, b)];
    expect(now.filter((id) => was.includes(id))).toEqual([]);
    expect((b["Masks"] as Array<Record<string, unknown>>).map((s) => s["Dabs"])).toEqual((a["Masks"] as Array<Record<string, unknown>>).map((s) => s["Dabs"]));
    expect(plan).toMatchObject({ id: copy["CorrectionID"], before: null, after: { name: "Brush inverted", inverted: true } });
    expect(plan.ai).toBeUndefined();
  });

  it("drops the computed fields of an AI part and names its kind, so Lightroom computes it afresh", () => {
    const sky = { What: "Correction", CorrectionID: "SKY", CorrectionName: "Sky", CorrectionMasks: [{ What: "Mask/Image", MaskID: "M", MaskSyncID: "S", MaskInverted: false, MaskSubType: 2, MaskVersion: 1, ReferencePoint: "0.500000 0.500000", ErrorReason: 0, MaskDigest: "D", InputDigest: "I", ModelVersion: 1, Origin: "0,0", FullMaskSize: "1 1", WholeImageArea: "1 1" }] } as unknown as Correction;
    const plan = applyOp([sky], { op: "edit", mask_id: "SKY", inverted: true, copy: true });
    const part = partOf(plan.entries[1]);
    expect(plan.ai).toBe("sky");
    expect(Object.keys(part).sort()).toEqual(["ErrorReason", "MaskID", "MaskInverted", "MaskSubType", "MaskSyncID", "MaskVersion", "ReferencePoint", "What"]);
    expect(part["MaskInverted"]).toBe(true);
  });

  it("refuses a copy without inverted: true, with a reshape, and of a mask of several parts", () => {
    expect(() => precheck({ op: "edit", mask_id: "X", copy: true })).toThrow(/inverted: true/);
    expect(() => precheck({ op: "edit", mask_id: "X", copy: true, inverted: true, geometry: { left: 0 } })).toThrow(/not geometry/);
    const add = named("Add");
    expect(() => applyOp([add], { op: "edit", mask_id: String(add["CorrectionID"]), inverted: true, copy: true })).toThrow(/one part only/);
  });
});

describe("an inverted copy in a session", () => {
  it("is one pass that keeps the colour range and adds its inverted copy, carried masks checked on read-back", async () => {
    const color = named("Color");
    const m = await session([named("Brush"), color]);
    const out = await m.editMask({ ...pass, mask_id: String(color["CorrectionID"]), inverted: true, copy: true, name: "Not the red" });
    expect(out.json).toMatchObject({ pass: "1/6", op: "edit", mask: { name: "Not the red", inverted: true } });
    expect(masks().map((e) => e["CorrectionName"])).toEqual(["Brush", "Color", "Not the red"]);
    expect(masks()[1]).toEqual(color);
    expect(readTable(lr.settings)[2]?.["CorrectionID"]).toBe((out.json["mask"] as { id: string }).id);
  });

  it("computes the copy of an AI mask, and takes the copy out when Lightroom finds nothing", async () => {
    const m = await session([]);
    const sky = (await m.createMask({ ...pass, kind: "sky", name: "AVG sky" })).json["mask"] as { id: string };
    const copied = await m.editMask({ ...pass, mask_id: sky.id, inverted: true, copy: true });
    expect(copied.json).toMatchObject({ pass: "2/6", mask: { name: "AVG sky inverted", inverted: true } });
    expect(masks()).toHaveLength(2);
    lr.masks.tableRoute = "absent";
    const e = await fails(m.editMask({ ...pass, mask_id: sky.id, inverted: true, copy: true, name: "second" }));
    expect(e).toMatchObject({ code: "MASK_NOTHING_FOUND" });
    expect(masks().map((x) => x["CorrectionName"])).toEqual(["AVG sky", "AVG sky inverted"]);
  });
});
