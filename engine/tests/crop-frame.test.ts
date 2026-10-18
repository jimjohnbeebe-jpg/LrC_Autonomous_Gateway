// The crop frame (src/params/crop-frame.ts, GitHub issue #179): preview <-> uncropped photo, from a photo's
// crop settings. Lightroom's side of the mapping is [unverified] until `npm run masks:crop`; these check the
// arithmetic: identity, a recorded crop, an angled crop's round trip, the corners and the refusals.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { boxToRadial, cropFrame, isIdentity, photoPoint, radialToBox, toPhoto, toView, type Point } from "../src/params/crop-frame.js";
import { MaskError } from "../src/params/index.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/s10-rendered-dsc0031.json", import.meta.url), "utf8")) as { settings: Record<string, unknown> };
const crop = (angle: number, orientation = "AB") => ({ CropLeft: 0.1, CropTop: 0.2, CropRight: 0.85, CropBottom: 0.9, CropAngle: angle, orientation });
const SIZE = { width: 6000, height: 4000 };
const close = (a: Point, b: Point, digits = 9): void => {
  expect(a.x).toBeCloseTo(b.x, digits);
  expect(a.y).toBeCloseTo(b.y, digits);
};
const GRID: Point[] = [0, 0.25, 0.5, 0.64, 1].flatMap((x) => [0, 0.3, 0.5, 1].map((y) => ({ x, y })));

