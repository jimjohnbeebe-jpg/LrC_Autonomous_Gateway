// Contract test of the Phase 3 check (src/devtools/phase3-check.ts) against the simulated plugin in
// its "tonal" model (tests/helpers/lightroom-sim.ts). Jim's clicks are simulated from the prompts:
// "click <fixture>" selects it, "click any OTHER photo" selects another, "click <fixture> again"
// selects it back. Part 2's chat is a second engine (standing in for Claude Desktop's) that runs a
// golden-hour session, writing its own tool log, which collectChat then reads.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import type { ChatLogs } from "../src/devtools/phase2-check.js";
import { CHAT_FIXTURE, FIXTURES, clipCheck, evaluateChat, runPhase3Check, type Answer } from "../src/devtools/phase3-check.js";
import { IntentLibrary } from "../src/intents/index.js";
import { ToolLog, sessionLogSchema } from "../src/log/index.js";
import { BridgeGate, Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

const map = loadDefaultParamMap();
let plugin: FakePlugin;
let lr: LightroomSim;
let tmp: string;
let previewDir: string;
let chatLogDir: string;
const clients: BridgeClient[] = [];
const said: string[] = [];
const goldens: string[] = [];
/** The photo Jim has selected when he starts the chat (Part 2, step 1). */
let chatPhoto: string = CHAT_FIXTURE;

const newClient = (): BridgeClient => {
  const c = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  clients.push(c);
  return c;
};

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-p3check-"));
  previewDir = path.join(tmp, "previews");
  chatLogDir = path.join(tmp, "chat-logs");
  mkdirSync(previewDir);
  plugin = await FakePlugin.start();
  lr = new LightroomSim(previewDir);
  lr.renderModel = "tonal";
  lr.install(plugin);
  said.length = 0;
  goldens.length = 0;
  chatPhoto = CHAT_FIXTURE;
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

/** Claude Desktop's engine in the chat: a golden-hour session with one pass, accepted. */
async function simulatedChat(): Promise<void> {
  lr.filename = chatPhoto; // Part 2, step 1: Jim clicks the chat's photo
  lr.selected = lr.uuid;
  const client = newClient();
  client.start();
  const desktop = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir }),
    intents: new IntentLibrary({ map, userDir: path.join(tmp, "desk-intents") }),
    sessionLogDir: path.join(tmp, "desk-sessions"),
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    log: new ToolLog(chatLogDir),
  });
  const begin = await desktop.beginSession({ intent_id: "landscape_golden_hour" });
  const id = String(begin.json["session_id"]);
  await desktop.step({ session_id: id, settings: { shadows: 5 }, rationale: "open the foreground" });
  await desktop.endSession({ session_id: id, outcome: "accept" });
  client.stop();
}

function collectChat(since: Date): ChatLogs {
  const records = readdirSync(chatLogDir)
    .flatMap((f) => readFileSync(path.join(chatLogDir, f), "utf8").trim().split("\n"))
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((r) => new Date(String(r["ts"])).getTime() >= since.getTime());
  return { desktop_log: { found: true, saved_as: "desktop.txt", lines: 20 }, engine_log: { found: true, saved_as: "chat.jsonl", records } };
}

/** Jim's clicks and Enters, from the prompt's words. `skip` names fixtures to answer "skip" for. */
function jim(skip: readonly string[] = []) {
  return async (text: string): Promise<string | null> => {
    const again = /Click (.+) again/.exec(text);
    if (again) {
      lr.selected = lr.uuid;
      return "";
    }
    if (/Click any OTHER photo/.test(text)) {
      lr.selected = "OTHER-UUID";
      return "";
    }
    if (/Come back to this window/.test(text)) {
      await simulatedChat();
      return "";
    }
    const fixture = FIXTURES.find((f) => text.includes(`click ${f} `) || text.includes(`Click ${f},`));
    if (fixture && skip.includes(fixture)) return "skip";
    if (fixture) {
      lr.filename = fixture;
      lr.selected = lr.uuid;
    }
    return "";
  };
}

