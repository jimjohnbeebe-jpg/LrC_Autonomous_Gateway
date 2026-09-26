// The Phase 2 tools (src/mcp/tools.ts) and the preview pipeline (src/preview/) against the fake
// plugin with a simulated Lightroom (tests/helpers/lightroom-sim.ts).

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { ToolLog } from "../src/log/index.js";
import { Tools, ToolError } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim, simulatedLevel } from "./helpers/lightroom-sim.js";

let plugin: FakePlugin;
let client: BridgeClient;
let lr: LightroomSim;
let tmp: string;
let previewDir: string;
let logDir: string;
let tools: Tools;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-tools-"));
  previewDir = path.join(tmp, "previews");
  logDir = path.join(tmp, "logs");
  mkdirSync(previewDir);
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.install(plugin);
  client = new BridgeClient({
    commandPort: plugin.commandPort,
    eventPort: plugin.eventPort,
    connectGapMs: 5,
    reconnectMs: 30,
    readToken: () => plugin.token,
  });
  client.start();
  tools = new Tools({
    client,
    map: loadDefaultParamMap(),
    previews: new PreviewService(client, { previewDir }),
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    log: new ToolLog(logDir),
    historyPrefix: "AVG test",
  });
});

afterEach(async () => {
  client.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function failure(p: Promise<unknown>): Promise<ToolError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ToolError);
    return e as ToolError;
  }
  throw new Error("expected the tool to fail");
}

