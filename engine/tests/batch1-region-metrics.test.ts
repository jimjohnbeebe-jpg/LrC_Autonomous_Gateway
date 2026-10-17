// Region previews measure the requested box on the export at export resolution (hands-on batch 1):
// `metrics` stay the whole frame (metrics_scope "frame"), `crop_metrics` are the box's.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

let plugin: FakePlugin;
let client: BridgeClient;
let lr: LightroomSim;
let tmp: string;
let previewDir: string;
let tools: Tools;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-region-"));
  previewDir = path.join(tmp, "previews");
  mkdirSync(path.join(previewDir, "synthetic"), { recursive: true });
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.install(plugin);
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  client.start();
  tools = new Tools({
    client,
    map: loadDefaultParamMap(),
    previews: new PreviewService(client, { previewDir }),
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
});

afterEach(async () => {
  client.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** A dark 3000 x 2000 export (3:2, as the sim's photo) with a clipped white box at x 0.1-0.3, y 0.1-0.3; `orientation` 6 stores it turned. */
async function exportWithBox(orientation?: 6): Promise<void> {
  const box = await sharp({ create: { width: 600, height: 400, channels: 3, background: { r: 255, g: 255, b: 255 } } }).png().toBuffer();
  const upright = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 20, g: 20, b: 20 } } })
    .composite([{ input: box, left: 300, top: 200 }])
    .png()
    .toBuffer();
  const file = path.join(previewDir, "synthetic", "export.jpg");
  // Orientation 6 asks the viewer to turn the stored image 90 degrees clockwise, so it is stored turned 270.
  const stored = orientation ? sharp(upright).rotate(270).withMetadata({ orientation }) : sharp(upright);
  await stored.jpeg({ quality: 95 }).toFile(file);
  lr.exportPath = file;
}

const region = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

for (const orientation of [undefined, 6] as const) {
  it(`measures the box on the export, apart from the frame (orientation ${orientation ?? "none"})`, async () => {
    await exportWithBox(orientation);
    const out = await tools.getPreview({ long_edge: 800, region });
    const json = out.json as Record<string, any>;
    expect(json["metrics_scope"]).toBe("frame");
    expect(json["crop_metrics"].luma_mean).toBeGreaterThan(json["metrics"].luma_mean);
    // The box is all white: all of it clips; it is 4 % of the frame.
    expect(json["crop_metrics"].clip_high_pct).toBeGreaterThan(99);
    expect(json["metrics"].clip_high_pct).toBeGreaterThan(3);
    expect(json["metrics"].clip_high_pct).toBeLessThan(5);
    expect(json["crop_metrics"].pixels).toBe(600 * 400);
    expect(json["crop_metrics"]).not.toHaveProperty("label");
    // The box is not one of the frame's regions, nor of lr_get_metrics's.
    expect(json["metrics"].regions).toEqual([]);
    expect((await tools.getMetrics()).json["metrics"]).toMatchObject({ regions: [] });
  });
}
