// lr_crop's geometry (GitHub issue #115, params\crop-frame.ts cropSettings and cropView): the keys it writes are read
// back by cropFrame as the crop asked for, on every quarter turn, and the turned-rectangle model is pinned to the
// straightened render of crop:spike run 2 [handle: docs\reports\phase11\CROP-SPIKE.md "Observed", run 2: render
// 3-straighten 1024x405 of a 1024x683 photo with corners 0.1/0.9/0.2/0.8 and angle 5].

import { describe, expect, it } from "vitest";
import { CROP, NO_CROP, cropDiffers, cropFrame, cropSettings, cropView, toPhoto, type CropRequest } from "../src/params/index.js";

const SIZE = { width: 6000, height: 4000 };
const k = SIZE.width / SIZE.height;
const TURNS = ["AB", "BC", "CD", "DA"] as const;
/** Upright 0-1 -> stored 0-1, written out here on its own (the orientation table of crop-frame.ts, from the first URL there). */
const STORED: Record<(typeof TURNS)[number], (p: number, q: number) => [number, number]> = {
  AB: (p, q) => [p, q],
  BC: (p, q) => [q, 1 - p],
  CD: (p, q) => [1 - p, 1 - q],
  DA: (p, q) => [1 - q, p],
};
const frameOf = (req: CropRequest, turn: (typeof TURNS)[number]) => {
  const f0 = cropFrame({ orientation: turn }, SIZE);
  return cropFrame({ ...cropSettings(req, f0, SIZE), orientation: turn }, SIZE);
};

describe("cropSettings and cropView (issue #115)", () => {
  const box = { x: 0.3, y: 0.25, w: 0.4, h: 0.5 };
  for (const turn of TURNS) {
    for (const angle of [0, 5, -5, 30, -30]) {
      it(`maps the asked box's turned corners to the preview's corners (${turn}, angle ${angle})`, () => {
        const f = frameOf({ box, angle }, turn);
        const [W, H] = turn === "BC" || turn === "DA" ? [1, k] : [k, 1];
        const th = (angle * Math.PI) / 180;
        const [c, s] = [Math.cos(th), Math.sin(th)];
        const [cx, cy, a, b] = [(box.x + box.w / 2) * W, (box.y + box.h / 2) * H, (box.w * W) / 2, (box.h * H) / 2];
        for (const [p, q] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
          const [X, Y] = [(2 * p - 1) * a, (2 * q - 1) * b];
          const [sx, sy] = STORED[turn]((cx + X * c - Y * s) / W, (cy + X * s + Y * c) / H);
          const got = toPhoto(f, { x: p, y: q });
          expect(got.x).toBeCloseTo(sx, 9);
          expect(got.y).toBeCloseTo(sy, 9);
        }
        const v = cropView(f, SIZE);
        for (const key of ["x", "y", "w", "h"] as const) expect(v.box[key]).toBeCloseTo(box[key], 5);
        expect(v.angle).toBe(angle);
      });
    }
  }

  it("fits an aspect in the box: 4:5 on a landscape photo is portrait", () => {
    for (const turn of TURNS) expect(cropView(frameOf({ aspect: "4:5" }, turn), SIZE).aspect).toBeCloseTo(0.8, 6);
    expect(cropView(frameOf({ aspect: "original" }, "AB"), SIZE)).toMatchObject({ box: { x: 0, y: 0, w: 1, h: 1 }, aspect: 1.5 });
  });

  it("shrinks a turned whole-photo crop until it lies inside the photo", () => {
    const sdk = cropSettings({ angle: 10 }, cropFrame({}, null), SIZE);
    const f = cropFrame(sdk, SIZE);
    for (const [p, q] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      const pt = toPhoto(f, { x: p, y: q });
      for (const v of [pt.x, pt.y]) expect(v >= 0 && v <= 1).toBe(true);
    }
    expect(cropView(f, SIZE).aspect).toBeCloseTo(1.5, 6);
  });

  it("writes no crop for the whole photo at angle 0, and for reset", () => {
    const f = cropFrame({}, null);
    expect(cropSettings({}, f, SIZE)).toEqual(NO_CROP);
    expect(cropSettings({ reset: true }, f, SIZE)).toEqual(NO_CROP);
    expect(cropDiffers({ ...NO_CROP, [CROP.angle]: 0.00005 }, {})).toBe(false);
    expect(cropDiffers({ ...NO_CROP, [CROP.left]: 0.01 }, {})).toBe(true);
  });

  it("refuses a box outside the photo, a bad aspect, reset with a box, and a mirrored photo", () => {
    const f = cropFrame({}, null);
    expect(() => cropSettings({ box: { x: 0.5, y: 0, w: 0.6, h: 1 } }, f, SIZE)).toThrow(/within 0-1/);
    expect(() => cropSettings({ aspect: "wide" }, f, SIZE)).toThrow(/not "original" or "W:H"/);
    expect(() => cropSettings({ reset: true, angle: 2 }, f, SIZE)).toThrow(/reset takes no/);
    expect(() => cropSettings({}, cropFrame({ orientation: "BA" }, null), SIZE)).toThrow(/mirrored/);
  });

  it("predicts crop:spike run 2's straightened render (1024x405)", () => {
    const f = cropFrame({ CropLeft: 0.1, CropRight: 0.9, CropTop: 0.2, CropBottom: 0.8, CropAngle: 5, orientation: "AB" }, { width: 1024, height: 683 });
    expect(cropView(f, { width: 1024, height: 683 }).aspect).toBeGreaterThan(2.525);
    expect(cropView(f, { width: 1024, height: 683 }).aspect).toBeLessThan(2.531);
  });
});
