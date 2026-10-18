// How much of a geometric mask lies outside the preview (src/params/crop-share.ts, GitHub issue #179).

import { describe, expect, it } from "vitest";
import { IDENTITY, cropFrame, outsideShare, outsideWarnings, type MaskSummary } from "../src/params/index.js";

/** The top half of the photo kept: the preview's y 1 is the photo's y 0.5. */
const topHalf = cropFrame({ CropLeft: 0, CropTop: 0, CropRight: 1, CropBottom: 0.5, CropAngle: 0, orientation: "AB" }, null);
const linear = (zy: number, fy: number) => ({ zero: { x: 0.5, y: zy }, full: { x: 0.5, y: fy } });
const summary = (geometry: Record<string, unknown>, parts?: MaskSummary["parts"]): MaskSummary => ({
  id: "M", name: "AVG test", kind: "linear", active: true, inverted: false, components: parts?.length ?? 1, sliders: {}, ...(parts ? { parts } : { geometry }),
});

describe("outside share", () => {
  it("is 0 on an uncropped photo, and for a radial inside the preview", () => {
    expect(outsideShare(IDENTITY, linear(0.99, 1))).toBe(0);
    expect(outsideShare(topHalf, { left: 0.2, top: 0.2, right: 0.4, bottom: 0.5, feather: 50 })).toBe(0);
  });

  it("counts a linear gradient's whole side of its zero line, cut to the photo", () => {
    // y >= 0.99 of the preview runs to the photo's bottom at preview y 2: 1.01 of it, 0.01 inside.
    expect(outsideShare(topHalf, linear(0.99, 1))).toBeCloseTo(1 - 0.01 / 1.01, 9);
    // the issue's foreground band, y 0.64 -> 1: 0.36 of 1.36 inside.
    expect(outsideShare(topHalf, linear(0.64, 1))).toBeCloseTo(1 - 0.36 / 1.36, 9);
    // pointing up: y <= 0.5, all inside.
    expect(outsideShare(topHalf, linear(0.5, 0.2))).toBeCloseTo(0, 9);
  });

  it("counts a radial's box past the preview (a user's mask read back)", () => {
    expect(outsideShare(IDENTITY, { left: -1, top: 0, right: 0.1, bottom: 1 })).toBeCloseTo(1 - 0.1 / 1.1, 9);
    expect(outsideShare(IDENTITY, { lum_range: [0, 0.1, 0.2, 0.3] })).toBeNull();
  });

  it("warns at 90 % or more, naming the mask or its part", () => {
    expect(outsideWarnings(topHalf, summary(linear(0.64, 1)))).toEqual([]);
    expect(outsideWarnings(topHalf, summary(linear(0.99, 1)))).toEqual([expect.stringMatching(/^99 % of mask "AVG test" lies outside the preview/)]);
    const parts = [{ kind: "linear", inverted: false, geometry: linear(0.2, 0.5) }, { kind: "linear", mode: "subtract", inverted: false, geometry: linear(0.995, 1) }];
    expect(outsideWarnings(topHalf, summary({}, parts))).toEqual([expect.stringMatching(/part 2 of mask "AVG test"/)]);
    expect(outsideWarnings(topHalf, null)).toEqual([]);
  });
});
