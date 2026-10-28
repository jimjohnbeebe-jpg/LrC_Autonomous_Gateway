// Colour range, depth range and brush masks (issue #190; params\mask-range.ts, mask-brush.ts): their stored
// form against Jim's hand-made ones (docs\reports\phase8.5\mask-carry), the checks, and the read-back.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cropFrame } from "../src/params/crop-frame.js";
import { COLOR_SAMPLE_NEEDED, applyOp, precheck } from "../src/params/mask-ops.js";
import { depthMapMissing } from "../src/params/mask-range.js";
import { summarize } from "../src/params/mask-summary.js";
import { BRUSH, C, M, MASK_TABLE_KEY, RANGE, WHAT, componentKind, untrusted, verifyTable, type Component, type Correction } from "../src/params/mask-table.js";

const carry = JSON.parse(readFileSync(fileURLToPath(new URL("../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json", import.meta.url)), "utf8")) as Record<string, unknown>;
/** Every correction anywhere in the capture. */
const handMade: Correction[] = [];
(function walk(v: unknown): void {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === "object") {
    if ((v as Record<string, unknown>)[C.what] === "Correction") handMade.push(v as Correction);
    else Object.values(v).forEach(walk);
  }
})(carry);
const partOf = (e: Correction): Component => (e[C.masks] as Component[])[0] as Component;
const byName = (name: string): Component => partOf(handMade.find((e) => (partOf(e)[M.name] as string | undefined) === name) as Correction);
const keys = (o: object): string[] => Object.keys(o).sort();

const create = (kind: string, extra: Record<string, unknown> = {}) => applyOp([], { op: "create", kind, ...extra } as never);
const made = (kind: string, extra: Record<string, unknown> = {}): Component => partOf(create(kind, extra).entries[0] as Correction);
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as { code: string }).code;
  }
  return "no error";
};
const readBack = (entries: Correction[]) => ({ [MASK_TABLE_KEY]: structuredClone(entries) });

describe("colour range", () => {
  it("is written in the form of Jim's hand-made Color Range, one sample, pinned at its point", () => {
    const mine = made("color_range", { point: { x: 0.25, y: 0.75 }, geometry: { sample: { l: 0.9, a: 0.4, b: 0.1 }, color_amount: 0.3 } });
    const his = byName("Color Range 1");
    expect(keys(mine)).toEqual(keys(his));
    expect(keys(mine[RANGE.holder] as object)).toEqual(keys(his[RANGE.holder] as object));
    expect(mine[RANGE.holder]).toMatchObject({ [RANGE.type]: 1, [RANGE.pointModels]: ["0.900000 0.400000 0.100000 0.250000 0.750000 0"], [RANGE.colorAmount]: 0.3 });
    const e = create("color_range", { point: { x: 0.25, y: 0.75 }, geometry: { sample: { l: 0.5, a: 0.5, b: 0.5 } } }).entries[0] as Correction;
    expect([e[C.refX], e[C.refY]]).toEqual([0.25, 0.75]);
    expect(componentKind(mine)).toBe("color_range");
    expect(untrusted(mine)).toBeNull();
    expect(summarize(e).geometry).toMatchObject({ point: { x: 0.25, y: 0.75 }, color_amount: 0.5 });
  });

  it("needs a point and a sample (none from the preview: COLOR_SAMPLE_NEEDED), and refuses an amount outside [0, 1] (0 as Lightroom stores it on Jim's Reds; the tool schema asks more than 0)", () => {
    const sample = { l: 0.5, a: 0.5, b: 0.5 };
    expect(codeOf(() => precheck({ op: "create", kind: "color_range", geometry: { sample } }))).toBe("INVALID_ARGUMENTS");
    expect(() => precheck({ op: "create", kind: "color_range", point: { x: 0.5, y: 0.5 } })).toThrow(COLOR_SAMPLE_NEEDED);
    expect(COLOR_SAMPLE_NEEDED).toMatch(/copy_sample_from.*geometry\.sample/);
    expect(codeOf(() => create("color_range", { point: { x: 0.5, y: 0.5 }, geometry: { sample, color_amount: 1.5 } }))).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => create("color_range", { point: { x: 0.5, y: 0.5 }, geometry: { sample, color_amount: 0 } }))).toBe("no error");
  });
});

