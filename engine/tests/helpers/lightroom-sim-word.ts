// A printed word on the simulated Lightroom's preview (lightroom-sim.ts previewWord), for the client
// probe (engine\tests\probe\, ISSUE155_PLAN R5 T3): a light box with dark text in the middle of the
// grey noise, so a client's model can read the word back and a machine can check it. sharp renders
// the SVG; that its text shows is checked by the probe's self-check (a) and cited in
// docs\reports\phase8.5\clients-probe.md, not assumed.

import sharp from "sharp";

export type Img = ReturnType<typeof sharp>;

/** The box in pixels, centred: 80 % of the width, twice the font size high. */
export function wordBox(width: number, height: number): { left: number; top: number; width: number; height: number; font: number } {
  const font = Math.round(0.12 * Math.max(width, height));
  const w = Math.round(0.8 * width);
  const h = Math.min(height, 2 * font);
  return { left: Math.round((width - w) / 2), top: Math.round((height - h) / 2), width: w, height: h, font };
}

const escape = (s: string): string => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** `img` (a sharp pipeline or JPEG bytes) with `word` printed over it; the pipeline unchanged for null. */
export function overlayWord(img: Img | Buffer, word: string | null, width: number, height: number): Img {
  const pipeline = Buffer.isBuffer(img) ? sharp(img) : img;
  if (word === null) return pipeline;
  const b = wordBox(width, height);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<rect x="${b.left}" y="${b.top}" width="${b.width}" height="${b.height}" fill="rgb(235,235,235)"/>` +
    `<text x="${width / 2}" y="${b.top + b.height / 2 + 0.35 * b.font}" font-family="Arial, sans-serif" font-weight="bold" ` +
    `font-size="${b.font}" text-anchor="middle" fill="rgb(20,20,20)">${escape(word)}</text></svg>`;
  return pipeline.composite([{ input: Buffer.from(svg), left: 0, top: 0 }]);
}