describe("crop frame", () => {
  it("is the identity on an uncropped photo, or one without crop keys (the simulator)", () => {
    for (const sdk of [{}, { CropLeft: 0, CropTop: 0, CropRight: 1, CropBottom: 1, CropAngle: 0, orientation: "AB" }]) {
      const f = cropFrame(sdk, null);
      expect(isIdentity(f)).toBe(true);
      expect(toPhoto(f, { x: 0.123456789, y: 0.9 })).toEqual({ x: 0.123456789, y: 0.9 });
      expect(boxToRadial(f, { left: 0.4, top: 0.4, right: 0.6, bottom: 0.6 })).toEqual({ left: 0.4, top: 0.4, right: 0.6, bottom: 0.6, angle: 0 });
    }
  });

  it("maps the recorded crop of DSC_0031 (angle 0) per axis", () => {
    const s = fixture.settings;
    const f = cropFrame(s, null);
    const [l, t, r, b] = [s["CropLeft"], s["CropTop"], s["CropRight"], s["CropBottom"]] as number[];
    close(toPhoto(f, { x: 0, y: 0 }), { x: l as number, y: t as number });
    close(toPhoto(f, { x: 1, y: 1 }), { x: r as number, y: b as number });
    close(toPhoto(f, { x: 0.5, y: 0.64 }), { x: (l as number) + 0.5 * ((r as number) - (l as number)), y: (t as number) + 0.64 * ((b as number) - (t as number)) });
    close(toView(f, { x: 0, y: 1 }), { x: -(l as number) / ((r as number) - (l as number)), y: (1 - (t as number)) / ((b as number) - (t as number)) });
  });

  it("round-trips every point at a crop angle, in each orientation; the preview's centre is the crop's", () => {
    for (const o of ["AB", "BC", "CD", "DA"]) {
      const f = cropFrame(crop(10, o), SIZE);
      for (const p of GRID) close(toView(f, toPhoto(f, p)), p);
      close(toPhoto(f, { x: 0.5, y: 0.5 }), { x: 0.475, y: 0.55 });
    }
  });

  it("puts the preview's corners on the crop's corners", () => {
    const at0 = (o: string) => cropFrame(crop(0, o), null);
    close(toPhoto(at0("AB"), { x: 0, y: 0 }), { x: 0.1, y: 0.2 });
    close(toPhoto(at0("BC"), { x: 0, y: 0 }), { x: 0.1, y: 0.9 }); // turned 90 clockwise: the stored bottom-left shows top-left
    close(toPhoto(at0("CD"), { x: 0, y: 0 }), { x: 0.85, y: 0.9 });
    close(toPhoto(at0("DA"), { x: 1, y: 0 }), { x: 0.85, y: 0.9 });
    const angled = cropFrame(crop(10), SIZE);
    close(toPhoto(angled, { x: 0, y: 0 }), { x: 0.1, y: 0.2 }); // the stored corners are the turned rectangle's
    close(toPhoto(angled, { x: 1, y: 1 }), { x: 0.85, y: 0.9 });
  });

  it("writes a box as a radial turned with the crop, and reads it back as the same box", () => {
    const box = { left: 0.2, top: 0.3, right: 0.45, bottom: 0.5 };
    for (const o of ["AB", "BC", "CD", "DA"]) {
      for (const angle of [0, 10, -7.25]) {
        const f = cropFrame(crop(angle, o), SIZE);
        const e = boxToRadial(f, box);
        expect(e.angle).toBe(angle);
        const back = radialToBox(f, e);
        close({ x: back.left, y: back.top }, { x: box.left, y: box.top });
        close({ x: back.right, y: back.bottom }, { x: box.right, y: box.bottom });
        close({ x: (e.left + e.right) / 2, y: (e.top + e.bottom) / 2 }, toPhoto(f, { x: 0.325, y: 0.4 }));
      }
    }
  });

  it("refuses a mirrored orientation, and an angle without the photo's size; a crop past the photo", () => {
    const code = (fn: () => unknown): string => {
      try {
        fn();
      } catch (err) {
        return (err as MaskError).code;
      }
      return "none";
    };
    const mirrored = cropFrame(crop(0, "BA"), SIZE);
    expect(mirrored.refused).toMatch(/"BA"/);
    expect(code(() => toPhoto(mirrored, { x: 0.5, y: 0.5 }))).toBe("CROP_FRAME_UNSUPPORTED");
    expect(cropFrame(crop(10), null).refused).toMatch(/pixel size/);
    expect(cropFrame(crop(0), null).refused).toBeNull();
    const past = cropFrame({ CropLeft: -0.2, CropTop: 0, CropRight: 1, CropBottom: 1 }, null);
    expect(code(() => photoPoint(past, { x: 0, y: 0.5 }, "zero"))).toBe("INVALID_ARGUMENTS");
  });

  it("matches Lightroom on a photo turned BC at a 10-degree crop: the size's aspect, not swapped", () => {
    // Jim's masks:crop run 2026-10-18T20-49-52Z, IMG_1595.JPG case B: where Lightroom drew the radials asked at these
    // preview points, given the size get_context reported (width / height 4/3).
    const f = cropFrame({ CropLeft: 0.196544, CropTop: 0.050806, CropRight: 0.803456, CropBottom: 0.949194, CropAngle: 10, orientation: "BC" }, { width: 4032, height: 3024 });
    const seen = [[{ x: 0.3, y: 0.35 }, { x: 0.2611, y: 0.3102 }], [{ x: 0.65, y: 0.5 }, { x: 0.6667, y: 0.5164 }], [{ x: 0.45, y: 0.7 }, { x: 0.4655, y: 0.7167 }]] as const;
    const swapped = { ...f, aspect: 3024 / 4032 };
    for (const [asked, blob] of seen) {
      const drawn = toView(f, toPhoto(swapped, asked));
      expect(Math.abs(drawn.x - blob.x)).toBeLessThan(0.002);
      expect(Math.abs(drawn.y - blob.y)).toBeLessThan(0.002);
    }
    expect(f.aspect).toBeCloseTo(4032 / 3024, 9);
  });

  it("names crop keys that are pinned in both key files (rule 03)", () => {
    for (const file of ["sdk-keys.lrc15.json", "sdk-keys.lrc15.rendered.json"]) {
      const pinned = readFileSync(new URL(`../src/params/${file}`, import.meta.url), "utf8");
      for (const key of ["CropLeft", "CropTop", "CropRight", "CropBottom", "CropAngle", "orientation"]) expect(pinned).toContain(`"key": "${key}"`);
    }
  });
});
