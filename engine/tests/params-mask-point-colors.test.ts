// Issue #217 row 4: a mask's Point Color swatches as the mask table stores them (params\mask-point-colors.ts), read for
// lr_list_masks, against Lightroom's own two swatches on Jim's "Mountains" mask [handle: docs\reports\phase8\probes\
// kinds.json] and its brush [handle: docs\reports\phase8.5\mask-carry\mask_carry_2026-10-11T22-37-39-161Z.json "Brush"].
// A change is checked here and written through LrDevelopController (tests\mask-controller.test.ts).

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyOp, precheck, summarize, type Correction } from "../src/params/index.js";
import { parseSwatch } from "../src/params/mask-point-colors.js";

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../docs/reports/${rel}`, import.meta.url), "utf8"));
const kinds = read("phase8/probes/kinds.json") as Record<string, { settings: { MaskGroupBasedCorrections: Correction[] } }>;
const mountains = (): Correction => structuredClone((kinds["-Rendered.dng"]?.settings.MaskGroupBasedCorrections ?? []).find((e) => e["CorrectionName"] === "Mountains") as Correction);
const carry = read("phase8.5/mask-carry/mask_carry_2026-10-11T22-37-39-161Z.json") as { table_before: Correction[] };
const brush = (): Correction => structuredClone(carry.table_before.find((e) => e["CorrectionName"] === "Brush") as Correction);
const stored = (e: Correction | undefined): string[] => (e?.["LocalPointColors"] as string[] | undefined) ?? [];
const RED = { src_hue: 0.1, src_sat: 0.8, src_lum: 0.4 };

describe("Lightroom's stored swatches", () => {
  it("reads both of Jim's as 19 numbers in upstream's order", () => {
    const [a, b] = stored(mountains());
    expect(parseSwatch(a)).toEqual({ src_hue: 0.286239, src_sat: 0.89496, src_lum: 0.078175, hue_shift: -0.22, sat_scale: -0.15, lum_scale: -0.12, range_amount: 0.7, hue_range: [0, 0.33, 0.67, 1], sat_range: [0.16, 0.71, 1, 1], lum_range: [0, 0.13, 0.49, 1] });
    expect(parseSwatch(b)).not.toBeNull();
    expect(parseSwatch("1, 2, 3")).toBeNull();
  });

  it("lists them in lr_list_masks' summary, and nothing on a mask without swatches", () => {
    expect(summarize(mountains()).point_colors).toHaveLength(2);
    expect(summarize(brush()).point_colors).toBeUndefined();
  });
});

describe("lr_edit_mask point_colors", () => {
  it("leaves the mask table as it was (the change goes through LrDevelopController)", () => {
    const e = mountains();
    const out = applyOp([e], { op: "edit", mask_id: String(e["CorrectionID"]), point_colors: { action: "add", swatch: RED } });
    expect(out.entries).toEqual([e]);
  });

  it("refuses a swatch without its source, out of range, bad ranges, a missing index, and a table change beside it", () => {
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "add", swatch: { src_hue: 1 } } })).toThrow(/src_sat/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "add", swatch: { ...RED, src_hue: 7 } } })).toThrow(/outside 0..6/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "add", swatch: { ...RED, hue_range: [0.5, 0.2, 0.7, 1] } } })).toThrow(/at least the one before/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "delete" } })).toThrow(/needs index/);
    expect(() => precheck({ op: "edit", mask_id: "X", point_colors: { action: "clear" }, sliders: { "local.exposure": 1 } })).toThrow(/own lr_edit_mask call/);
  });
});