function run(answers: Answer[], options: { skip?: readonly string[]; busy?: boolean } = {}) {
  const queue = [...answers];
  const client = newClient();
  const previews = new PreviewService(client, { previewDir });
  const gate = new BridgeGate(
    client,
    async () => (options.busy ? { ok: false, port: 8767, pid: 4242 } : { ok: true, lock: { port: 8767, release: async () => {} } }),
    { waitMs: 2000 },
  );
  const tools = new Tools({
    client,
    map,
    previews,
    intents: new IntentLibrary({ map, userDir: path.join(tmp, "intents") }),
    sessionLogDir: path.join(tmp, "sessions"),
    engineVersion: "test",
    ensureBridge: () => gate.ready(),
  });
  return runPhase3Check({
    client,
    gate,
    tools,
    map,
    ask: async () => queue.shift() ?? "no answer",
    prompt: jim(options.skip),
    say: (line) => said.push(line),
    collectChat,
    saveGolden: (fixture) => {
      goldens.push(fixture);
      return `golden\\${fixture}.jpg`;
    },
    connectTimeoutMs: 2000,
  });
}

describe("devtools: Phase 3 check against a simulated plugin", () => {
  it("passes when every fixture's sessions hold the guardrails, replay, revert in time, and Jim answers yes", { timeout: 120000 }, async () => {
    const { accepted, results } = await run(["y", "y", "y", "y", "y", "y"]);
    expect(said.filter((l) => l.startsWith("FAILED"))).toEqual([]);
    expect(results["summary"]).toMatchObject({
      acceptance_suggestion: "WORKED",
      fixtures_done: 6,
      ac1_scripted_sessions: true,
      ac1_chat: true,
      ac2_revert: true,
      ac4_clipping: true,
      ac5_log_and_replay: true,
      photos_put_back: true,
    });
    expect(accepted).toBe(true);
    expect(goldens).toEqual([...FIXTURES]);
    const first = (results["fixtures"] as Array<Record<string, unknown>>)[0] as Record<string, Record<string, unknown>>;
    expect(first["region"]).toMatchObject({ export_long_edge: 4000, effective_scale: 0.6667 });
    expect(first["session_b"]?.["selection_guard"]).toMatchObject({ ok: true });
    expect(first["history_names"]).toEqual(expect.arrayContaining([expect.stringMatching(/^AVG [0-9a-f]{6} pass 1\/4$/), "AVG P3check replay"]));
    expect(results["chat"]).toMatchObject({ session_begun: true, intent_id: "landscape_golden_hour", passes: 1, session_ended: "accept", snapshot_name: expect.stringMatching(/^AVG pre-session /) });
    expect(said).toContain("Phase 3 acceptance: WORKED");
    // The photo is left as it was.
    expect(lr.settings["Exposure2012"]).toBe(0.33);
  });

  it("fails, and skips the chat, when a fixture is skipped", { timeout: 120000 }, async () => {
    const { accepted, results } = await run(["y", "y"], { skip: [FIXTURES[1]] });
    expect(accepted).toBe(false);
    expect(results["summary"]).toMatchObject({ acceptance_suggestion: "FAILED", fixtures_done: 5, fixtures_skipped: [FIXTURES[1]] });
    expect(results["chat"]).toBeUndefined();
    expect(said.join("\n")).toMatch(/Part 2 \(the chat\) was skipped/);
  });

  it("fails when the chat's session was on another photo than the chat fixture (Greptile, PR #24)", { timeout: 120000 }, async () => {
    chatPhoto = FIXTURES[0]; // Jim left another photo selected for the chat
    const { accepted, results } = await run(["y", "y", "y", "y", "y", "y"]);
    expect(accepted).toBe(false);
    expect(results["chat"]).toMatchObject({ session_begun: true, target_filename: FIXTURES[0] });
    expect(results["summary"]).toMatchObject({ ac1_chat: false });
  });

  it("fails when a region crop fails, although the acceptance lines pass (Greptile, PR #24)", { timeout: 120000 }, async () => {
    const exportPreview = plugin.handlers.get("export_preview");
    plugin.handlers.set("export_preview", (p, id) =>
      Number(p["long_edge"]) > 1920 ? { ok: false, error: { code: "export_failed", message: "too big", recoverable: true } } : (exportPreview?.(p, id) ?? "silent"),
    );
    const { accepted, results } = await run(["y", "y", "y", "y", "y", "y"]);
    expect(results["summary"]).toMatchObject({ ac2_revert: true, ac4_clipping: true, ac5_log_and_replay: true, region_crop_ok: false, acceptance_suggestion: "FAILED" });
    expect(accepted).toBe(false);
  });

  it("puts the photo back when the recipe replay fails after session A was accepted (Greptile, PR #24)", { timeout: 120000 }, async () => {
    const start = structuredClone(lr.settings);
    const apply = plugin.handlers.get("apply_settings");
    plugin.handlers.set("apply_settings", (p, id) =>
      p["history_name"] === "AVG P3check replay" ? { ok: false, error: { code: "write_failed", message: "no", recoverable: false } } : (apply?.(p, id) ?? "silent"),
    );
    const { accepted, results } = await run(["y", "y"]);
    expect(accepted).toBe(false);
    const first = (results["fixtures"] as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    expect(first["status"]).toBe("error");
    expect(first["put_back"]).toMatchObject({ ok: true, differing: [] });
    expect(map.fromSdk(lr.settings).settings).toEqual(map.fromSdk(start).settings);
  });

  it("stops at once when another engine holds the bridge", async () => {
    const { accepted, results } = await run([], { busy: true });
    expect(accepted).toBe(false);
    expect(results["summary"]).toMatchObject({ lock: "busy" });
  });
});

describe("devtools: Phase 3 check helpers", () => {
  it("reads the chat's session from the engine's tool log", () => {
    const records = [
      { ts: "t", tool: "lr_list_intents", ok: true },
      { ts: "t", tool: "lr_begin_session", ok: true, session_id: "s1", intent_id: "landscape_golden_hour", target: { uuid: "u", filename: "20260907-_OZ80093.NEF" }, snapshot: { name: "AVG pre-session x", id: "1" } },
      { ts: "t", tool: "lr_step", ok: true, session_id: "s1" },
      { ts: "t", tool: "lr_step", ok: false, error: { code: "GUARDRAIL_REFUSED" } },
      { ts: "t", tool: "lr_step", ok: true, session_id: "s1" },
      { ts: "t", tool: "lr_end_session", ok: true, session_id: "s1", outcome: "accept" },
    ];
    expect(evaluateChat(records)).toMatchObject({ session_begun: true, intent_id: "landscape_golden_hour", target_filename: "20260907-_OZ80093.NEF", passes: 2, session_ended: "accept", snapshot_name: "AVG pre-session x" });
    expect(evaluateChat([])).toMatchObject({ session_begun: false, passes: 0, session_ended: null });
  });

  it("checks AC-4 on every pass against the session's limits", () => {
    const pass = (n: number, high: number, low: number) => ({ n, metrics_after: { clip_high_pct: high, clip_low_pct: low } });
    const log = { guardrails: { clip_high_pct: 0.5, clip_low_pct: 1 }, passes: [pass(0, 0.5, 1), pass(1, 0.6, 0)] } as unknown as Parameters<typeof clipCheck>[0];
    expect(clipCheck(log)).toEqual({ ok: false, passes: [{ n: 0, clip_high_pct: 0.5, clip_low_pct: 1, ok: true }, { n: 1, clip_high_pct: 0.6, clip_low_pct: 0, ok: false }] });
    expect(sessionLogSchema).toBeDefined();
  });
});
