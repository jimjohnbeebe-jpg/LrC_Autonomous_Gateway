// Issue #193: an ordinary Intersect part, which Lightroom stores as MaskBlendMode 1 + MaskInverted true + MaskValue 0
// [handle: docs\reports\phase8.5\mask-combine.md:62; the mask-carry run below, `table_before[2]`, Jim's hand-made
// Intersect], reads back inverted false.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERIFIED_FORMS } from "../src/params/mask-combine.js";
import { applyOp, newCorrection } from "../src/params/mask-ops.js";
import { summarize } from "../src/params/mask-summary.js";
import { C, type Correction, M } from "../src/params/mask-table.js";

const CARRY = "../../docs/reports/phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json";
const run = JSON.parse(readFileSync(fileURLToPath(new URL(CARRY, import.meta.url)), "utf8")) as { table_before: Correction[] };
const BOX = { left: 0.2, top: 0.3, right: 0.7, bottom: 0.9 };

describe("issue #193: an intersect part reads back not inverted", () => {
  it("Jim's hand-made Intersect (Lightroom stores MaskInverted true) reads inverted false", () => {
    const m = summarize(run.table_before[2] as Correction);
    expect(m.parts?.[1]).toMatchObject({ mode: "intersect", inverted: false });
    expect(m.inverted).toBe(false);
  });

  it("an engine-made radial, intersect luminance reads inverted false", () => {
    const r = newCorrection("radial", "AVG r", BOX, null, {}, []);
    const out = applyOp([r], { op: "edit", mask_id: String(r[C.id]), combine: { mode: "intersect", kind: "luminance", geometry: { lum_range: [0.22, 0.34, 1, 1] } } } as never);
    expect(VERIFIED_FORMS.has("radial, intersect luminance")).toBe(true);
    const p = summarize(out.entries[0] as Correction).parts?.[1];
    expect(p).toMatchObject({ kind: "luminance", mode: "intersect", inverted: false });
  });

  // The engine refuses to write an inverted first part plus a combine (not a verified form), so flip part 1 of the
  // stored Intersect: the whole mask must read the intersect part as not inverted too.
  it("Jim's Intersect with part 1 inverted: part 1 inverted, the whole mask not", () => {
    const e = structuredClone(run.table_before[2]) as Correction;
    const parts = e[C.masks] as Record<string, unknown>[];
    (parts[0] as Record<string, unknown>)[M.inverted] = true;
    const m = summarize(e);
    expect(m.parts?.[0]).toMatchObject({ inverted: true });
    expect(m.parts?.[1]).toMatchObject({ mode: "intersect", inverted: false });
    expect(m.inverted).toBe(false);
  });
});
