// `npm run masks:carry`'s pure parts (src/devtools/mask-carry-probe.ts; issue #121): which hand-made masks the
// photo holds, the table written back verbatim plus one radial, and the per-entry diff and its summary.
// The entries are shaped after the S10 census's hand-made masks (docs\reports\phase8\S10\census\
// s10_20260906-_OZ80005-Rendered.dng__DDABB6F1.json: "Cloudsx", "Mountains", " Reds"), trimmed.

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { carried, changedPaths, diffEntries, diffSummary, RADIAL_NAME, readPending, shapesOf } from "../src/devtools/mask-carry-probe.js";
import { MASK_TABLE_KEY, type Correction } from "../src/params/index.js";

const comp = (what: string, extra: Record<string, unknown> = {}) => ({ What: what, MaskID: `M-${what}`, MaskBlendMode: 0, MaskInverted: false, ...extra });
const entry = (name: string, masks: { What: string }[]): Correction => ({ What: "Correction", CorrectionID: `ID-${name}`, CorrectionName: name, CorrectionMasks: masks }) as Correction;
const linear = comp("Mask/Gradient", { ZeroX: 0.5, ZeroY: 0, FullX: 0.5, FullY: 1 });
const handMade = (): Correction[] => [
  entry("Add", [linear, comp("Mask/CircularGradient", { MaskBlendMode: 0 })]),
  entry("Subtract", [linear, comp("Mask/Image", { MaskBlendMode: 1, MaskInverted: true, MaskSubType: 2 })]),
  entry("Intersect", [linear, comp("Mask/Gradient", { MaskBlendMode: 1 })]),
  entry(" brush", [comp("Mask/Aggregate", { MaskBrushTable: "38BA", BrushTable_38BA: "4000010000" })]),
  entry("Color", [comp("Mask/RangeMask", { CorrectionRangeMask: { Type: 1, Version: 2 } })]),
];

describe("masks:carry shapes", () => {
  it("finds each hand-made mask by name and records each component's MaskBlendMode and MaskInverted", () => {
    const { shapes, missing } = shapesOf(handMade());
    expect(missing).toEqual([]);
    expect(shapes.find((s) => s.name === "Subtract")?.parts[1]).toMatchObject({ what: "Mask/Image", blend: 1, inverted: true });
    expect(shapes.find((s) => s.name === "Color")?.parts[0]).toMatchObject({ kind: "color_range", range_type: 1 });
  });

  it("says what is missing or not as the steps make it", () => {
    const t = handMade().filter((e) => e.CorrectionName !== "Color");
    (t[0] as Correction).CorrectionMasks = [linear];
    expect(shapesOf(t).missing).toEqual([expect.stringMatching(/^Add: it has 1 component/), 'Color: no mask named "Color"']);
    expect(shapesOf([entry("Brush", [linear])]).missing).toContain("Brush: no brush component (kinds: Mask/Gradient)");
  });
});

describe("masks:carry write and diff", () => {
  it("writes every entry verbatim and adds one radial at the end", () => {
    const before = handMade();
    const { entries, radial_id } = carried(before);
    expect(entries.slice(0, -1)).toEqual(before);
    expect(entries.at(-1)).toMatchObject({ CorrectionID: radial_id, CorrectionName: RADIAL_NAME });
  });

  it("an unchanged read-back passes; a lost brush and a changed blend mode are named, RECOMPUTED fields aside", () => {
    const { entries } = carried(handMade());
    const same = structuredClone(entries);
    (same[1]?.CorrectionMasks[1] as Record<string, unknown>).MaskDigest = "NEW";
    const good = diffEntries(entries, { [MASK_TABLE_KEY]: same });
    expect(diffSummary({ read_back: good }).ok).toBe(true);
    expect(good.entries[1]?.changed).toEqual(["CorrectionMasks.1.MaskDigest (recomputed)"]);

    const bad = structuredClone(entries).filter((e) => e.CorrectionName !== " brush");
    (bad[2]?.CorrectionMasks[1] as Record<string, unknown>).MaskBlendMode = 0;
    const summary = diffSummary({ read_back: diffEntries(entries, { [MASK_TABLE_KEY]: bad }) });
    expect(summary.ok).toBe(false);
    expect(summary.lines).toContain("read_back: 6 masks written, 5 read back");
    expect(summary.lines).toContain("read_back:  brush: missing from the read-back");
    expect(summary.lines).toContain("read_back: Intersect: mask Intersect reads back different (CorrectionMasks.1.MaskBlendMode)");
  });

  it("changedPaths compares numbers within 1e-6", () => {
    expect(changedPaths({ a: 1, b: { c: "x" } }, { a: 1 + 1e-9, b: { c: "y" } })).toEqual(["b.c"]);
  });
});

// Greptile, PR #137: a damaged put-back record must not stop every later run.
describe("readPending", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "avg-carry-"));
  const state = path.join(dir, "state.json");
  const moved = path.join(dir, "state.damaged.json");
  const good = { uuid: "U", filename: "a.NEF", snapshot_id: "S", before_sdk: { Exposure2012: 0 } };

  it("returns a valid record and none when there is no file", () => {
    rmSync(state, { force: true });
    expect(readPending(state, moved)).toEqual({ pending: null, damaged: null });
    writeFileSync(state, JSON.stringify(good));
    expect(readPending(state, moved)).toEqual({ pending: good, damaged: null });
  });

  it.each([["cut-off JSON", '{"uuid": "U", "file'], ["the wrong shape", JSON.stringify({ uuid: 1 })]])("moves %s aside and reports it", (_, text) => {
    writeFileSync(state, text);
    expect(readPending(state, moved)).toEqual({ pending: null, damaged: moved });
    expect(existsSync(state)).toBe(false);
    expect(readFileSync(moved, "utf8")).toBe(text);
  });
});
