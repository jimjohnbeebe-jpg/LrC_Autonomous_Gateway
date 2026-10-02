// The MCP server (src/mcp/server.ts) through a real MCP client over the SDK's in-memory transport:
// tool list, argument validation, content blocks and structured errors (PRD NFR-7).

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { createServer, ENGINE_VERSION, Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { ToolLog } from "../src/log/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

type Content = Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

let plugin: FakePlugin;
let bridge: BridgeClient;
let lr: LightroomSim;
let tmp: string;
let logDir: string;
let mcp: Client;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-mcp-"));
  logDir = path.join(tmp, "logs");
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
    intents: new IntentLibrary({ map: loadDefaultParamMap(), userDir: path.join(tmp, "intents") }),
    sessionLogDir: path.join(tmp, "sessions"),
    engineVersion: ENGINE_VERSION,
    ensureBridge: () => bridge.waitConnected(2000).then(() => undefined),
    historyPrefix: "AVG test",
    log: new ToolLog(logDir),
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

  it("lists the Phase 3 tools, the Phase 4 ones, lr_approve_pass (Phase 5) and the catalog tools (Phase 6), without the temporary lr_set_settings", async () => {
    const { tools } = await mcp.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "lr_approve_pass",
      "lr_begin_session",
      "lr_create_preset_from_active",
      "lr_end_session",
      "lr_get_active_photo_context",
      "lr_get_intent",
      "lr_get_metrics",
      "lr_get_preview",
      "lr_get_selected_photos",
      "lr_get_session_log",
      "lr_list_collections",
      "lr_list_intents",
      "lr_probe",
      "lr_save_intent",
      "lr_search_photos",
      "lr_select_variant",
      "lr_set_keywords",
      "lr_set_rating",
      "lr_set_regions",
      "lr_step",
      "lr_sync_series",
    ]);
    const sync = tools.find((t) => t.name === "lr_sync_series");
    expect(sync?.inputSchema.required).toEqual(["source", "targets", "adaptive_exposure"]);
    const preset = tools.find((t) => t.name === "lr_create_preset_from_active");
    expect(preset?.inputSchema.required).toEqual(["name"]);
    expect(preset?.description).toMatch(/only after it restarts/);
    const save = tools.find((t) => t.name === "lr_save_intent");
    expect(save?.inputSchema.required).toEqual(["intent", "confirmed"]);
    const approve = tools.find((t) => t.name === "lr_approve_pass");
    expect(approve?.inputSchema.required).toEqual(["session_id", "confirmed"]);
    expect(approve?.description).toMatch(/ONLY after the user approved/);
    expect(save?.description).toMatch(/ONLY call this after the user has explicitly approved/);
    const step = tools.find((t) => t.name === "lr_step");
    expect(step?.inputSchema.required).toEqual(["session_id", "settings", "rationale"]);
    expect(step?.description).toMatch(/CHANGE for numeric sliders/);
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

  it("runs a session over MCP: begin, one step, end with revert", async () => {
    const exposure = lr.settings["Exposure2012"];
    const begin = await mcp.callTool({ name: "lr_begin_session", arguments: { intent_id: "neutral_technical_correction", max_passes: 2 } });
    expect(begin.isError).toBeFalsy();
    const started = textOf(begin.content as Content) as { session_id: string; pass: string };
    expect(started.pass).toBe("0/2");
    expect((begin.content as Content).map((c) => c.type)).toEqual(["image", "text"]);
    const step = await mcp.callTool({
      name: "lr_step",
      arguments: { session_id: started.session_id, settings: { exposure: 0.3 }, rationale: "a little brighter", return_image: "before_after" },
    });
    expect(step.isError).toBeFalsy();
    expect(textOf(step.content as Content)).toMatchObject({ ok: true, pass: "1/2", applied: [expect.objectContaining({ name: "exposure", delta: 0.3 })] });
    const end = await mcp.callTool({ name: "lr_end_session", arguments: { session_id: started.session_id, outcome: "revert" } });
    expect(textOf(end.content as Content)).toMatchObject({ ok: true, outcome: "revert", revert: { differing: [] } });
    expect(lr.settings["Exposure2012"]).toBe(exposure);
  });

  it("returns tool failures as isError with {code, message, recoverable}", async () => {
    const res = await mcp.callTool({ name: "lr_step", arguments: { session_id: "nope", settings: { exposure: 0.1 }, rationale: "x" } });
    expect(res.isError).toBe(true);
    const body = textOf(res.content as Content);
    expect(body["ok"]).toBe(false);
    expect(body["error"]).toMatchObject({ code: "SESSION_NOT_ACTIVE", recoverable: false });
    expect(String((body["error"] as { message: string }).message)).not.toMatch(/\n\s+at /); // no stack
  });

  it("lists and returns the bundled intents without Lightroom, and refuses an unconfirmed save", async () => {
    const list = await mcp.callTool({ name: "lr_list_intents", arguments: {} });
    const listed = textOf(list.content as Content) as { intents: Array<{ id: string; source: string }> };
    expect(listed.intents).toHaveLength(11);
    expect(listed.intents.every((i) => i.source === "bundled")).toBe(true);
    const got = await mcp.callTool({ name: "lr_get_intent", arguments: { id: "landscape_golden_hour" } });
    expect(textOf(got.content as Content)).toMatchObject({ ok: true, source: "bundled", intent: { default_camera_profile: "Adobe Landscape" } });
    const missing = await mcp.callTool({ name: "lr_get_intent", arguments: { id: "no_such_intent" } });
    expect(textOf(missing.content as Content)).toMatchObject({ ok: false, error: { code: "INTENT_NOT_FOUND", recoverable: false } });
    const unconfirmed = await mcp.callTool({ name: "lr_save_intent", arguments: { intent: { id: "x" }, confirmed: false } });
    expect(textOf(unconfirmed.content as Content)).toMatchObject({ ok: false, error: { code: "NOT_CONFIRMED" } });
    const noFlag = await mcp.callTool({ name: "lr_save_intent", arguments: { intent: { id: "x" } } });
    expect(textOf(noFlag.content as Content)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(plugin.received.filter((r) => r.name !== "hello" && r.name !== "ping")).toEqual([]);
  });

  it("refuses invalid arguments before the tool runs, with the structured error body, and logs them", async () => {
    const res = await mcp.callTool({ name: "lr_step", arguments: { session_id: "s", settings: {}, rationale: "x" } });
    expect(res.isError).toBe(true);
    const body = textOf(res.content as Content);
    expect(body).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS", recoverable: false } });
    expect(String((body["error"] as { message: string }).message)).toMatch(/settings: settings must name at least one parameter/);
    const edge = await mcp.callTool({ name: "lr_get_preview", arguments: { long_edge: 5000 } });
    expect(textOf(edge.content as Content)).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENTS" } });
    expect(plugin.received.filter((r) => r.name === "apply_settings" || r.name === "export_preview")).toEqual([]);
    const logged = readdirSync(logDir).flatMap((f) => readFileSync(path.join(logDir, f), "utf8").trim().split("\n"));
    expect(logged.map((l) => JSON.parse(l) as { tool: string; ok: boolean; error?: { code: string } })).toEqual([
      expect.objectContaining({ tool: "lr_step", ok: false, error: expect.objectContaining({ code: "INVALID_ARGUMENTS" }) }),
      expect.objectContaining({ tool: "lr_get_preview", ok: false, error: expect.objectContaining({ code: "INVALID_ARGUMENTS" }) }),
    ]);
  });

  it("answers an unknown tool, lr_set_settings included now, with UNKNOWN_TOOL", async () => {
    const res = await mcp.callTool({ name: "lr_set_settings", arguments: {} });
    expect(textOf(res.content as Content)).toMatchObject({ ok: false, error: { code: "UNKNOWN_TOOL" } });
  });

  it("advertises the argument limits it enforces", async () => {
    const { tools } = await mcp.listTools();
    const preview = tools.find((t) => t.name === "lr_get_preview");
    expect(preview?.inputSchema.properties?.["long_edge"]).toMatchObject({ type: "integer", minimum: 800, maximum: 1920 });
    expect(preview?.annotations).toMatchObject({ readOnlyHint: true });
  });
});