describe("depth range", () => {
  it("is a Type -1 range with a DepthRange trapezoid, and refuses everything-ranges and thin bands", () => {
    const m = made("depth_range", { geometry: { depth_range: [0, 0.1, 0.3, 0.5] } });
    expect(m[RANGE.holder]).toMatchObject({ [RANGE.type]: -1, [RANGE.depthRange]: "0.000000 0.100000 0.300000 0.500000" });
    expect(componentKind(m)).toBe("depth_range");
    expect(untrusted(m)).not.toBeNull(); // not captured: create and delete only
    for (const r of [[0, 0, 1, 1], [0, 0.2, 0.205, 0.5], [0.5, 0.4, 0.6, 0.7]]) expect(codeOf(() => create("depth_range", { geometry: { depth_range: r } })), String(r)).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => create("luminance", { geometry: { lum_range: [0, 0.2, 0.205, 1] } }))).toBe("INVALID_ARGUMENTS"); // the same helper
  });

  it("reads a photo without a depth map from the missing depth sample", () => {
    const entries = create("depth_range", { geometry: { depth_range: [0, 0.1, 0.3, 0.5] } }).entries;
    const id = String((entries[0] as Correction)[C.id]);
    expect(depthMapMissing(entries, id)).toBe(true);
    Object.assign(partOf(entries[0] as Correction)[RANGE.holder] as object, { [RANGE.sampleInfo]: "0 0.5 0.5" });
    expect(depthMapMissing(entries, id)).toBe(false);
  });
});

describe("brush", () => {
  const stroke = { points: [{ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.5 }] };

  it("is an Aggregate of one Paint per stroke, with the fields of Jim's hand-made Brush 1", () => {
    const m = made("brush", { geometry: { strokes: [stroke, { ...stroke, flow: 0.5 }] } });
    const his = byName("Brush 1");
    expect(m[M.what]).toBe(WHAT.aggregate);
    expect(keys(m)).toEqual(keys(his));
    const paints = m[BRUSH.masks] as Component[];
    expect(paints).toHaveLength(2);
    expect(keys(paints[0] as object)).toEqual(keys((his[BRUSH.masks] as Component[])[0] as object));
    const dabs = (paints[0] as Component)[BRUSH.dabs] as string[];
    expect(dabs[0]).toBe("d 0.100000 0.500000");
    expect(dabs.at(-1)).toBe("d 0.300000 0.500000");
    expect(dabs.length).toBe(17); // 0.2 apart at most radius / 4 = 0.0125: 16 steps
    expect(((paints[1] as Component)[BRUSH.dabs] as string[])[0]).toBe("f 0.5000");
    expect(componentKind(m)).toBe("brush");
    expect(untrusted(m)).toBeNull();
  });

  it("maps the strokes through the photo's crop", () => {
    const frame = cropFrame({ CropLeft: 0.5, CropTop: 0, CropRight: 1, CropBottom: 1 }, null);
    const m = partOf(applyOp([], { op: "create", kind: "brush", geometry: { strokes: [{ points: [{ x: 0, y: 0.5 }] }] } } as never, frame).entries[0] as Correction);
    expect(((m[BRUSH.masks] as Component[])[0] as Component)[BRUSH.dabs]).toEqual(["d 0.500000 0.500000"]);
  });

  it("refuses no strokes, empty strokes, points off the preview and strokes over the dab cap", () => {
    for (const strokes of [undefined, [], [{ points: [] }], [{ points: [{ x: 1.2, y: 0 }] }], [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], radius: 0.001 }]]) {
      expect(codeOf(() => create("brush", { geometry: { strokes } })), JSON.stringify(strokes)).toBe("INVALID_ARGUMENTS");
    }
  });

  it("reads back taken when Lightroom adds its own r, f and h tokens, and not when a dab moved", () => {
    const entries = create("brush", { geometry: { strokes: [stroke] } }).entries;
    const back = readBack(entries);
    const paint = (partOf((back[MASK_TABLE_KEY] as Correction[])[0] as Correction)[BRUSH.masks] as Component[])[0] as Component;
    paint[BRUSH.dabs] = ["r 0.050000", "f 1.0000", "h 0.3629", ...(paint[BRUSH.dabs] as string[])];
    expect(verifyTable(entries, back)).toEqual([]);
    (paint[BRUSH.dabs] as string[])[4] = "d 0.9 0.9";
    expect(verifyTable(entries, back)).not.toEqual([]);
  });
});

describe("edits of the new kinds", () => {
  it("renames, hides and inverts a colour range or a brush, and refuses reshaping either", () => {
    const entries = create("brush", { geometry: { strokes: [{ points: [{ x: 0.2, y: 0.2 }] }] } }).entries;
    const id = String((entries[0] as Correction)[C.id]);
    const out = applyOp(entries, { op: "edit", mask_id: id, inverted: true, active: false });
    expect(partOf(out.entries[0] as Correction)[M.inverted]).toBe(true);
    expect(codeOf(() => applyOp(entries, { op: "edit", mask_id: id, geometry: { strokes: [] } }))).toBe("INVALID_ARGUMENTS");
  });
});
