// lr_get_preview `uuid` (Automaat #259 equivalent, issue #190): a preview of any photo by uuid, with the
// selection untouched, against the simulated Lightroom (tests/helpers/lightroom-sim.ts).

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { ToolLog } from "../src/log/index.js";
import { Tools, ToolError } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

let plugin: FakePlugin;
let client: BridgeClient;
let lr: LightroomSim;
let tmp: string;
let tools: Tools;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-uuid-preview-"));
  const previewDir = path.join(tmp, "previews");
  mkdirSync(previewDir);
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.install(plugin);
  lr.copies.set("SIM-OTHER", { uuid: "SIM-OTHER", local_id: 7, copy_name: "Copy 1", settings: { ...lr.settings } });
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  client.start();
  tools = new Tools({
    client,
    map: loadDefaultParamMap(),
    previews: new PreviewService(client, { previewDir }),
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    log: new ToolLog(path.join(tmp, "logs")),
    historyPrefix: "AVG test",
  });
});

afterEach(async () => {
  client.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

const exports = () => plugin.received.filter((r) => r.name === "export_preview").map((r) => r.payload);

describe("lr_get_preview uuid", () => {
  it("renders the named photo by photo_uuid and leaves the selection alone", async () => {
    const out = await tools.getPreview({ uuid: "SIM-OTHER" });
    expect(exports().at(-1)).toMatchObject({ photo_uuid: "SIM-OTHER" });
    expect(exports().at(-1)).not.toHaveProperty("target_uuid");
    expect(out.json).toMatchObject({ ok: true, uuid: "SIM-OTHER" });
    expect(lr.selected).toBe("SIM-UUID");
  });

  it("crops a region of the named photo", async () => {
    const out = await tools.getPreview({ uuid: "SIM-OTHER", long_edge: 800, region: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } });
    expect(plugin.received.filter((r) => r.name === "get_context").at(-1)?.payload).toMatchObject({ photo_uuid: "SIM-OTHER" });
    expect(exports().at(-1)).toMatchObject({ photo_uuid: "SIM-OTHER" });
    expect(out.json).toMatchObject({ uuid: "SIM-OTHER", width: 800 });
  });

  it("refuses uuid with session_id", async () => {
    const err = await tools.getPreview({ uuid: "SIM-OTHER", session_id: "abc" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).code).toBe("INVALID_ARGUMENTS");
  });

  it("reports a uuid no photo has as the plugin's error", async () => {
    const err = await tools.getPreview({ uuid: "NO-SUCH-PHOTO" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect(exports()).toHaveLength(1);
  });
});
