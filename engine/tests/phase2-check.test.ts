// Contract test of the Phase 2 check (src/devtools/phase2-check.ts) against a simulated plugin
// (tests/helpers/lightroom-sim.ts). Part 2's chat is simulated too: when the check waits for Enter, a
// second engine (standing in for Claude Desktop's) connects to the same plugin, looks at the photo
// and raises exposure by 0.5, writing its own tool log, which collectChat then reads.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import { evaluateChat, redactHome, runPhase2Check, type Answer, type ChatLogs } from "../src/devtools/phase2-check.js";
import { ToolLog } from "../src/log/index.js";
import { BridgeGate, Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim, nefDump } from "./helpers/lightroom-sim.js";

let plugin: FakePlugin;
let lr: LightroomSim;
let tmp: string;
let previewDir: string;
let chatLogDir: string;
const clients: BridgeClient[] = [];
const said: string[] = [];

const newClient = (): BridgeClient => {
  const c = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  clients.push(c);
  return c;
};

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-p2check-"));
  previewDir = path.join(tmp, "previews");
  chatLogDir = path.join(tmp, "chat-logs");
  mkdirSync(previewDir);
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.install(plugin);
  said.length = 0;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Claude Desktop's engine in the chat: a preview, then exposure +0.5 with its preview. */
async function simulatedChat(raiseBy = 0.5): Promise<void> {
  const client = newClient();
  client.start();
  const desktop = new Tools({
    client,
    map: loadDefaultParamMap(),
    previews: new PreviewService(client, { previewDir }),
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    log: new ToolLog(chatLogDir),
    historyPrefix: "AVG desk",
  });
  const { json } = await desktop.getPreview();
  const exposure = lr.settings["Exposure2012"] as number;
  await desktop.setSettings({ uuid: String(json["uuid"]), settings: { exposure: Math.round((exposure + raiseBy) * 100) / 100 } });
  client.stop();
}

