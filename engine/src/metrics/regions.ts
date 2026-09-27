// Regions: normalised boxes on the photo (lr_set_regions, MCP_TOOLS; PRD section 6.7).
//
// A box is { x, y, w, h } in 0-1 of the image's width and height, from the top-left corner, so the
// same box names the same part of the photo at any preview size. boxToRect turns it into whole
// pixels of one image: the rectangle covers every pixel the box touches, and at least one pixel
// [handle: tests\metrics.test.ts "turns a normalised box into the pixels it touches, at least one"].

export type RegionBox = { x: number; y: number; w: number; h: number };
export type Region = { label: string; box: RegionBox };
export type PixelRect = { left: number; top: number; width: number; height: number };

/** Slack for boxes whose edge is computed, e.g. x = 0.7 and w = 0.3 adding up to 1.0000000000000002. */
const EDGE_SLACK = 1e-9;

/** Why the box is not a valid normalised box, or null when it is. */
export function boxProblem(box: RegionBox): string | null {
  const { x, y, w, h } = box;
  if (![x, y, w, h].every(Number.isFinite)) return "x, y, w and h must be finite numbers";
  if (x < 0 || y < 0 || x >= 1 || y >= 1) return "x and y must be from 0 up to (not including) 1";
  if (w <= 0 || h <= 0) return "w and h must be greater than 0";
  if (x + w > 1 + EDGE_SLACK || y + h > 1 + EDGE_SLACK) return "the box must end inside the image (x + w <= 1, y + h <= 1)";
  return null;
}

/** The pixel rectangle of a normalised box on a width x height image. Throws RangeError on a bad box. */
export function boxToRect(box: RegionBox, width: number, height: number): PixelRect {
  const problem = boxProblem(box);
  if (problem) throw new RangeError(`bad region box ${JSON.stringify(box)}: ${problem}`);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`bad image size ${width}x${height}`);
  }
  const left = Math.min(width - 1, Math.floor(box.x * width));
  const top = Math.min(height - 1, Math.floor(box.y * height));
  const right = Math.min(width, Math.max(left + 1, Math.ceil((box.x + box.w) * width)));
  const bottom = Math.min(height, Math.max(top + 1, Math.ceil((box.y + box.h) * height)));
  return { left, top, width: right - left, height: bottom - top };
}
