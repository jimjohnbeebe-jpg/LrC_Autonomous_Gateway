// Issue #217 row 4: a mask's Point Color swatches on the table (params\mask-point-colors.ts), against Lightroom's own
// two swatches on Jim's "Mountains" mask [handle: docs\reports\phase8\probes\kinds.json] and its brush [handle:
// docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json "Brush"]; then one session pass on the sim.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOp, MASK_TABLE_KEY, precheck, summarize, verifyTable, type Correction } from "../src/params/index.js";
import { formatSwatch, parseSwatch } from "../src/params/mask-point-colors.js";
import { ID, clean, lr, newManager, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../docs/reports/${rel}`, import.meta.url), "utf8"));
const kinds = read("phase8/probes/kinds.json") as Record<string, { settings: { MaskGroupBasedCorrections: Correction[] } }>;
const mountains = (): Correction => structuredClone((kinds["-Rendered.dng"]?.settings.MaskGroupBasedCorrections ?? []).find((e) => e["CorrectionName"] === "Mountains") as Correction);
const carry = read("phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json") as { table_before: Correction[] };
const brush = (): Correction => structuredClone(carry.table_before.find((e) => e["CorrectionName"] === "Brush") as Correction);
const stored = (e: Correction | undefined): string[] => (e?.["LocalPointColors"] as string[] | undefined) ?? [];
const RED = { src_hue: 0.1, src_sat: 0.8, src_lum: 0.4 };

describe("Lightroom's stored swatches", () => {
  it("reads both of Jim's as 19 numbers in upstream's order and writes them back verbatim", () => {
    const [a, b] = stored(mountains());
    const one = parseSwatch(a);
    expect(one).toEqual({ src_hue: 0.286239, src_sat: 0.89496, src_lum: 0.078175, hue_shift: -0.22, sat_scale: -0.15, lum_scale: -0.12, range_amount: 0.7, hue_range: [0, 0.33, 0.67, 1], sat_range: [0.16, 0.71, 1, 1], lum_range: [0, 0.13, 0.49, 1] });
    expect(formatSwatch(one!)).toBe(a);
    expect(formatSwatch(parseSwatch(b)!)).toBe(b);
    expect(parseSwatch("1, 2, 3")).toBeNull();
  });

  it("lists them in lr_list_masks' summary, and nothing on a mask without swatches", () => {
    expect(summarize(mountains()).point_colors).toHaveLength(2);
    expect(summarize(brush()).point_colors).toBeUndefined();
  });
});

describe("lr_edit_mask point_colors on the table", () => {
  const edit = (e: Correction, point_colors: Parameters<typeof precheck>[0] extends infer O ? (O extends { point_colors?: infer P } ? P : never) : never) =>
    applyOp([e], { op: "edit", mask_id: String(e["CorrectionID"]), point_colors }).entries[0];

  it("adds a swatch with defaults to a mask with none, in Lightroom's form", () => {
    const out = edit(brush(), { action: "add", swatch: RED });
    expect(stored(out)).toEqual(["0.100000, 0.800000, 0.400000, 0.000000, 0.000000, 0.000000, 0.500000, 0.000000, 0.330000, 0.670000, 1.000000, 0.000000, 0.330000, 0.670000, 1.000000, 0.000000, 0.330000, 0.670000, 1.000000"]);
  });

  it("updates one swatch and keeps the other as Lightroom stored it; deletes one; clears all", () => {
    const [, second] = stored(mountains());
    const updated = stored(edit(mountains(), { action: "update", index: 1, swatch: { hue_shift: 0.5 } }));
    expect(parseSwatch(updated[0])).toMatchObject({ hue_shift: 0.5, src_hue: 0.286239, range_amount: 0.7 });
    expect(updated[1]).toBe(second);
    expect(stored(edit(mountains(), { action: "delete", index: 1 }))).toEqual([second]);
    expect(stored(edit(mountains(), { action: "clear" }))).toEqual([]);
  });

  it("takes a cleared list that Lightroom leaves out of the read-back", () => {
    const out = edit(mountains(), { action: "clear" }) as Correction;
    const back = structuredClone(out);
    delete back["LocalPointColors"];
    expect(verifyTable([out], { [MASK_TABLE_KEY]: [back] })).toEqual([]);
  });

  it("refuses a swatch without its source, out of range, a ninth, a repeated source and a missing index", () => {
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "add", swatch: { src_hue: 1 } } })).toThrow(/src_sat/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "add", swatch: { ...RED, src_hue: 7 } } })).toThrow(/outside 0..6/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "add", swatch: { ...RED, hue_range: [0.5, 0.2, 0.7, 1] } } })).toThrow(/at least the one before/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "delete" } })).toThrow(/needs index/);
    let e = brush();
    for (let i = 0; i < 8; i++) e = edit(e, { action: "add", swatch: { ...RED, src_hue: i * 0.5 } }) as Correction;
    expect(() => edit(e, { action: "add", swatch: { ...RED, src_hue: 5 } })).toThrow(/up to 8/);
    expect(() => edit(mountains(), { action: "add", swatch: { src_hue: 0.286, src_sat: 0.895, src_lum: 0.078 } })).toThrow(/already has a swatch/);
    expect(() => edit(mountains(), { action: "update", index: 3, swatch: { hue_shift: 0 } })).toThrow(/no swatch 3/);
  });

  it("refuses to rewrite swatches it cannot read", () => {
    const odd = { ...mountains(), LocalPointColors: ["0.1, 0.2"] } as Correction;
    expect(() => edit(odd, { action: "add", swatch: RED })).toThrow(/not in the form/);
  });
});

describe("point_colors in a session", () => {
  it("is one pass that adds the swatch to Lightroom's brush, read back and listed", async () => {
    clean();
    const b = brush();
    lr.settings[MASK_TABLE_KEY] = [b];
    const m = newManager();
    await m.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    const out = await m.editMask({ session_id: ID, rationale: "test", return_image: "none", mask_id: String(b["CorrectionID"]), point_colors: { action: "add", swatch: RED } });
    expect(out.json).toMatchObject({ pass: "1/4", mask: { point_colors: [expect.objectContaining(RED)] } });
    expect(stored((lr.settings[MASK_TABLE_KEY] as Correction[])[0])).toHaveLength(1);
  });
});
