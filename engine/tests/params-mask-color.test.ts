// A colour range's sample (issue #210; params\mask-range.ts): Lightroom-authored triples read back as l, a, b and
// copied verbatim (copy_sample_from, Automaat PR #341), an explicit sample, and the refusals.
// Lightroom-authored here: Jim's "Color Range 1" [handle: docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json]
// and his " Reds" and "Yellows" [handle: docs\reports\phase8\probes\kinds.json, -Rendered.dng]. Upstream's 14 samples
// from two charts [upstream claim: Automaat PR #339, plugin/spec/RangeMaskGeometry_spec.lua LIGHTROOM_AUTHORED_SAMPLES].

import { describe, expect, it } from "vitest";
import { IDENTITY, cropFrame } from "../src/params/crop-frame.js";
import { applyOp, precheck, withCopiedSample, type CreateOp } from "../src/params/mask-ops.js";
import { colorRangeOf } from "../src/params/mask-range.js";
import { summarize } from "../src/params/mask-summary.js";
import { C, RANGE, type Component, type Correction } from "../src/params/mask-table.js";

/** [PointModels entry, ColorAmount] as Lightroom stored them. */
const JIMS: Array<[string, number]> = [
  ["0.991135 0.440358 0.818088 0.821179 0.214512 0", 0.494949],
  ["0.165342 0.748875 0.661089 0.167969 0.167155 0", 0],
  ["0.563384 0.525622 0.938049 0.103516 0.439883 0", 0.091394],
];
const UPSTREAM = [
  "0.000000 0.412168 0.482436 0.050000 0.062000 0",
  "1.000000 0.412168 0.482436 0.950000 0.062000 0",
  "0.526449 0.507206 0.517751 0.550000 0.062000 0",
  "0.522527 0.888059 0.758296 0.050000 0.188000 0",
  "0.877652 0.042200 0.948882 0.150000 0.188000 0",
  "0.203667 0.847788 0.000076 0.250000 0.188000 0",
  "0.937129 0.000085 0.412180 0.350000 0.188000 0",
  "0.705572 1.000000 0.260581 0.450000 0.188000 0",
  "0.999979 0.382554 1.000000 0.550000 0.188000 0",
  "0.295014 0.570518 0.616284 0.950000 0.188000 0",
  "0.000000 0.487187 0.520188 0.016250 0.062000 0",
  "0.715088 0.499362 0.525540 0.516250 0.062000 0",
  "1.000000 0.487187 0.520188 0.985000 0.062000 0",
  "0.722002 0.866458 0.751496 0.985000 0.188000 0",
];
const AUTHORED: Array<[string, number]> = [...JIMS, ...UPSTREAM.map((m): [string, number] => [m, 0.494949])];

/** A correction holding Lightroom's colour range, in the form of Jim's "Color Range 1". */
const lightroomMade = (model: string, amount: number, id = "LR-1"): Correction =>
  ({
    [C.what]: "Correction",
    [C.id]: id,
    [C.masks]: [{ What: "Mask/RangeMask", MaskID: `${id}-m`, CorrectionRangeMask: { Type: 1, Version: 3, SampleType: 0, PointModels: [model], Invert: false, ColorAmount: amount } }],
  }) as unknown as Correction;
const range = (e: Correction): Record<string, unknown> => ((e[C.masks] as Component[])[0] as Component)[RANGE.holder] as Record<string, unknown>;
const copy = (op: Partial<CreateOp>, entries: Correction[], frame = IDENTITY): CreateOp => withCopiedSample({ op: "create", kind: "color_range", copy_sample_from: { mask_id: "LR-1" }, ...op }, { entries, frame });
const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as { code: string }).code;
  }
  return "no error";
};

