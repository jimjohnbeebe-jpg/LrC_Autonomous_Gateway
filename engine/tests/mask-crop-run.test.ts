// `npm run masks:crop`'s steps (src/devtools/mask-crop-run.ts, GitHub issue #179) against the simulated
// plugin. The sim renders global settings only, so no radial shows and the gradient moves nothing: this
// checks the writes, the read-back through the crop frame and the renders, not Lightroom's placement.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { ANGLE_B, POINTS } from "../src/devtools/mask-crop-probe.js";
import { oneCase, runFor, turnCrop } from "../src/devtools/mask-crop-run.js";
import { BridgeGate } from "../src/mcp/index.js";
import { MASK_TABLE_KEY, toPhoto } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

const DSC0031 = { CropLeft: 0.008115, CropTop: 0.027339, CropRight: 0.942612, CropBottom: 0.961839, CropAngle: 0, orientation: "AB" };
let tmp = "";
let plugin: FakePlugin;
let lr: LightroomSim;
let client: BridgeClient;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-maskcrop-"));
  mkdirSync(path.join(tmp, "previews"));
  plugin = await FakePlugin.start();
  lr = new LightroomSim(path.join(tmp, "previews"));
  lr.install(plugin);
  Object.assign(lr.settings, DSC0031);
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  await new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 }).ready();
});

afterEach(async () => {
  client.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe("masks:crop steps", () => {
  it("writes each radial and the gradient through the crop, reads them back as written, at the crop and at angle 10", async () => {
    const run = runFor(client, lr.uuid, () => {}, path.join(tmp, "previews"));
    const sdk = (await client.request("get_settings", { photo_uuid: lr.uuid })).settings;
    const a = await oneCase(run, "A", sdk);
    expect(a.error).toBeUndefined();
    expect(a.points).toHaveLength(POINTS.length);
    expect(a.points.every((p) => p.readback_ok && p.blob === null)).toBe(true); // the sim does not render masks
    expect(a.linear).toMatchObject({ readback_ok: true, ok: false }); // the sim's noise only
    expect(Math.abs(a.linear?.delta_luma ?? 99)).toBeLessThan(0.5);
    expect(lr.settings[MASK_TABLE_KEY]).toHaveLength(1); // each write is the whole table: the last mask alone
    const b = await oneCase(run, "B", await turnCrop(run, sdk));
    expect(b.frame.angle).toBe(ANGLE_B);
    for (const p of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]) {
      const q = toPhoto(b.frame, p); // the turned crop's corners stay on the photo
      for (const v of [q.x, q.y]) expect(v >= 0 && v <= 1).toBe(true);
    }
    expect(b.error).toBeUndefined();
    expect(b.points.every((p) => p.readback_ok)).toBe(true);
    expect(lr.history.at(-1)).toBe("AVG masks:crop B foreground");
  });
});
