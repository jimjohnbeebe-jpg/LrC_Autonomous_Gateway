// Slider values as Lightroom writes them, and the mini track (hud\ui\rows.ts; Option C NOTES section 5 item 11, section 7).
import { describe, expect, it } from "vitest";
import { fraction, shownDelta, shownValue, track } from "./rows.ts";

describe("values", () => {
  it("signs, minus sign, Exposure decimals, Temp separators, unsigned sliders, text", () => {
    expect(shownValue("exposure", 0.33, -5)).toBe("+0.33");
    expect(shownValue("exposure", -0.7, -5)).toBe("−0.70");
    expect(shownValue("contrast", 20, -100)).toBe("+20");
    expect(shownValue("blacks", -15, -100)).toBe("−15");
    expect(shownValue("contrast", 0, -100)).toBe("0");
    expect(shownValue("temperature", 5500, 2000)).toBe("5,500");
    expect(shownValue("sharpening.amount", 40, 0)).toBe("40");
    expect(shownValue("camera_profile", "Adobe Landscape")).toBe("Adobe Landscape");
    expect(shownValue("contrast", undefined)).toBe("");
  });
  it("deltas", () => {
    expect(shownDelta("exposure", 0.37)).toBe("+0.37");
    expect(shownDelta("contrast", -3)).toBe("−3");
    expect(shownDelta("contrast", 0)).toBe("0");
  });
});

describe("the track", () => {
  it("places values on the range; Temp on a log scale; none without a range", () => {
    expect(fraction("contrast", 0, -100, 100)).toBe(0.5);
    expect(fraction("contrast", 300, -100, 100)).toBe(1);
    expect(fraction("temperature", Math.sqrt(2000 * 50000), 2000, 50000)).toBeCloseTo(0.5);
    expect(fraction("contrast", 1, undefined, 100)).toBeNull();
  });
  it("the segment from before to after, at least 2 %; an undone pass leaves the thumb at before", () => {
    expect(track({ name: "contrast", before: 0, after: 50, min: -100, max: 100 }, false)).toEqual({ from: 0.5, to: 0.75, thumb: 0.75 });
    const tiny = track({ name: "contrast", before: 0, after: 1, min: -100, max: 100 }, false);
    expect((tiny?.to ?? 0) - (tiny?.from ?? 0)).toBeCloseTo(0.02);
    expect(track({ name: "contrast", before: 0, after: 50, min: -100, max: 100 }, true)).toEqual({ from: 0.5, to: 0.5, thumb: 0.5 });
    expect(track({ name: "camera_profile", before: "a", after: "b" }, false)).toBeNull();
  });
});