describe("a colour range's stored sample", () => {
  it("reads back as l, a, b in lr_list_masks for every Lightroom-authored triple", () => {
    for (const [model, amount] of AUTHORED) {
      const [l, a, b, x, y] = model.split(" ").map(Number);
      expect(summarize(lightroomMade(model, amount)).geometry).toEqual({ point: { x, y }, sample: { l, a, b }, color_amount: amount });
    }
  });

  it("is copied verbatim, with its pin and amount, onto the same photo (Automaat PR #341)", () => {
    for (const [model, amount] of AUTHORED) {
      const src = lightroomMade(model, amount);
      const plan = applyOp([src], copy({}, [src]));
      const made = plan.entries.find((e) => e[C.id] === plan.id) as Correction;
      expect(range(made)[RANGE.pointModels]).toEqual([model]);
      expect(range(made)[RANGE.colorAmount]).toBe(amount);
    }
  });

  it("keeps the source's pin where the preview shows it on another photo's crop, clamped to the preview", () => {
    const src = lightroomMade(JIMS[0]![0], 0.494949); // pin 0.821179, 0.214512 of the uncropped photo
    const target = cropFrame({ CropLeft: 0, CropTop: 0, CropRight: 0.5, CropBottom: 1 }, null);
    const op = copy({}, [src], IDENTITY);
    expect(op.point).toEqual({ x: 0.821179, y: 0.214512 });
    const fromCropped = copy({}, [src], target);
    expect(fromCropped.point).toEqual({ x: 1, y: 0.214512 });
    expect(fromCropped.geometry?.sample).toEqual({ l: 0.991135, a: 0.440358, b: 0.818088 });
  });

  it("takes color_amount and point when given", () => {
    const src = lightroomMade(JIMS[0]![0], 0.494949);
    const op = copy({ point: { x: 0.1, y: 0.2 }, geometry: { color_amount: 0.05 } }, [src]);
    expect(op.geometry?.color_amount).toBe(0.05);
    expect(op.point).toEqual({ x: 0.1, y: 0.2 });
  });

  it("writes an explicit sample { l, a, b } verbatim and refuses one outside 0-1", () => {
    const plan = applyOp([], { op: "create", kind: "color_range", point: { x: 0.2, y: 0.8 }, geometry: { sample: { l: 0.462745, a: 0.4, b: 0.1 } } });
    expect(range(plan.entries[0] as Correction)[RANGE.pointModels]).toEqual(["0.462745 0.400000 0.100000 0.200000 0.800000 0"]);
    expect(codeOf(() => applyOp([], { op: "create", kind: "color_range", point: { x: 0.2, y: 0.8 }, geometry: { sample: { l: 1.2, a: 0.4, b: 0.1 } } }))).toBe("INVALID_ARGUMENTS");
  });

  it("refuses what cannot be copied, before anything is built", () => {
    const src = lightroomMade(JIMS[0]![0], 0.494949);
    const lum = { ...src, [C.masks]: [{ What: "Mask/RangeMask", CorrectionRangeMask: { Type: 2, LumRange: "0 0.2 0.8 1" } }] } as unknown as Correction;
    const two = lightroomMade(JIMS[0]![0], 0.5);
    range(two)[RANGE.pointModels] = [JIMS[0]![0], JIMS[1]![0]];
    const parts = { ...src, [C.masks]: [...(src[C.masks] as Component[]), ...(src[C.masks] as Component[])] } as unknown as Correction;
    expect(codeOf(() => copy({}, []))).toBe("MASK_NOT_FOUND");
    expect(codeOf(() => copy({}, [lum]))).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => copy({}, [two]))).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => copy({}, [parts]))).toBe("INVALID_ARGUMENTS");
    expect(copy({ copy_sample_from: { mask_id: "LR-1", part: 2 } }, [parts]).geometry?.sample).toEqual({ l: 0.991135, a: 0.440358, b: 0.818088 });
    expect(codeOf(() => precheck({ op: "create", kind: "linear", copy_sample_from: { mask_id: "LR-1" } }))).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => precheck({ op: "create", kind: "color_range", copy_sample_from: { mask_id: "LR-1" }, geometry: { sample: { l: 0, a: 0, b: 0 } } }))).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => precheck({ op: "create", kind: "color_range", copy_sample_from: { mask_id: "LR-1" } }))).toBe("no error");
    expect(codeOf(() => applyOp([src], { op: "create", kind: "color_range", copy_sample_from: { mask_id: "LR-1" } }))).toBe("INTERNAL_ERROR");
  });

  it("reads only a colour range with one sample (colorRangeOf)", () => {
    expect(colorRangeOf(undefined)).toBe("is not a range mask");
    expect(colorRangeOf((lightroomMade(JIMS[1]![0], 0)[C.masks] as Component[])[0])).toEqual({ sample: { l: 0.165342, a: 0.748875, b: 0.661089 }, pin: { x: 0.167969, y: 0.167155 }, amount: 0 });
  });
});
