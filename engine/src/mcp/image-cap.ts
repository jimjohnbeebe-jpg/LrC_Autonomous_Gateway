// The cap on a tool result's image (issue #78). Claude Desktop refused a 1600 px lr_get_preview and an
// lr_create_mask result as over its 1 MB tool-result limit, while 1200 px previews came back
// [stated: Jim, issue #78 body]. Whether that limit counts the base64 image alone or the whole result,
// and whether it is exactly 1,000,000 bytes, is [unverified]; hence the cap is on the base64 length with
// a margin for the JSON text part. Over the cap, the JPEG is re-encoded at lower quality first, down to
// a floor, then made smaller (long edge) until it fits [stated: Jim, 2026-10-11, "Cap 900k + degrade"].
// Metrics are not affected: they are measured on the render before this.
// Issue #216 checked this against Claude's own limits as Automaat states them: images over 5 MB of base64
// are rejected, and over 2000 px once a request holds more than 20 images [upstream claim: Automaat/lightroom-mcp
// 1040453, plugin\LightroomMCP.lrplugin\HandlerPreview.lua:21-25, MAX_BYTES 3.5 MB and MAX_EDGE 2000]. The
// 900,000-character cap is far under the first; the second had no cap here, though no tool sends more than
// 1920 px today [inference: MAX_LONG_EDGE in tools-shared.ts, which region crops and composites fit inside].
// IMAGE_MAX_EDGE now caps it, so a later tool cannot pass it: a longer image is made smaller first.

import sharp from "sharp";

/** Base64 characters an image may take in a tool result. */
export const IMAGE_CAP_CHARS = 900_000;
/** The longest edge an image may have in a tool result (issue #216). */
export const IMAGE_MAX_EDGE = 2000;
/** Qualities tried in turn, before the image is made smaller at the last one. */
const QUALITIES = [75, 70, 65, 60] as const;
const FLOOR_QUALITY = 60;
/** Below this the image is no use to look at; the loop stops even if it is still over the cap. */
const MIN_LONG_EDGE = 200;

/** `note`, when the image was made smaller: the result's other size fields (a region's width, scale) still describe the render. */
export type ImageReduced = { from_chars: number; to_chars: number; quality: number; long_edge: number; from_long_edge: number; note?: string };

const smallerNote = (from: number, to: number): string =>
  `The image was made smaller to fit the tool result: it is ${to} px on the long edge, the render ${from} px. ` +
  `Sizes, positions and scales elsewhere in this result describe the render; multiply them by ${to}/${from} for the image shown.`;

const b64 = (n: number): number => 4 * Math.ceil(n / 3);

/** The image as it goes into the result, and what was done to it when it was over `cap` or `maxEdge`. */
export async function capImage(image: Buffer, cap = IMAGE_CAP_CHARS, maxEdge = IMAGE_MAX_EDGE): Promise<{ image: Buffer; reduced?: ImageReduced }> {
  const from = b64(image.length);
  const meta = await sharp(image).metadata();
  if (from <= cap && Math.max(meta.width, meta.height) <= maxEdge) return { image };
  // rotate() applies the EXIF orientation, since re-encoding drops the tag (see preview\composite.ts).
  const { data, info } = await sharp(image).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const raw = { width: info.width, height: info.height, channels: info.channels };
  const fromEdge = Math.max(info.width, info.height);
  const encode = (quality: number, longEdge = Math.min(fromEdge, maxEdge)) =>
    (longEdge >= fromEdge ? sharp(data, { raw }) : sharp(data, { raw }).resize(longEdge, longEdge, { fit: "inside" })).jpeg({ quality }).toBuffer();
  const done = async (out: Buffer, quality: number) => {
    const meta = await sharp(out).metadata();
    const edge = Math.max(meta.width, meta.height);
    const note = edge < fromEdge ? { note: smallerNote(fromEdge, edge) } : {};
    return { image: out, reduced: { from_chars: from, to_chars: b64(out.length), quality, long_edge: edge, from_long_edge: fromEdge, ...note } };
  };
  let out = image;
  for (const quality of QUALITIES) {
    out = await encode(quality);
    if (b64(out.length) <= cap) return done(out, quality);
  }
  let longEdge = Math.min(fromEdge, maxEdge);
  while (b64(out.length) > cap && longEdge > MIN_LONG_EDGE) {
    // JPEG size grows about with the pixel count [inference], so scale the edge by the square root, a bit under.
    longEdge = Math.max(MIN_LONG_EDGE, Math.min(longEdge - 1, Math.floor(longEdge * Math.sqrt(cap / b64(out.length)) * 0.95)));
    out = await encode(FLOOR_QUALITY, longEdge);
  }
  return done(out, FLOOR_QUALITY);
}
