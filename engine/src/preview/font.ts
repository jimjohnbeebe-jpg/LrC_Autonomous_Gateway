// A 5 x 7 pixel font for the labels on composites (ARCHITECTURE section 6.5).
//
// Labels are drawn from this table rather than with sharp's SVG or Pango text, so they do not depend
// on the fonts installed on the machine [inference: sharp's text rendering goes through the
// system's fontconfig; not tested here]. The same labels give the same composite bytes [handle:
// tests\preview-composite.test.ts "takes three panels (A / B / C) and gives the same bytes for the
// same input", on this machine; across machines is not tested].
// Letters are upper case; a character without a glyph is drawn as "?".

const GLYPHS: Readonly<Record<string, string>> = {
  A: ".###.|#...#|#...#|#####|#...#|#...#|#...#",
  B: "####.|#...#|#...#|####.|#...#|#...#|####.",
  C: ".###.|#...#|#....|#....|#....|#...#|.###.",
  D: "####.|#...#|#...#|#...#|#...#|#...#|####.",
  E: "#####|#....|#....|####.|#....|#....|#####",
  F: "#####|#....|#....|####.|#....|#....|#....",
  G: ".###.|#...#|#....|#.###|#...#|#...#|.####",
  H: "#...#|#...#|#...#|#####|#...#|#...#|#...#",
  I: ".###.|..#..|..#..|..#..|..#..|..#..|.###.",
  J: "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
  K: "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
  L: "#....|#....|#....|#....|#....|#....|#####",
  M: "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
  N: "#...#|#...#|##..#|#.#.#|#..##|#...#|#...#",
  O: ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
  P: "####.|#...#|#...#|####.|#....|#....|#....",
  Q: ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
  R: "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
  S: ".####|#....|#....|.###.|....#|....#|####.",
  T: "#####|..#..|..#..|..#..|..#..|..#..|..#..",
  U: "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
  V: "#...#|#...#|#...#|#...#|#...#|.#.#.|..#..",
  W: "#...#|#...#|#...#|#.#.#|#.#.#|#.#.#|.#.#.",
  X: "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
  Y: "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
  Z: "#####|....#|...#.|..#..|.#...|#....|#####",
  "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
  "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
  "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
  "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
  "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
  "5": "#####|#....|####.|....#|....#|#...#|.###.",
  "6": "..##.|.#...|#....|####.|#...#|#...#|.###.",
  "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
  "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
  "9": ".###.|#...#|#...#|.####|....#|...#.|.##..",
  " ": ".....|.....|.....|.....|.....|.....|.....",
  "/": ".....|....#|...#.|..#..|.#...|#....|.....",
  "-": ".....|.....|.....|#####|.....|.....|.....",
  "+": ".....|..#..|..#..|#####|..#..|..#..|.....",
  "=": ".....|.....|#####|.....|#####|.....|.....",
  ".": ".....|.....|.....|.....|.....|.##..|.##..",
  ",": ".....|.....|.....|.....|.##..|..#..|.#...",
  ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
  "(": "...#.|..#..|.#...|.#...|.#...|..#..|...#.",
  ")": ".#...|..#..|...#.|...#.|...#.|..#..|.#...",
  "%": "##...|##..#|...#.|..#..|.#...|#..##|...##",
  "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Blank columns between two glyphs. */
export const GLYPH_SPACING = 1;

export function glyphFor(ch: string): readonly string[] {
  const rows = (GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"]) as string;
  return rows.split("|");
}

/** The width in pixels of `text` drawn at `scale`. */
export function textWidth(text: string, scale: number): number {
  const n = [...text].length;
  return n === 0 ? 0 : (n * (GLYPH_WIDTH + GLYPH_SPACING) - GLYPH_SPACING) * scale;
}

export type Rgb = { r: number; g: number; b: number };

/**
 * Draw `text` into an interleaved RGB buffer of width `bufWidth`, top-left at (left, top), each font
 * pixel a `scale` x `scale` square. Glyphs that would cross `maxRight` are not drawn.
 */
export function drawText(buf: Uint8Array, bufWidth: number, text: string, left: number, top: number, scale: number, color: Rgb, maxRight: number): void {
  const bufHeight = buf.length / (bufWidth * 3);
  let x0 = left;
  for (const ch of text) {
    if (x0 + GLYPH_WIDTH * scale > maxRight) break;
    const rows = glyphFor(ch);
    for (let gy = 0; gy < GLYPH_HEIGHT; gy++) {
      const row = rows[gy] ?? "";
      for (let gx = 0; gx < GLYPH_WIDTH; gx++) {
        if (row[gx] !== "#") continue;
        for (let sy = 0; sy < scale; sy++) {
          const y = top + gy * scale + sy;
          if (y < 0 || y >= bufHeight) continue;
          for (let sx = 0; sx < scale; sx++) {
            const x = x0 + gx * scale + sx;
            if (x < 0 || x >= bufWidth) continue;
            const i = (y * bufWidth + x) * 3;
            buf[i] = color.r;
            buf[i + 1] = color.g;
            buf[i + 2] = color.b;
          }
        }
      }
    }
    x0 += (GLYPH_WIDTH + GLYPH_SPACING) * scale;
  }
}