function collectChat(since: Date): ChatLogs {
  const records = readdirSync(chatLogDir)
    .flatMap((f) => readFileSync(path.join(chatLogDir, f), "utf8").trim().split("\n"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((r) => new Date(String(r["ts"])).getTime() >= since.getTime());
  return { desktop_log: { found: true, saved_as: "desktop.txt", lines: 12 }, engine_log: { found: true, saved_as: "chat.jsonl", records } };
}

function run(answers: Answer[], options: { busy?: boolean; chat?: () => Promise<void> } = {}) {
  const queue = [...answers];
  const client = newClient();
  const previews = new PreviewService(client, { previewDir });
  const gate = new BridgeGate(
    client,
    async () => (options.busy ? { ok: false, port: 8767, pid: 4242 } : { ok: true, lock: { port: 8767, release: async () => {} } }),
    { waitMs: 2000 },
  );
  const tools = new Tools({ client, map: loadDefaultParamMap(), previews, ensureBridge: () => gate.ready(), historyPrefix: "AVG P2check" });
  return runPhase2Check({
    client,
    gate,
    tools,
    previews,
    map: loadDefaultParamMap(),
    ask: async () => queue.shift() ?? "no answer",
    waitEnter: async () => {
      await (options.chat ?? simulatedChat)();
      return true;
    },
    say: (line) => said.push(line),
    collectChat,
    connectTimeoutMs: 2000,
    repeats: 1,
  });
}

describe("devtools: Phase 2 check against a simulated plugin", () => {
  it("passes when the passes read back, the snapshot restores, the chat raised exposure and Jim answers yes", async () => {
    const { accepted, results } = await run(["y", "y", "y", "y", "y"]);
    expect(accepted).toBe(true);
    expect(results["summary"]).toMatchObject({ acceptance_suggestion: "WORKED", passes_ok: true, snapshot_revert_exact: true, chat_ok: true });
    const history = lr.history;
    expect(history.slice(0, 3)).toEqual(["AVG P2check set 1", "AVG P2check set 2", "AVG P2check set 3"]);
    expect(history[3]).toBe("AVG desk set 1"); // the simulated chat's write
    expect(results["revert"]).toMatchObject({ ok: true, differing_keys: [] });
    expect(Object.keys(results["exports"] as object)).toEqual(["800", "1200", "1600"]);
    expect(results["quality"]).toMatchObject({ size_follows_quality: true });
    const passes = results["passes"] as Array<{ ok: boolean; delta_luma_mean: number; timings: { total_ms: number; plugin_command_ms: number } }>;
    expect(passes.map((p) => p.ok)).toEqual([true, true, true]);
    expect(passes[2]?.delta_luma_mean).toBeLessThan(0);
    expect(passes[0]?.timings.plugin_command_ms).toBe(330);
    expect(results["chat"]).toMatchObject({ saw_photo: true, exposure_raised_by_half: true, saw_change: true, engine_log: { records: 2 } });
    expect(said.some((l) => l.includes("Look at the photo selected in Lightroom"))).toBe(true);
    expect(said.some((l) => l.startsWith("Last step: in the Snapshots panel"))).toBe(true);
  });

  it("fails when the chat did not raise exposure by 0.5, even if Jim answers yes", async () => {
    const { accepted, results } = await run(["y", "y", "y", "y", "y"], { chat: () => simulatedChat(0.2) });
    expect(accepted).toBe(false);
    expect(results["chat"]).toMatchObject({ saw_photo: true, exposure_raised_by_half: false });
  });

  it("stops at once, and touches nothing, when another engine holds the lock", async () => {
    const { accepted, results } = await run(["y"], { busy: true });
    expect(accepted).toBe(false);
    expect(results["summary"]).toMatchObject({ lock: "busy" });
    expect(plugin.received).toEqual([]);
    expect(said.join("\n")).toMatch(/Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit/);
  });

  it("stops before anything else when Lightroom still runs the Phase 1 plugin", async () => {
    plugin.handlers.set("hello", () => ({
      ok: true,
      payload: { protocol: 1, plugin_version: "0.1.0", lrc_version: "15.5.1", sdk_declared: 13, ports: { receive: 1, send: 2 } },
    }));
    const { accepted } = await run(["y"]);
    expect(accepted).toBe(false);
    expect(plugin.received.map((r) => r.name)).toEqual(["hello"]);
    expect(said.join("\n")).toMatch(/plugin 0\.1\.0, not 0\.2\.0\. Restart Lightroom/);
  });

  it("refuses a photo without room for exposure +1.0, writes nothing and skips the chat", async () => {
    lr.settings["Exposure2012"] = 4.2;
    let chatted = false;
    const { accepted, results } = await run(["y", "y"], { chat: async () => void (chatted = true) });
    expect(accepted).toBe(false);
    expect(lr.history).toEqual([]);
    expect(lr.snapshots.size).toBe(0);
    expect(chatted).toBe(false);
    expect((results["errors"] as string[])[0]).toMatch(/\+1\.0 would pass \+5/);
  });

  it("puts the photo back and reports it when a pass fails", async () => {
    lr.ignored.add("Exposure2012");
    const { accepted, results } = await run(["y", "y"]);
    expect(accepted).toBe(false);
    expect(results["revert"]).toMatchObject({ ok: true });
    expect(lr.settings).toEqual(nefDump.settings);
    expect((results["passes"] as Array<{ error?: { code: string } }>)[0]?.error).toMatchObject({ code: "WRITE_NOT_TAKEN" });
  });
});

describe("devtools: Phase 2 check helpers", () => {
  it("reads the chat's tool log", () => {
    const set = (before: number, after: number, extra: Record<string, unknown> = {}) => ({
      tool: "lr_set_settings",
      ok: true,
      changes: [{ name: "exposure", before, requested: after, after }],
      ...extra,
    });
    expect(evaluateChat([{ tool: "lr_get_preview", ok: true }, set(0.33, 0.83, { preview_hash: "ab" })])).toMatchObject({
      saw_photo: true,
      exposure_raised_by_half: true,
      saw_change: true,
    });
    // Raised without an image, but looked again afterwards.
    expect(evaluateChat([{ tool: "lr_get_preview", ok: true }, set(0.33, 0.83), { tool: "lr_get_preview", ok: true }]).saw_change).toBe(true);
    expect(evaluateChat([set(0.33, 0.83)])).toMatchObject({ saw_photo: false, saw_change: false });
    expect(evaluateChat([{ tool: "lr_get_preview", ok: true }, set(0.33, 1.33)]).exposure_raised_by_half).toBe(false);
    expect(evaluateChat([{ tool: "lr_set_settings", ok: false, error: { code: "OUT_OF_RANGE" } }]).tool_calls).toEqual([
      { ts: undefined, tool: "lr_set_settings", ok: false, error_code: "OUT_OF_RANGE" },
    ]);
  });

  it("redacts the user folder, as written and JSON-escaped, in any letter case", () => {
    const home = "C:\\Users\\jim";
    expect(redactHome("a C:\\Users\\jim\\x and c:\\users\\JIM\\y", home)).toBe("a %USERPROFILE%\\x and %USERPROFILE%\\y");
    expect(redactHome(JSON.stringify({ p: "C:\\Users\\jim\\AppData" }), home)).toBe('{"p":"%USERPROFILE%\\\\AppData"}');
  });
});
