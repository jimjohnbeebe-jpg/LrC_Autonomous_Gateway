// measure_long_edge (issue #168): with `measureEdge` the preview service exports at that edge, measures
// the whole export and sends on the JPEG shrunk to the long edge; without it nothing changes.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { BridgeClient } from "../src/bridge/index.js";
import { measureImage } from "../src/metrics/index.js";
import { PreviewService, measureAgain } from "../src/preview/index.js";

let tmp: string;
let sent: Array<{ name: string; payload: Record<string, unknown> }>;
/** The long edge the stub exports at, whatever is asked (a photo smaller than the request); null: as asked. */
let exportEdge: number | null;
let service: PreviewService;

/** A dark 3:2 frame with isolated 2 x 2 white dots every 64 px: they clip at full size and average away when shrunk. */
async function writeExport(file: string, long: number): Promise<void> {
  const height = Math.round((long * 2) / 3);
  const pixels = Buffer.alloc(long * height * 3, 20);
  for (let y = 32; y < height - 2; y += 64) for (let x = 32; x < long - 2; x += 64) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) pixels.fill(255, ((y + dy) * long + x + dx) * 3, ((y + dy) * long + x + dx + 1) * 3);
  await sharp(pixels, { raw: { width: long, height, channels: 3 } }).jpeg({ quality: 100 }).toFile(file);
}

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-measure-"));
  sent = [];
  exportEdge = null;
  let n = 0;
  const client = {
    request: async (name: string, payload: Record<string, unknown>) => {
      sent.push({ name, payload });
      const dir = path.join(tmp, String(n++));
      mkdirSync(dir);
      const file = path.join(dir, "export.jpg");
      await writeExport(file, exportEdge ?? Number(payload["long_edge"]));
      return { uuid: "U", path: file, export_ms: 1 };
    },
  } as unknown as BridgeClient;
  service = new PreviewService(client, { previewDir: tmp });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

it("exports at measureEdge, measures the whole export and sends the JPEG at the long edge", async () => {
  const out = await service.render({ longEdge: 1600, quality: 75, measureEdge: 4096 });
  expect(sent).toEqual([{ name: "export_preview", payload: { long_edge: 4096, quality: 75 } }]);
  expect([out.width, out.height, out.reencoded, out.measured_long_edge]).toEqual([1600, 1067, true, 4096]);
  expect([out.metrics.width, out.metrics.height]).toEqual([4096, 2731]);
  // The dots clip at full size; the 1600 px JPEG sent on hides them.
  expect(out.metrics.clip_high_tone_pct).toBeGreaterThan(0);
  const sentImage = await measureImage(out.jpeg);
  expect(sentImage.clip_high_tone_pct).toBeLessThan(out.metrics.clip_high_tone_pct / 10);
  // Measured again (lr_set_regions), it is the same export, not the JPEG sent.
  expect(await measureAgain(out, [])).toEqual(out.metrics);
});

it("changes nothing without measureEdge, or with one no larger than the long edge", async () => {
  for (const measureEdge of [undefined, null, 1600, 1200]) {
    sent = [];
    const out = await service.render({ longEdge: 1600, quality: 75, ...(measureEdge !== undefined ? { measureEdge } : {}) });
    expect(sent).toEqual([{ name: "export_preview", payload: { long_edge: 1600, quality: 75 } }]);
    expect([out.width, out.reencoded, out.measured_long_edge]).toEqual([1600, false, 1600]);
    expect(out.metrics).toEqual(await measureImage(out.jpeg));
  }
});

it("ignores measureEdge for a fast (thumbnail) preview", async () => {
  const out = await service.render({ longEdge: 1600, quality: 75, measureEdge: 4096, fast: true });
  expect(sent).toEqual([{ name: "thumbnail_preview", payload: { long_edge: 1600 } }]);
  expect(out.measured_long_edge).toBe(1600);
});

it("does not re-encode when the export comes back no larger than the long edge", async () => {
  exportEdge = 1200;
  const out = await service.render({ longEdge: 1600, quality: 75, measureEdge: 4096 });
  expect(sent[0]?.payload).toEqual({ long_edge: 4096, quality: 75 });
  expect([out.width, out.reencoded, out.measured_long_edge]).toEqual([1200, false, 1200]);
});
