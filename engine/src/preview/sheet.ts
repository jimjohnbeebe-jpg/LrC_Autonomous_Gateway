// Contact sheets (issues #111, #112): up to 16 previews in one numbered grid image, so a chat can look
// through a shoot one sheet at a time instead of one image result per photo.
//
// The grid has cols = ceil(sqrt(n)) columns and equal cell boxes; each box has the label strip of a
// composite above it (composite.ts, the same 5 x 7 font, font.ts), boxes are COMPOSITE_GUTTER apart, and
// the whole sheet fits inside `longEdge`. Each image is fitted inside its box, centred, and never
// enlarged. A box is no wider than the widest image and no taller than the tallest, so a sheet of small previews is not padded out.
// The images are decoded to raw pixels and the sheet is encoded as JPEG once, at `quality`.

import sharp from "sharp";
import { COMPOSITE_GUTTER, COMPOSITE_LABEL_STRIP, displayedSize, labelledCanvas, type Panel, type PlacedPanel } from "./composite.js";

export const MAX_SHEET_CELLS = 16;

export type ContactSheet = {
  jpeg: Buffer;
  width: number;
  height: number;
  cols: number;
  rows: number;
  /** Where each cell's image sits, in the order given. */
  cells: PlacedPanel[];
};

export async function contactSheet(cells: readonly Panel[], options: { longEdge: number; quality: number }): Promise<ContactSheet> {
  const n = cells.length;
  if (n < 1 || n > MAX_SHEET_CELLS) throw new RangeError(`a contact sheet takes 1 to ${MAX_SHEET_CELLS} cells, got ${n}`);
  const gutter = COMPOSITE_GUTTER;
  const strip = COMPOSITE_LABEL_STRIP;
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const sizes = await Promise.all(cells.map((c) => displayedSize(c.image)));
  const boxW = Math.min(Math.floor((options.longEdge - gutter * (cols - 1)) / cols), Math.max(...sizes.map((s) => s.width)));
  const boxH = Math.min(Math.floor((options.longEdge - rows * strip - gutter * (rows - 1)) / rows), Math.max(...sizes.map((s) => s.height)));
  if (boxW < 1 || boxH < 1) throw new RangeError(`the cells do not fit in a long edge of ${options.longEdge} px`);
  const width = cols * boxW + gutter * (cols - 1);
  const height = rows * (strip + boxH) + gutter * (rows - 1);

  const boxes: PlacedPanel[] = [];
  const placed: PlacedPanel[] = sizes.map((s, i) => {
    const left = (i % cols) * (boxW + gutter);
    const top = Math.floor(i / cols) * (strip + boxH + gutter) + strip;
    boxes.push({ label: cells[i]!.label, left, top, width: boxW, height: boxH });
    const scale = Math.min(boxW / s.width, boxH / s.height, 1);
    const w = Math.max(1, Math.floor(s.width * scale));
    const h = Math.max(1, Math.floor(s.height * scale));
    return { label: cells[i]!.label, left: left + Math.floor((boxW - w) / 2), top: top + Math.floor((boxH - h) / 2), width: w, height: h };
  });

  const canvas = labelledCanvas(width, height, boxes);
  const layers = await Promise.all(
    placed.map(async (p, i) => {
      const { data, info } = await sharp(cells[i]!.image).rotate().resize(p.width, p.height, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return { input: data, raw: { width: info.width, height: info.height, channels: info.channels }, left: p.left, top: p.top };
    }),
  );
  const jpeg = await sharp(canvas, { raw: { width, height, channels: 3 } }).composite(layers).jpeg({ quality: options.quality }).toBuffer();
  return { jpeg, width, height, cols, rows, cells: placed };
}
