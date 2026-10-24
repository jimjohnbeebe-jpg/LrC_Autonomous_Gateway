// The colour of a preview at a point (issue #190): a colour range mask selects the colour sampled there.

import sharp from "sharp";

/** Half the side of the block averaged around the point, in pixels: one pixel is too noisy to sample [inference]. */
const HALF = 2;

/** The mean sRGB colour, 0-1 per channel, of the 5 x 5 pixels around `point` (0-1 of the image, from its top-left). */
export async function sampleColor(jpeg: Buffer, point: { x: number; y: number }): Promise<[number, number, number]> {
  const { data, info } = await sharp(jpeg).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cx = Math.min(info.width - 1, Math.round(point.x * (info.width - 1)));
  const cy = Math.min(info.height - 1, Math.round(point.y * (info.height - 1)));
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = Math.max(0, cy - HALF); y <= Math.min(info.height - 1, cy + HALF); y++) {
    for (let x = Math.max(0, cx - HALF); x <= Math.min(info.width - 1, cx + HALF); x++) {
      const i = (y * info.width + x) * info.channels;
      for (let c = 0; c < 3; c++) sum[c] = (sum[c] as number) + (data[i + c] as number);
      n++;
    }
  }
  return sum.map((v) => Math.round((v / n / 255) * 1e6) / 1e6) as [number, number, number];
}
