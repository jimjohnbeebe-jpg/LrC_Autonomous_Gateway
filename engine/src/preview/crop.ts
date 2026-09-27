// Region crops of a preview (lr_get_preview with `region`, MCP_TOOLS; PRD section 6.8).
//
// The crop is cut from the preview as rendered and never enlarged: a crop smaller than `longEdge`
// is returned at the preview's own pixels, a larger one is shrunk to fit. `scale` is output pixels
// per preview pixel (1 when not shrunk); the tool multiplies it by the preview's scale against the
// photo to report `effective_scale`.

import sharp from "sharp";
import { boxToRect, type PixelRect, type RegionBox } from "../metrics/index.js";

export type Crop = {
  jpeg: Buffer;
  width: number;
  height: number;
  /** The rectangle cut from the (upright) preview. */
  rect: PixelRect;
  /** The preview's upright size. */
  source: { width: number; height: number };
  scale: number;
};

export async function cropRegion(image: Buffer, box: RegionBox, options: { longEdge: number; quality: number }): Promise<Crop> {
  const upright = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const source = { width: upright.info.width, height: upright.info.height };
  const rect = boxToRect(box, source.width, source.height);
  const out = await sharp(upright.data, { raw: { width: source.width, height: source.height, channels: upright.info.channels } })
    .extract(rect)
    .resize({ width: options.longEdge, height: options.longEdge, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: options.quality })
    .toBuffer({ resolveWithObject: true });
  return {
    jpeg: out.data,
    width: out.info.width,
    height: out.info.height,
    rect,
    source,
    scale: Math.round((out.info.width / rect.width) * 10000) / 10000,
  };
}
