// Issue #217 row 5: brush feather, density, erase and strokes added to a brush (params\mask-brush.ts). The feather
// curve is upstream's [upstream claim: Automaat/lightroom-mcp BrushFeather.lua at 1040453]; Lightroom's own brush is
// the one Jim painted [handle: docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json "Brush"],
// whose strokes carry CenterWeight 0.362855 and the dab token "h 0.3629".

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOp, MASK_TABLE_KEY, verifyTable, type Correction } from "../src/params/index.js";
import { brushFields, featherOf, type Stroke } from "../src/params/mask-brush.js";
import { IDENTITY } from "../src/params/crop-frame.js";
import { ID, clean, lr, newManager, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const carry = JSON.parse(readFileSync(new URL("../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json", import.meta.url), "utf8")) as { table_before: Correction[] };
const brush = (): Correction => structuredClone(carry.table_before.find((e) => e["CorrectionName"] === "Brush") as Correction);
type Paint = Record<string, unknown> & { Dabs: string[] };
const paints = (e: Correction | undefined): Paint[] => ((e?.["CorrectionMasks"] as Array<Record<string, unknown>>)[0]?.["Masks"] as Paint[]) ?? [];
const line: Stroke = { points: [{ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }] };

describe("feather", () => {
  it("follows upstream's samples at their points and between them", () => {
    expect(featherOf(1)).toEqual({ scale: 1, centerWeight: 0 });
    expect(featherOf(0)).toEqual({ scale: 0.392053, centerWeight: 1 });
    expect(featherOf(0.5)).toEqual({ scale: 0.656012, centerWeight: 0.16214 });
    const mid = featherOf(0.525);
    expect(mid.scale).toBeCloseTo((0.656012 + 0.707956) / 2, 6);
    expect(mid.centerWeight).toBeCloseTo((0.16214 + 0.131575) / 2, 6);
  });

  it("writes feather 100 as before (scale 1, CenterWeight 0, no h token), and a harder brush with a smaller radius and an h token", () => {
    const [soft, hard] = brushFields([line, { ...line, radius: 0.1, feather: 50 }], IDENTITY)["Masks"] as Paint[];
    expect(soft).toMatchObject({ Radius: 0.05, CenterWeight: 0, MaskValue: 1 });
    expect(soft?.Dabs.some((t) => t.startsWith("h "))).toBe(false);
    expect(hard).toMatchObject({ Radius: 0.065601, CenterWeight: 0.16214 });
    expect(hard?.Dabs[0]).toBe("h 0.1621");
  });

  it("puts f before h, as Lightroom's own stroke does", () => {
    const [p] = brushFields([{ ...line, flow: 0.584, feather: 30 }], IDENTITY)["Masks"] as Paint[];
    const own = paints(brush())[0] as Paint;
    expect(own.Dabs.filter((t) => /^[fh] /.test(t)).map((t) => t[0])).toEqual(["f", "h"]);
    expect(p?.Dabs.slice(0, 2).map((t) => t[0])).toEqual(["f", "h"]);
  });
});

describe("density and erase", () => {
  it("writes density as the stroke's MaskValue and an erase stroke as 0", () => {
    const ps = brushFields([line, { ...line, density: 0.4 }, { ...line, erase: true }, { ...line, density: 0 }], IDENTITY)["Masks"] as Paint[];
    expect(ps.map((p) => p["MaskValue"])).toEqual([1, 0.4, 0, 0]);
  });

  it("refuses erase with a density, feather out of range, and a new brush of erase strokes only", () => {
    expect(() => brushFields([{ ...line, erase: true, density: 0.5 }], IDENTITY)).toThrow(/takes no density/);
    expect(() => brushFields([{ ...line, feather: 101 }], IDENTITY)).toThrow(/feather/);
    expect(() => brushFields([{ ...line, erase: true }], IDENTITY)).toThrow(/needs a stroke that paints/);
  });
});

describe("strokes added to a brush", () => {
  it("adds them after Lightroom's own strokes, which stay as stored, and the read-back takes the table", () => {
    const b = brush();
    const plan = applyOp([b], { op: "edit", mask_id: String(b["CorrectionID"]), geometry: { strokes: [{ ...line, erase: true }] } });
    const after = paints(plan.entries[0]);
    expect(after.slice(0, 2)).toEqual(paints(b));
    expect(after).toHaveLength(3);
    expect(after[2]).toMatchObject({ What: "Mask/Paint", MaskValue: 0 });
    expect(verifyTable(plan.entries, { [MASK_TABLE_KEY]: structuredClone(plan.entries) })).toEqual([]);
  });

  it("refuses a brush Lightroom stored compressed (no Masks)", () => {
    const b = brush();
    const part = (b["CorrectionMasks"] as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    delete part["Masks"];
    expect(() => applyOp([b], { op: "edit", mask_id: String(b["CorrectionID"]), geometry: { strokes: [line] } })).toThrow(/compressed/);
  });

  it("is one session pass on the sim", async () => {
    clean();
    const b = brush();
    lr.settings[MASK_TABLE_KEY] = [b];
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const out = await m.editMask({ session_id: ID, rationale: "test", return_image: "none", mask_id: String(b["CorrectionID"]), geometry: { strokes: [{ ...line, feather: 0 }] } });
    expect(out.json).toMatchObject({ pass: "1/4", mask: { kind: "brush", geometry: { strokes: 3 } } });
    expect(paints((lr.settings[MASK_TABLE_KEY] as Correction[])[0])[2]).toMatchObject({ CenterWeight: 1, Radius: 0.019603 });
  });
});
