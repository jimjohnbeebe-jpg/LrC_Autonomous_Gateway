// The image cap on tool results (src/mcp/image-cap.ts, used by respond() in src/mcp/server.ts; issue #78):
// an image whose base64 would pass the cap is re-encoded at lower quality, then made smaller, and the
// JSON text part says so in image_reduced; a small image passes unchanged.

import { randomBytes } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { IMAGE_CAP_CHARS } from "../src/mcp/image-cap.js";
import { respond } from "../src/mcp/server.js";

/** A JPEG of random noise: JPEG cannot compress it, so a 1600 px one is well over the cap. */
function noiseJpeg(width: number, height: number, quality = 90): Promise<Buffer> {
  return sharp(randomBytes(width * height * 3), { raw: { width, height, channels: 3 } }).jpeg({ quality }).toBuffer();
}

type Part = { type: string; data?: string; text?: string };

describe("image cap on tool results", () => {
  it("reduces an image over the cap below it and flags it in the JSON", async () => {
    const image = await noiseJpeg(1600, 1067);
    expect(image.toString("base64").length).toBeGreaterThan(IMAGE_CAP_CHARS);
    const res = await respond(async () => ({ json: { ok: true }, image }));
    const [img, text] = res.content as Part[];
    expect(img?.type).toBe("image");
    expect(img!.data!.length).toBeLessThanOrEqual(IMAGE_CAP_CHARS);
    type Reduced = { from_chars: number; to_chars: number; quality: number; long_edge: number; from_long_edge: number; note?: string };
    const json = JSON.parse(text!.text!) as { ok: boolean; image_reduced: Reduced };
    expect(json.ok).toBe(true);
    expect(json.image_reduced.from_chars).toBe(image.toString("base64").length);
    expect(json.image_reduced.to_chars).toBe(img!.data!.length);
    expect(json.image_reduced.quality).toBe(60);
    expect(json.image_reduced.long_edge).toBeLessThan(1600);
    const meta = await sharp(Buffer.from(img!.data!, "base64")).metadata();
    expect(Math.max(meta.width, meta.height)).toBe(json.image_reduced.long_edge);
    // Review, 2026-10-11: the result's own size fields describe the render, so a smaller image says so.
    expect(json.image_reduced.from_long_edge).toBe(1600);
    expect(json.image_reduced.note).toContain(`multiply them by ${json.image_reduced.long_edge}/1600`);
  });

  it("passes a small image unchanged, with no flag", async () => {
    const image = await noiseJpeg(200, 133);
    const res = await respond(async () => ({ json: { ok: true }, image }));
    const [img, text] = res.content as Part[];
    expect(img!.data).toBe(image.toString("base64"));
    expect(JSON.parse(text!.text!)).toEqual({ ok: true });
  });
});
