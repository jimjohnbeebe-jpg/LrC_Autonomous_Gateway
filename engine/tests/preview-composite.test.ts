// Composites, region crops and the label font (src/preview/composite.ts, crop.ts, font.ts).

import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { COMPOSITE_GUTTER, COMPOSITE_LABEL_STRIP, composite, cropRegion, planLayout } from "../src/preview/index.js";
import { GLYPH_HEIGHT, GLYPH_WIDTH, glyphFor, textWidth } from "../src/preview/font.js";

type Rgb = { r: number; g: number; b: number };
const solid = (width: number, height: number, background: Rgb): Promise<Buffer> =>
  sharp({ create: { width, height, channels: 3, background } }).jpeg({ quality: 95 }).toBuffer();
const RED = { r: 255, g: 0, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };

async function pixels(jpeg: Buffer) {
  const { data, info } = await sharp(jpeg).raw().toBuffer({ resolveWithObject: true });
  const at = (x: number, y: number): Rgb => {
    const i = (y * info.width + x) * info.channels;
    return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
  };
  return { info, at };
}

describe("composite: layout", () => {
  it("stacks two landscape previews in a column, which shows them larger than a row", () => {
    const sizes = [{ width: 1600, height: 1067 }, { width: 1600, height: 1067 }];
    expect(planLayout(sizes, "row", 1600)).toEqual([{ width: 797, height: 532 }, { width: 797, height: 532 }]);
    expect(planLayout(sizes, "column", 1600)).toEqual([{ width: 1169, height: 779 }, { width: 1169, height: 779 }]);
  });

  it("puts two portrait previews side by side", () => {
    const sizes = [{ width: 1067, height: 1600 }, { width: 1067, height: 1600 }];
    const row = planLayout(sizes, "row", 1600)!;
    const column = planLayout(sizes, "column", 1600)!;
    expect(row[0]!.width * row[0]!.height).toBeGreaterThan(column[0]!.width * column[0]!.height);
  });

  it("never enlarges a panel", () => {
    expect(planLayout([{ width: 100, height: 50 }, { width: 100, height: 50 }], "row", 1600)).toEqual([{ width: 100, height: 50 }, { width: 100, height: 50 }]);
    expect(planLayout([{ width: 100, height: 50 }, { width: 100, height: 50 }], "column", 1600)).toEqual([{ width: 100, height: 50 }, { width: 100, height: 50 }]);
  });
});

describe("composite: image", () => {
  it("draws before / after within the long edge, each under its label, on a dark background", async () => {
    const before = await solid(1600, 1067, RED);
    const after = await solid(1600, 1067, BLUE);
    const out = await composite([{ image: before, label: "before" }, { image: after, label: "after" }], { longEdge: 1600, quality: 75 });
    expect(out.layout).toBe("column");
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(1600);
    expect(out.width).toBe(1169);
    expect(out.height).toBe(2 * (COMPOSITE_LABEL_STRIP + 779) + COMPOSITE_GUTTER);
    expect(out.panels).toEqual([
      { label: "before", left: 0, top: COMPOSITE_LABEL_STRIP, width: 1169, height: 779 },
      { label: "after", left: 0, top: 2 * COMPOSITE_LABEL_STRIP + 779 + COMPOSITE_GUTTER, width: 1169, height: 779 },
    ]);

    const { info, at } = await pixels(out.jpeg);
    expect([info.width, info.height]).toEqual([out.width, out.height]);
    const centre = (p: (typeof out.panels)[number]) => at(p.left + Math.floor(p.width / 2), p.top + Math.floor(p.height / 2));
    const top = centre(out.panels[0]!);
    const bottom = centre(out.panels[1]!);
    expect(top.r).toBeGreaterThan(200);
    expect(top.b).toBeLessThan(60);
    expect(bottom.b).toBeGreaterThan(200);
    expect(bottom.r).toBeLessThan(60);

    // The label strip holds light text pixels; its right end is plain background.
    let light = 0;
    for (let y = 0; y < COMPOSITE_LABEL_STRIP; y++) for (let x = 0; x < 100; x++) if (at(x, y).g > 150) light++;
    expect(light).toBeGreaterThan(20);
    const bg = at(out.width - 3, 3);
    expect(Math.abs(bg.r - 30)).toBeLessThan(12);
  });

  it("takes three panels (A / B / C) and gives the same bytes for the same input", async () => {
    const panels = [
      { image: await solid(300, 200, RED), label: "A" },
      { image: await solid(300, 200, BLUE), label: "B" },
      { image: await solid(300, 200, { r: 0, g: 255, b: 0 }), label: "C" },
    ];
    const one = await composite(panels, { longEdge: 1600, quality: 75 });
    const two = await composite(panels, { longEdge: 1600, quality: 75 });
    expect(one.panels).toHaveLength(3);
    expect(one.jpeg.equals(two.jpeg)).toBe(true);
  });

  it("refuses fewer than two or more than four panels", async () => {
    const img = await solid(10, 10, RED);
    await expect(composite([{ image: img, label: "x" }], { longEdge: 800, quality: 75 })).rejects.toThrow(RangeError);
    const five = Array.from({ length: 5 }, () => ({ image: img, label: "x" }));
    await expect(composite(five, { longEdge: 800, quality: 75 })).rejects.toThrow(RangeError);
  });
});

