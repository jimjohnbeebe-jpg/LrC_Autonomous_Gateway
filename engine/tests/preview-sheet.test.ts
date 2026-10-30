// Contact sheets (src/preview/sheet.ts, issues #111, #112): the grid, the fit inside the long edge,
// no enlarging, the same bytes for the same input, and an EXIF-rotated cell.

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { COMPOSITE_LABEL_STRIP, MAX_SHEET_CELLS, contactSheet } from "../src/preview/index.js";

type Rgb = { r: number; g: number; b: number };
const solid = (width: number, height: number, background: Rgb, orientation?: number): Promise<Buffer> => {
  const img = sharp({ create: { width, height, channels: 3, background } });
  return (orientation ? img.withMetadata({ orientation }) : img).jpeg({ quality: 95 }).toBuffer();
};
const GREEN = { r: 0, g: 200, b: 0 };
const cellsOf = async (n: number, w = 800, h = 533) => {
  const image = await solid(w, h, GREEN);
  return Array.from({ length: n }, (_, i) => ({ image, label: String(i + 1) }));
};
const opts = { longEdge: 2000, quality: 75 };

describe("contactSheet", () => {
  it.each([1, 5, 16])("fits %i cells inside the long edge, in a grid of ceil(sqrt(n)) columns", async (n) => {
    const out = await contactSheet(await cellsOf(n), opts);
    expect(out.cols).toBe(Math.ceil(Math.sqrt(n)));
    expect(out.rows).toBe(Math.ceil(n / out.cols));
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(2000);
    const meta = await sharp(out.jpeg).metadata();
    expect([meta.width, meta.height]).toEqual([out.width, out.height]);
    expect(out.cells.map((c) => c.label)).toEqual(Array.from({ length: n }, (_, i) => String(i + 1)));
    // Cells are in reading order: left to right, then down.
    if (n > 1) expect(out.cells[1]!.left).toBeGreaterThan(out.cells[0]!.left);
    if (n === 16) expect(out.cells[4]!.top).toBeGreaterThan(out.cells[0]!.top);
  });

  it("never enlarges a cell, and does not pad a sheet of small images out to the long edge", async () => {
    const out = await contactSheet(await cellsOf(2, 300, 200), opts);
    expect(out.cells.map((c) => [c.width, c.height])).toEqual([[300, 200], [300, 200]]);
    expect(out.height).toBe(COMPOSITE_LABEL_STRIP + 200);
    expect(out.width).toBeLessThan(700);
  });

  it("gives the same bytes for the same input", async () => {
    const cells = await cellsOf(5);
    const [a, b] = await Promise.all([contactSheet(cells, opts), contactSheet(cells, opts)]);
    expect(a.jpeg.equals(b.jpeg)).toBe(true);
  });

  it("shows an EXIF orientation 6 image as a portrait cell", async () => {
    const turned = await solid(800, 533, GREEN, 6);
    const out = await contactSheet([{ image: turned, label: "1" }, { image: await solid(800, 533, GREEN), label: "2" }], opts);
    expect(out.cells[0]!.height).toBeGreaterThan(out.cells[0]!.width);
    expect(out.cells[1]!.width).toBeGreaterThan(out.cells[1]!.height);
  });

  it(`takes 1 to ${MAX_SHEET_CELLS} cells`, async () => {
    await expect(contactSheet([], opts)).rejects.toThrow(RangeError);
    await expect(contactSheet(await cellsOf(MAX_SHEET_CELLS + 1), opts)).rejects.toThrow(RangeError);
  });
});
