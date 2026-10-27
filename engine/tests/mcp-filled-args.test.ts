// Issue #155, clients:probe round 1: a model that fills every optional argument (OpenCode with
// openrouter/openai/gpt-6-luna) got no session, no export and no image, because the engine refused
// combinations its JSON schema allows [handle: docs\reports\phase8.5\clients-probe.json clients[1]].
// The arguments below are the ones that model sent (%TEMP%\lrc-avg-probe-runs\opencode\stdout.txt);
// each call must now work, ignoring what does not apply.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { createServer, ENGINE_VERSION, Tools } from "../src/mcp/index.js";
import { exportPayload } from "../src/mcp/tools-files.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

type Answer = { content: unknown; isError?: unknown };
const body = (res: Answer): Record<string, unknown> =>
  JSON.parse(String((res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text)) as Record<string, unknown>;

let plugin: FakePlugin;
let bridge: BridgeClient;
let lr: LightroomSim;
let tmp: string;
let mcp: Client;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-filled-"));
  const previewDir = path.join(tmp, "previews");
  mkdirSync(previewDir);
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.install(plugin);
  lr.files.exportDir = path.join(tmp, "exports");
  bridge = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  bridge.start();
  const tools = new Tools({
    client: bridge,
    map: loadDefaultParamMap(),
    previews: new PreviewService(bridge, { previewDir }),
    intents: new IntentLibrary({ map: loadDefaultParamMap(), userDir: path.join(tmp, "intents") }),
    sessionLogDir: path.join(tmp, "sessions"),
    exportDir: lr.files.exportDir,
    engineVersion: ENGINE_VERSION,
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

const call = async (name: string, args: Record<string, unknown>) => body((await mcp.callTool({ name, arguments: args })) as Answer);

it("previews the selected photo when session_id is a placeholder and no session is open", async () => {
  const res = await call("lr_get_preview", { long_edge: 1600, session_id: "selected", target: "master", region: { x: 0, y: 0, w: 1, h: 1 } });
  expect(res).toMatchObject({ ok: true, session_id_note: expect.stringMatching(/ignored/) });
  expect(res).not.toHaveProperty("session_id");
});

it("opens a Converge session with variant_count and intent_id \"none\", ignoring both", async () => {
  const res = await call("lr_begin_session", {
    intent_id: "none",
    profile: "Adobe Color",
    clip_baseline: false,
    mode: "converge",
    variant_count: 3,
    max_passes: 4,
    guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 },
    notes: "Automated compatibility test: apply exposure +0.1, then accept.",
    model: "openrouter/openai/gpt-6-luna",
    long_edge: 1600,
    return_image: "after",
  });
  expect(res).toMatchObject({ ok: true, mode: "converge", intent: { id: "none", source: "none" } });
  expect(plugin.received.filter((r) => r.name === "create_virtual_copies")).toEqual([]);
  expect(await call("lr_end_session", { session_id: res["session_id"], outcome: "revert" })).toMatchObject({ ok: true });
});

it("exports with bit_depth on jpeg and long_edge beside width and height, sending only what applies", async () => {
  const args = { uuids: ["SIM-UUID"], folder: path.join(tmp, "out"), format: "jpeg", quality: 90, bit_depth: 8, long_edge: 1600, width: 1, height: 1, on_existing: "rename" };
  expect(await call("lr_export_photos", args)).toMatchObject({ exported: [expect.objectContaining({ uuid: "SIM-UUID" })], failed: [] });
  const sent = plugin.received.filter((r) => r.name === "export_photo").map((r) => r.payload);
  expect(sent).toEqual([{ photo_uuid: "SIM-UUID", format: "jpeg", quality: 90, long_edge: 1600 }]);
});

it("drops the arguments that do not apply to the format", () => {
  const base = { uuids: ["A"], folder: "C:\\Out", quality: 80, bit_depth: 16 as const, width: 100, height: 50 };
  expect(exportPayload({ ...base, format: "png" })).toEqual({ format: "png", bit_depth: 16, width: 100, height: 50 });
  expect(exportPayload({ ...base, format: "original", long_edge: 10 })).toEqual({ format: "original" });
});