describe("crop", () => {
  // 200 x 100: the left half red, the right half blue.
  const halves = () =>
    sharp({ create: { width: 200, height: 100, channels: 3, background: RED } })
      .composite([{ input: { create: { width: 100, height: 100, channels: 3, background: BLUE } }, left: 100, top: 0 }])
      .png()
      .toBuffer();

  it("cuts the box at the preview's own pixels", async () => {
    const crop = await cropRegion(await halves(), { x: 0.5, y: 0, w: 0.5, h: 1 }, { longEdge: 1600, quality: 90 });
    expect(crop).toMatchObject({ width: 100, height: 100, rect: { left: 100, top: 0, width: 100, height: 100 }, source: { width: 200, height: 100 }, scale: 1 });
    const { at } = await pixels(crop.jpeg);
    expect(at(50, 50).b).toBeGreaterThan(200);
    expect(at(50, 50).r).toBeLessThan(60);
  });

  it("shrinks a crop larger than the long edge and says by how much", async () => {
    const crop = await cropRegion(await halves(), { x: 0, y: 0, w: 1, h: 1 }, { longEdge: 50, quality: 90 });
    expect([crop.width, crop.height, crop.scale]).toEqual([50, 25, 0.25]);
  });

  it("crops the upright image when the preview carries a rotation tag", async () => {
    const tagged = await sharp(await halves()).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const crop = await cropRegion(tagged, { x: 0, y: 0, w: 1, h: 0.5 }, { longEdge: 1600, quality: 90 });
    expect(crop.source).toEqual({ width: 100, height: 200 });
    expect(crop.rect).toEqual({ left: 0, top: 0, width: 100, height: 100 });
  });
});

describe("label font", () => {
  it("has 7 rows of 5 pixels for every glyph it draws", () => {
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 /-+=.,:()%?") {
      const rows = glyphFor(ch);
      expect(rows, ch).toHaveLength(GLYPH_HEIGHT);
      for (const r of rows) expect(r, ch).toMatch(new RegExp(`^[#.]{${GLYPH_WIDTH}}$`));
    }
  });

  it("draws lower case as upper case and anything else as ?", () => {
    expect(glyphFor("a")).toEqual(glyphFor("A"));
    expect(glyphFor("é")).toEqual(glyphFor("?"));
  });

  it("measures text: 5 pixels per glyph, 1 between, times the scale", () => {
    expect(textWidth("", 2)).toBe(0);
    expect(textWidth("AB", 2)).toBe(22);
  });
});
