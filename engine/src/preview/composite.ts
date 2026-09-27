// Composites of two (before / after) or three (A / B / C) previews in one image (ARCHITECTURE
// section 6.5; PRD section 6.8: one image per tool result, NFR-3).
//
// Each panel gets an 18 px label strip above it; panels are 4 px apart. They go side by side (a row)
// or one above the other (a column), whichever shows the panels larger, and the whole composite
// fits inside `longEdge`. Nothing is enlarged: planLayout caps a panel at its own size [handle:
// tests\preview-composite.test.ts "never enlarges a panel"]. The panels are decoded to raw pixels
// and the composite is encoded as JPEG once, at `quality` (the single .jpeg() call in composite()
// below), so they are not compressed twice.

import sharp from "sharp";
import { drawText, GLYPH_HEIGHT, type Rgb } from "./font.js";

export const COMPOSITE_GUTTER = 4;
export const COMPOSITE_LABEL_STRIP = 18;
const BACKGROUND: Rgb = { r: 30, g: 30, b: 30 };
const LABEL_COLOR: Rgb = { r: 230, g: 230, b: 230 };
const LABEL_PADDING = 6;

export type Panel = { image: Buffer; label: string };
export type PlacedPanel = { label: string; left: number; top: number; width: number; height: number };
export type Composite = {
  jpeg: Buffer;
  width: number;
  height: number;
  layout: "row" | "column";
  /** Where each panel's image sits (below its label strip). */
  panels: PlacedPanel[];
};

type Size = { width: number; height: number };

/**
 * The displayed size. EXIF orientations 5-8 include a quarter turn, so width and height swap
 * [handle: EXIF 2.32 (CIPA DC-008-2019) tag 0x0112 Orientation, values 5-8; sharp's rotate() applies
 * the tag, https://sharp.pixelplumbing.com/api-operation#rotate; observed with sharp 0.35.4 in
 * tests\preview-composite.test.ts: a 200 x 100 JPEG tagged 6 crops as 100 x 200, and composites as a
 * portrait panel].
 */
async function displayedSize(image: Buffer): Promise<Size> {
  const meta = await sharp(image).metadata();
  const turned = meta.orientation !== undefined && meta.orientation >= 5;
  return turned ? { width: meta.height, height: meta.width } : { width: meta.width, height: meta.height };
}

/** Panel sizes for a row (common height) or a column (common width), or null if nothing fits. */
export function planLayout(sizes: readonly Size[], layout: "row" | "column", longEdge: number, gutter = COMPOSITE_GUTTER, strip = COMPOSITE_LABEL_STRIP): Size[] | null {
  const n = sizes.length;
  const aspects = sizes.map((s) => s.width / s.height);
  if (layout === "row") {
    const sumAspect = aspects.reduce((a, b) => a + b, 0);
    const height = Math.floor(Math.min((longEdge - gutter * (n - 1)) / sumAspect, longEdge - strip, ...sizes.map((s) => s.height)));
    if (height < 1) return null;
    const out = aspects.map((a) => ({ width: Math.max(1, Math.floor(a * height)), height }));
    return out;
  }
  const sumInverse = aspects.reduce((a, b) => a + 1 / b, 0);
  const width = Math.floor(Math.min((longEdge - n * strip - gutter * (n - 1)) / sumInverse, longEdge, ...sizes.map((s) => s.width)));
  if (width < 1) return null;
  return aspects.map((a) => ({ width, height: Math.max(1, Math.floor(width / a)) }));
}

const area = (sizes: readonly Size[] | null): number => (sizes ? sizes.reduce((sum, s) => sum + s.width * s.height, 0) : 0);

export async function composite(panels: readonly Panel[], options: { longEdge: number; quality: number }): Promise<Composite> {
  if (panels.length < 2 || panels.length > 4) throw new RangeError(`a composite takes 2 to 4 panels, got ${panels.length}`);
  const gutter = COMPOSITE_GUTTER;
  const strip = COMPOSITE_LABEL_STRIP;
  const sizes = await Promise.all(panels.map((p) => displayedSize(p.image)));
  const row = planLayout(sizes, "row", options.longEdge);
  const column = planLayout(sizes, "column", options.longEdge);
  const layout: "row" | "column" = area(column) > area(row) ? "column" : "row";
  const planned = layout === "row" ? row : column;
  if (!planned) throw new RangeError(`the panels do not fit in a long edge of ${options.longEdge} px`);

  const placed: PlacedPanel[] = [];
  let width: number;
  let height: number;
  if (layout === "row") {
    let x = 0;
    planned.forEach((size, i) => {
      placed.push({ label: panels[i]!.label, left: x, top: strip, width: size.width, height: size.height });
      x += size.width + gutter;
    });
    width = x - gutter;
    height = strip + (planned[0]?.height ?? 0);
  } else {
    let y = 0;
    planned.forEach((size, i) => {
      placed.push({ label: panels[i]!.label, left: 0, top: y + strip, width: size.width, height: size.height });
      y += strip + size.height + gutter;
    });
    width = planned[0]?.width ?? 0;
    height = y - gutter;
  }

  // The canvas: background, then each label in the strip above its panel.
  const canvas = new Uint8Array(width * height * 3);
  for (let i = 0; i < canvas.length; i += 3) {
    canvas[i] = BACKGROUND.r;
    canvas[i + 1] = BACKGROUND.g;
    canvas[i + 2] = BACKGROUND.b;
  }
  const scale = Math.max(1, Math.floor((strip - 4) / GLYPH_HEIGHT));
  const textTop = Math.floor((strip - GLYPH_HEIGHT * scale) / 2);
  for (const p of placed) {
    drawText(canvas, width, p.label, p.left + LABEL_PADDING, p.top - strip + textTop, scale, LABEL_COLOR, p.left + p.width - LABEL_PADDING);
  }

  const layers = await Promise.all(
    placed.map(async (p, i) => {
      const { data, info } = await sharp(panels[i]!.image)
        .rotate()
        .resize(p.width, p.height, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { input: data, raw: { width: info.width, height: info.height, channels: info.channels }, left: p.left, top: p.top };
    }),
  );
  const jpeg = await sharp(canvas, { raw: { width, height, channels: 3 } }).composite(layers).jpeg({ quality: options.quality }).toBuffer();
  return { jpeg, width, height, layout, panels: placed };
}