function logLines(): Array<Record<string, unknown>> {
  const files = readdirSync(logDir);
  expect(files).toHaveLength(1);
  return readFileSync(path.join(logDir, files[0] as string), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("mcp tools: lr_get_active_photo_context", () => {
  it("returns the photo, its EXIF and every setting under its canonical name", async () => {
    const { json, image } = await tools.getActivePhotoContext();
    expect(image).toBeUndefined();
    expect(json).toMatchObject({
      ok: true,
      uuid: "SIM-UUID",
      filename: "20260907-_OZ80093.NEF",
      file_format: "RAW",
      exif: { iso: 64, lens: "NIKKOR Z 24-120mm f/4 S", camera: "NIKON Z 8" },
      process_version: "15.4",
      camera_profile: "Camera Neutral",
      session_active: false,
      rating: null,
    });
    const settings = json["settings"] as Record<string, unknown>;
    expect(settings["exposure"]).toBe(0.33);
    expect(settings["camera_profile"]).toBe("Camera Neutral");
    expect(Object.keys(settings)).toContain("hsl.orange.sat");
  });

  it("still describes the photo when its process version is not supported", async () => {
    lr.settings["ProcessVersion"] = "6.7";
    const { json } = await tools.getActivePhotoContext();
    expect(json["settings"]).toBeNull();
    expect(json["process_version"]).toBe("6.7");
    expect(json["settings_error"]).toMatchObject({ code: "LEGACY_PROCESS_VERSION" });
  });

  it("reports a missing selection as NO_ACTIVE_PHOTO", async () => {
    plugin.handlers.set("get_context", () => ({ ok: false, error: { code: "no_target_photo", message: "No photo is selected in Lightroom", recoverable: true } }));
    const e = await failure(tools.getActivePhotoContext());
    expect(e.body()).toMatchObject({ code: "NO_ACTIVE_PHOTO", recoverable: true });
  });
});

describe("mcp tools: lr_get_preview and lr_get_metrics", () => {
  it("returns the exported JPEG as sent, its hash and metrics, and deletes the file", async () => {
    const { json, image } = await tools.getPreview();
    expect(image).toBeInstanceOf(Buffer);
    const meta = await sharp(image as Buffer).metadata();
    expect([meta.format, meta.width, meta.height]).toEqual(["jpeg", 1600, 1067]);
    expect(json).toMatchObject({ ok: true, uuid: "SIM-UUID", preview_source: "export", width: 1600, height: 1067, reencoded: false });
    expect(json["preview_hash"]).toBe(createHash("sha256").update(image as Buffer).digest("hex"));
    const metrics = json["metrics"] as { luma_mean: number; clip_high_pct: number };
    expect(Math.abs(metrics.luma_mean - simulatedLevel(0.33))).toBeLessThanOrEqual(1);
    expect(readdirSync(previewDir)).toEqual([]); // the file and its request folder are gone
    expect(json["timings"]).toMatchObject({ export_ms: 12 });
  });

  it("renders at the requested long edge", async () => {
    const { json } = await tools.getPreview({ long_edge: 800 });
    expect([json["width"], json["height"]]).toEqual([800, 533]);
  });

  it("shrinks an export that came out larger than the long edge", async () => {
    lr.exportLongEdge = 2400;
    const { json, image } = await tools.getPreview({ long_edge: 1600 });
    expect(json).toMatchObject({ width: 1600, height: 1067, reencoded: true });
    expect((await sharp(image as Buffer).metadata()).width).toBe(1600);
  });

  it("refuses a preview path outside the previews folder and leaves that file alone", async () => {
    const outside = path.join(tmp, "elsewhere.jpg");
    writeFileSync(outside, "not touched");
    lr.exportPath = outside;
    const e = await failure(tools.getPreview());
    expect(e.code).toBe("PREVIEW_PATH_REFUSED");
    expect(readFileSync(outside, "utf8")).toBe("not touched");
  });

  it("answers lr_get_metrics from the last preview, without exporting again", async () => {
    expect((await failure(tools.getMetrics())).code).toBe("NO_PREVIEW_YET");
    const preview = await tools.getPreview();
    const exports = lr.exports;
    const { json } = await tools.getMetrics();
    expect(lr.exports).toBe(exports);
    expect(json["preview_hash"]).toBe(preview.json["preview_hash"]);
    const metrics = json["metrics"] as { luma: { histogram: number[] }; pixels: number };
    expect(metrics.luma.histogram).toHaveLength(256);
    expect(metrics.pixels).toBe(1600 * 1067);
  });

  it("purges leftover previews", () => {
    mkdirSync(path.join(previewDir, "old"));
    writeFileSync(path.join(previewDir, "old", "x.jpg"), "x");
    new PreviewService(client, { previewDir }).purge();
    expect(readdirSync(previewDir)).toEqual([]);
  });
});

describe("mcp tools: lr_set_settings", () => {
  it("writes absolute values in one named History step, reads them back and returns the new preview", async () => {
    await tools.getPreview();
    const { json, image } = await tools.setSettings({ uuid: "SIM-UUID", settings: { exposure: 0.83 } });
    expect(lr.history).toEqual(["AVG test set 1"]);
    expect(lr.settings["Exposure2012"]).toBe(0.83);
    expect(json).toMatchObject({
      ok: true,
      history_name: "AVG test set 1",
      changes: [{ name: "exposure", before: 0.33, requested: 0.83, after: 0.83 }],
      read_back: "as written",
      preview_source: "export",
    });
    expect(image).toBeInstanceOf(Buffer);
    const delta = json["delta_metrics"] as { luma_mean: number };
    expect(delta.luma_mean).toBeGreaterThan(15); // 0.5 EV = 20 grey levels in the simulation
    expect(json["timings"]).toMatchObject({ plugin_apply_ms: 25, plugin_read_ms: 300, plugin_command_ms: 330 });
    expect((json["timings"] as { total_ms: number }).total_ms).toBeGreaterThan(0);
  });

  it("numbers the History steps and skips the render when asked", async () => {
    await tools.setSettings({ uuid: "SIM-UUID", settings: { contrast: 10 }, return_image: "none" });
    const { json, image } = await tools.setSettings({ uuid: "SIM-UUID", settings: { contrast: 20 }, return_image: "none" });
    expect(lr.history).toEqual(["AVG test set 1", "AVG test set 2"]);
    expect(lr.exports).toBe(0);
    expect(image).toBeUndefined();
    expect(json).not.toHaveProperty("preview_hash");
  });

  it("writes a camera profile as its CameraProfile + Look pair", async () => {
    const { json } = await tools.setSettings({ uuid: "SIM-UUID", settings: { camera_profile: "Adobe Landscape" }, return_image: "none" });
    expect(json["changes"]).toEqual([{ name: "camera_profile", before: "Camera Neutral", requested: "Adobe Landscape", after: "Adobe Landscape" }]);
    expect(lr.settings["CameraProfile"]).toBe("Adobe Standard");
  });

  it("refuses unknown names, out-of-range values and unknown profiles before writing anything", async () => {
    expect((await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { brightness: 10 } }))).code).toBe("UNKNOWN_PARAMETER");
    expect((await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { exposure: 5.5 } }))).code).toBe("OUT_OF_RANGE");
    expect((await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { camera_profile: "Velvia" } }))).code).toBe("UNKNOWN_CAMERA_PROFILE");
    expect(plugin.received.filter((r) => r.name === "apply_settings")).toEqual([]);
    expect(lr.history).toEqual([]);
  });

  it("refuses to write when another photo is selected (TARGET_CHANGED)", async () => {
    lr.selected = "OTHER-UUID";
    const e = await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { exposure: 0.5 } }));
    expect(e.body()).toMatchObject({ code: "TARGET_CHANGED", recoverable: false });
    expect(lr.history).toEqual([]);
  });

  it("reports a value Lightroom did not take as WRITE_NOT_TAKEN, with what the photo holds", async () => {
    lr.ignored.add("Dehaze");
    const e = await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { dehaze: 20, exposure: 0.5 } }));
    expect(e.code).toBe("WRITE_NOT_TAKEN");
    const details = e.details as { history_name: string; mismatches: Array<{ sdk_key: string }>; changes: Array<{ name: string; after: unknown }> };
    expect(details.history_name).toBe("AVG test set 1");
    expect(details.mismatches.map((m) => m.sdk_key)).toEqual(["Dehaze"]);
    expect(details.changes.find((c) => c.name === "exposure")?.after).toBe(0.5);
    expect(lr.exports).toBe(0);
  });

  it("reports a missing Lightroom as BRIDGE_DISCONNECTED", async () => {
    await plugin.close();
    await new Promise((r) => setTimeout(r, 50));
    const e = await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { exposure: 0.5 } }));
    expect(e.body()).toMatchObject({ code: "BRIDGE_DISCONNECTED", recoverable: true });
  });
});

describe("mcp tools: tool log", () => {
  it("writes one JSON line per call, with outcome, arguments and timings, and no image data", async () => {
    await tools.getPreview();
    await tools.setSettings({ uuid: "SIM-UUID", settings: { exposure: 0.83 } });
    await failure(tools.setSettings({ uuid: "SIM-UUID", settings: { brightness: 1 } }));
    const lines = logLines();
    expect(lines.map((l) => [l["tool"], l["ok"]])).toEqual([
      ["lr_get_preview", true],
      ["lr_set_settings", true],
      ["lr_set_settings", false],
    ]);
    expect(lines[1]).toMatchObject({ args: { uuid: "SIM-UUID", settings: { exposure: 0.83 } }, history_name: "AVG test set 1" });
    expect(lines[1]?.["preview_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(lines[2]).toMatchObject({ error: { code: "UNKNOWN_PARAMETER" } });
    expect(JSON.stringify(lines).length).toBeLessThan(20000);
    expect(existsSync(path.join(logDir))).toBe(true);
  });
});
