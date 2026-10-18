// The pure parts of `npm run masks:crop` (src/devtools/mask-crop-probe.ts, GitHub issue #179): the blob a
// radial brightens, where it is and how it lies, and the verdicts.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { blobOf, eachPhoto, grey, linearVerdict, pointVerdict, radialOp, sameGeometry, verdict, type Grey, type PhotoResult } from "../src/devtools/mask-crop-probe.js";

const W = 300;
const H = 200;
const flat = (): Grey => ({ data: new Uint8Array(W * H).fill(60), width: W, height: H });
/** `flat` with an ellipse brightened by 80 at (cx, cy) in 0-1, semi-axes (a, b) in pixels, turned `deg` clockwise (y down). */
function ellipse(cx: number, cy: number, a: number, b: number, deg = 0): Grey {
  const g = flat();
  const [c, s] = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [dx, dy] = [x + 0.5 - cx * W, y + 0.5 - cy * H];
      const [u, v] = [dx * c + dy * s, -dx * s + dy * c];
      if ((u / a) ** 2 + (v / b) ** 2 <= 1) g.data[y * W + x] = 140;
    }
  }
  return g;
}

describe("masks:crop blob", () => {
  it("finds a level blob's centre", () => {
    const b = blobOf(flat(), ellipse(0.3, 0.35, 15, 7));
    expect(b?.x).toBeCloseTo(0.3, 2);
    expect(b?.y).toBeCloseTo(0.35, 2);
    expect(Math.abs(b?.axis_deg ?? 99)).toBeLessThan(1);
  });

  it("measures a turned blob's tilt, and finds nothing when nothing brightened or the sizes differ", () => {
    expect(blobOf(flat(), ellipse(0.5, 0.5, 30, 10, 20))?.axis_deg).toBeCloseTo(20, 0);
    expect(blobOf(flat(), flat())).toBeNull();
    const scattered = flat();
    for (let i = 0; i < scattered.data.length; i += 7) scattered.data[i] = 120;
    expect(blobOf(flat(), scattered)).toBeNull();
    expect(blobOf(flat(), { data: new Uint8Array(4), width: 2, height: 2 })).toBeNull();
  });

  it("decodes a JPEG to grey levels", async () => {
    const jpeg = await sharp({ create: { width: 8, height: 4, channels: 3, background: { r: 100, g: 100, b: 100 } } }).jpeg().toBuffer();
    const g = await grey(jpeg);
    expect([g.width, g.height, g.data.length]).toEqual([8, 4, 32]);
  });
});

describe("masks:crop verdicts", () => {
  const level = { x: 0.31, y: 0.36, axis_deg: 2, pixels: 300, peak: 80 };
  it("passes a radial on its point, level and read back; fails a miss, a tilt, no blob, a read-back difference", () => {
    expect(pointVerdict({ x: 0.3, y: 0.35 }, level, true).ok).toBe(true);
    expect(pointVerdict({ x: 0.3, y: 0.35 }, { ...level, y: 0.5 }, true).why).toMatch(/off by/);
    expect(pointVerdict({ x: 0.3, y: 0.35 }, { ...level, axis_deg: 20 }, true).why).toMatch(/tilted 20/);
    expect(pointVerdict({ x: 0.3, y: 0.35 }, null, true).ok).toBe(false);
    expect(pointVerdict({ x: 0.3, y: 0.35 }, level, false).why).toMatch(/read-back/);
  });

  it("needs the foreground gradient to move the frame by 0.5 or more (the issue's -0.002 is the bug)", () => {
    expect(linearVerdict(-2.061, true).ok).toBe(true);
    expect(linearVerdict(-0.002, true).ok).toBe(false);
    expect(linearVerdict(null, true).ok).toBe(false);
  });

  it("compares geometry within 1e-6, the radial's box as written", () => {
    const op = radialOp({ x: 0.3, y: 0.35 }, 1);
    expect(sameGeometry({ left: 0.25, top: 0.325, right: 0.35, bottom: 0.375 }, op.geometry)).toBe(true);
    expect(sameGeometry(op.geometry, { left: 0.2500004, top: 0.325, right: 0.35, bottom: 0.375, feather: 50 })).toBe(true);
    expect(sameGeometry(op.geometry, { left: 0.251, top: 0.325, right: 0.35, bottom: 0.375 })).toBe(false);
    expect(sameGeometry({ zero: { x: 0.5, y: 0.64 } }, undefined)).toBe(false);
  });

  it("WORKED only with every case passed, both photos put back, a cropped photo and a turned one", () => {
    const crop = { left: 0.1, top: 0, right: 1, bottom: 1, angle: 0 };
    const full = { left: 0, top: 0, right: 1, bottom: 1, angle: 0 };
    const photo = (filename: string, orientation: string, frame: typeof crop, ok = true): PhotoResult => ({ filename, orientation, cases: [{ case: "A", ok, frame }, { case: "B", ok }], put_back: { ok: true, why: "" } });
    expect(verdict([photo("land.NEF", "AB", crop), photo("port.NEF", "BC", full)]).worked).toBe(true);
    expect(verdict([photo("land.NEF", "AB", crop), photo("port.NEF", "BC", full, false)]).worked).toBe(false);
    expect(verdict([photo("land.NEF", "AB", crop)]).lines.at(-1)).toMatch(/portrait/);
    expect(verdict([photo("port.NEF", "DA", full)]).lines.at(-1)).toMatch(/cropped/);
    expect(verdict([{ ...photo("land.NEF", "AB", crop), put_back: { ok: false, why: "x" } }, photo("port.NEF", "BC", full)]).worked).toBe(false);
  });

  it("stops at the first photo not put back, so its put-back record is not overwritten by the next photo's", async () => {
    const seen: string[] = [];
    const one = async (name: string): Promise<PhotoResult> => {
      seen.push(name);
      return { filename: name, orientation: "AB", cases: [], put_back: { ok: name !== "land.NEF", why: "" } };
    };
    const results: PhotoResult[] = [];
    await eachPhoto(["land.NEF", "port.NEF"], one, results);
    expect(seen).toEqual(["land.NEF"]);
    expect(verdict(results).lines[0]).toMatch(/put back: NO$/);
    const all: PhotoResult[] = [];
    await eachPhoto(["port.NEF", "port2.NEF"], one, all);
    expect(all).toHaveLength(2);
  });
});
