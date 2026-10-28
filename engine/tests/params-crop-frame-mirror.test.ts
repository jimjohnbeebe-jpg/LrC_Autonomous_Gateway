// The eight orientation codes (src/params/crop-frame.ts, GitHub issue #210): the four turns cross-checked against
// Automaat's table, the four mirrored codes mapped as that table says and still refused in the tools.
// UPSTREAM is Automaat's STORED_FROM_DISPLAYED, displayed (u, v) -> stored [upstream claim:
// plugin/LightroomMCP.lrplugin/ImageFrame.lua:7-16 at 1040453, live-checked on LrC 15.6 in its #331].

import { describe, expect, it } from "vitest";
import { MIRRORED, cropFrame, toPhoto, toView, withMirrorMapping, type Point } from "../src/params/crop-frame.js";

const UPSTREAM: Record<string, (u: number, v: number) => [number, number]> = {
  AB: (u, v) => [u, v],
  BA: (u, v) => [1 - u, v],
  CD: (u, v) => [1 - u, 1 - v],
  DC: (u, v) => [u, 1 - v],
  CB: (u, v) => [v, u],
  BC: (u, v) => [v, 1 - u],
  AD: (u, v) => [1 - v, 1 - u],
  DA: (u, v) => [1 - v, u],
};
const GRID: Point[] = [0, 0.2, 0.5, 0.9, 1].flatMap((x) => [0, 0.3, 0.7, 1].map((y) => ({ x, y })));
const uncropped = (orientation: string) => withMirrorMapping(cropFrame({ orientation }, null));
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as { code: string }).code;
  }
  return "no error";
};

describe("orientation codes", () => {
  it("map an uncropped photo as Automaat's table does, all eight (the four turns: an independent cross-check)", () => {
    for (const [o, stored] of Object.entries(UPSTREAM)) {
      for (const p of GRID) {
        const q = toPhoto(uncropped(o), p);
        const [x, y] = stored(p.x, p.y);
        expect(q.x).toBeCloseTo(x, 12);
        expect(q.y).toBeCloseTo(y, 12);
      }
    }
  });

  it("go back and forth through a crop with an angle on every code", () => {
    for (const o of Object.keys(UPSTREAM)) {
      const f = withMirrorMapping(cropFrame({ CropLeft: 0.1, CropTop: 0.2, CropRight: 0.85, CropBottom: 0.9, CropAngle: 7, orientation: o }, { width: 6000, height: 4000 }));
      expect(f.refused).toBeNull();
      for (const p of GRID) {
        const back = toView(f, toPhoto(f, p));
        expect(back.x).toBeCloseTo(p.x, 9);
        expect(back.y).toBeCloseTo(p.y, 9);
      }
    }
  });

  it("refuse a mirrored photo in the tools until Jim's check; only the check lifts it, and only that refusal", () => {
    for (const o of MIRRORED) {
      const f = cropFrame({ orientation: o }, null);
      expect(f.refused).toMatch(new RegExp(`mirrored \\(orientation "${o}"\\)`));
      expect(code(() => toPhoto(f, { x: 0.5, y: 0.5 }))).toBe("CROP_FRAME_UNSUPPORTED");
    }
    const angledWithoutSize = cropFrame({ CropAngle: 5, orientation: "BA" }, null);
    expect(withMirrorMapping(angledWithoutSize).refused).toMatch(/pixel size/);
    expect(cropFrame({ orientation: "XY" }, null).refused).toMatch(/"XY", an unknown one/);
  });
});
