// The MCP server (src/mcp/server.ts) through a real MCP client over the SDK's in-memory transport:
// tool list, argument validation, content blocks and structured errors (PRD NFR-7).

import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { createServer, ENGINE_VERSION, Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

let plugin: FakePlugin;
let bridge: BridgeClient;
let lr: LightroomSim;
let tmp: string;
let mcp: Client;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-mcp-"));
  const previewDir = path.join(tmp, "previews");
  mkdirSync(previewDir);
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.install(plugin);
  bridge = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  bridge.start();
  const tools = new Tools({
    client: bridge,
    map: loadDefaultParamMap(),
    previews: new PreviewService(bridge, { previewDir }),
    ensureBridge: () => bridge.waitConnected(2000).then(() => undefined),
    historyPrefix: "AVG test",
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(tools).connect(serverSide);
  mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
});

afterEach(async () => {
  await mcp.close();
  bridge.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

const textOf = (content: Content): Record<string, unknown> => {
  const text = content.find((c) => c.type === "text")?.text;
  return JSON.parse(String(text)) as Record<string, unknown>;
};

describe("mcp server", () => {
  it("names itself lrc-avg with the engine version, which matches package.json", () => {
    const pkg = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { version: string };
    expect(ENGINE_VERSION).toBe(pkg.version);
    expect(mcp.getServerVersion()).toMatchObject({ name: "lrc-avg", version: ENGINE_VERSION });
  });

  it("lists the four Phase 2 tools", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["lr_get_active_photo_context", "lr_get_metrics", "lr_get_preview", "lr_set_settings"]);
    const set = tools.find((t) => t.name === "lr_set_settings");
    expect(set?.inputSchema.required).toEqual(["uuid", "settings"]);
    expect(set?.description).toMatch(/ABSOLUTE values/);
  });

  it("returns the preview as an image block followed by the JSON text block", async () => {
    const res = await mcp.callTool({ name: "lr_get_preview", arguments: {} });
    const content = res.content as Content;
    expect(res.isError).toBeFalsy();
    expect(content.map((c) => c.type)).toEqual(["image", "text"]);
    expect(content[0]?.mimeType).toBe("image/jpeg");
    expect(Buffer.from(String(content[0]?.data), "base64").subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(textOf(content)).toMatchObject({ ok: true, uuid: "SIM-UUID", preview_source: "export" });
  });

  it("changes a setting through lr_set_settings", async () => {
    const res = await mcp.callTool({ name: "lr_set_settings", arguments: { uuid: "SIM-UUID", settings: { exposure: 0.83 } } });
    expect(res.isError).toBeFalsy();
    expect(textOf(res.content as Content)).toMatchObject({ ok: true, history_name: "AVG test set 1" });
    expect(lr.settings["Exposure2012"]).toBe(0.83);
  });

  it("returns tool failures as isError with {code, message, recoverable}", async () => {
    const res = await mcp.callTool({ name: "lr_set_settings", arguments: { uuid: "SIM-UUID", settings: { exposure: 9 } } });
    expect(res.isError).toBe(true);
    const body = textOf(res.content as Content);
    expect(body["ok"]).toBe(false);
    expect(body["error"]).toMatchObject({ code: "OUT_OF_RANGE", recoverable: false });
    expect(String((body["error"] as { message: string }).message)).not.toMatch(/\n\s+at /); // no stack
  });

  it("refuses invalid arguments before the tool runs", async () => {
    const res = await mcp.callTool({ name: "lr_set_settings", arguments: { uuid: "SIM-UUID", settings: {} } });
    expect(res.isError).toBe(true);
    expect(JSON.stringify(res.content)).toMatch(/at least one parameter/);
    const edge = await mcp.callTool({ name: "lr_get_preview", arguments: { long_edge: 5000 } });
    expect(edge.isError).toBe(true);
    expect(plugin.received.filter((r) => r.name === "apply_settings" || r.name === "export_preview")).toEqual([]);
  });
});
