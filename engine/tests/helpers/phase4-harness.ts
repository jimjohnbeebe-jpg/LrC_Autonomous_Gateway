// Set-up of the Phase 4 check tests (tests\phase4-check*.test.ts): the simulated Lightroom in its
// "tonal" model behind a fake plugin (lightroom-sim.ts), a preset folder holding Jim's two reference
// presets (copies of the fixtures), and Jim simulated from the prompts' words:
//   - "click <photo>" selects the master; "Lightroom now shows copy X" and the other Enters answer "";
//   - the pick answers `sim.pick`;
//   - the restart's Enter drops the plugin's connection, as quitting Lightroom closes its sockets
//     [inference] (the client reconnects), unless `sim.noRestart`;
//   - "click <preset> once" applies the preset file's crs: attributes to the selected photo, as
//     Lightroom would [inference], for the keys the photo has (not the curves, which are elements), unless
//     `sim.presetClickIgnored`;
//   - the copies' removal empties the sim's copies (all but `sim.keepCopy`), the presets' deletion
//     removes the preset files;
//   - "Come back to this window" runs the chat: a second engine, standing in for Claude Desktop's,
//     runs a Variants session with its own tool log, which collectChat then reads.

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";
import { BridgeClient } from "../../src/bridge/index.js";
import type { ChatLogs } from "../../src/devtools/phase2-check.js";
import { runPhase4Check, type Answer } from "../../src/devtools/phase4-check.js";
import { PHOTO } from "../../src/devtools/phase4-config.js";
import { IntentLibrary } from "../../src/intents/index.js";
import { ToolLog } from "../../src/log/index.js";
import { BridgeGate, Tools } from "../../src/mcp/index.js";
import { loadDefaultParamMap } from "../../src/params/index.js";
import { parseXml, presetDescription } from "../../src/presets/index.js";
import { PreviewService } from "../../src/preview/index.js";
import { FakePlugin } from "./fake-plugin.js";
import { LightroomSim } from "./lightroom-sim.js";

export const map = loadDefaultParamMap();
const FIXTURES = fileURLToPath(new URL("../fixtures/presets/", import.meta.url));

/** How simulated Jim and the simulated chat behave in the next run. */
export type SimOptions = {
  pick: string;
  noRestart: boolean;
  presetClickIgnored: boolean;
  keepCopy: string | null;
  customWhiteBalance: boolean;
  /** The chat: the copies refined before the pick, the passes after it, and a first Variants session ended with revert. */
  chatRefines: ReadonlyArray<"A" | "B" | "C">;
  chatStepsAfterPick: number;
  chatTwice: boolean;
  /** Claude Desktop keeps the bridge after the chat, so the check cannot take it back. */
  lockBusyAfterChat: boolean;
};
export const DEFAULTS: SimOptions = { pick: "B", noRestart: false, presetClickIgnored: false, keepCopy: null, customWhiteBalance: true, chatRefines: ["A", "B", "C"], chatStepsAfterPick: 1, chatTwice: false, lockBusyAfterChat: false };

export const h = {
  plugin: null as unknown as FakePlugin,
  lr: null as unknown as LightroomSim,
  tmp: "",
  presetDir: "",
  sim: { ...DEFAULTS },
  said: [] as string[],
  clients: [] as BridgeClient[],
  chatDone: false,
};
const dir = (name: string): string => path.join(h.tmp, name);

export function usePhase4Harness(): void {
  beforeEach(async () => {
    h.tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-p4check-"));
    for (const d of ["previews", "chat-logs", "presets"]) mkdirSync(dir(d));
    h.presetDir = dir("presets");
    copyFileSync(path.join(FIXTURES, "reference.lrc15.xmp"), path.join(h.presetDir, "AVG preset reference.xmp"));
    copyFileSync(path.join(FIXTURES, "reference-2.lrc15.xmp"), path.join(h.presetDir, "AVG preset reference 2.xmp"));
    h.plugin = await FakePlugin.start();
    h.lr = new LightroomSim(dir("previews"));
    h.lr.renderModel = "tonal";
    h.lr.filename = PHOTO;
    h.lr.install(h.plugin);
    h.sim = { ...DEFAULTS };
    h.said.length = 0;
    h.chatDone = false;
  });
  afterEach(async () => {
    for (const c of h.clients.splice(0)) c.stop();
    await h.plugin.close();
    rmSync(h.tmp, { recursive: true, force: true });
  });
}

function newClient(): BridgeClient {
  const c = new BridgeClient({ commandPort: h.plugin.commandPort, eventPort: h.plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => h.plugin.token });
  h.clients.push(c);
  return c;
}

/** Claude Desktop's engine in the chat: a Variants session on the master, the pick, accept. */
async function simulatedChat(): Promise<void> {
  const client = newClient();
  client.start();
  const desktop = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: dir("previews") }),
    intents: new IntentLibrary({ map, userDir: dir("desk-intents") }),
    sessionLogDir: dir("desk-sessions"),
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    log: new ToolLog(dir("chat-logs")),
  });
  const begin = async (): Promise<string> => String((await desktop.beginSession({ intent_id: "landscape_golden_hour", mode: "variants", return_image: "none" })).json["session_id"]);
  if (h.sim.chatTwice) await desktop.endSession({ session_id: await begin(), outcome: "revert" }); // Claude starts over
  const id = await begin();
  for (const target of h.sim.chatRefines) await desktop.step({ session_id: id, target, settings: { clarity: 3 }, rationale: "refine", return_image: "none" });
  await desktop.selectVariant({ session_id: id, variant: "C" });
  for (let i = 0; i < h.sim.chatStepsAfterPick; i++) await desktop.step({ session_id: id, settings: { vibrance: 3 }, rationale: "refine the pick", return_image: "none" });
  await desktop.endSession({ session_id: id, outcome: "accept" });
  client.stop();
  h.chatDone = true;
}

function collectChat(since: Date): ChatLogs {
  const records = readdirSync(dir("chat-logs"))
    .flatMap((f) => readFileSync(path.join(dir("chat-logs"), f), "utf8").trim().split("\n"))
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as Record<string, unknown>)
    .filter((r) => new Date(String(r["ts"])).getTime() >= since.getTime());
  return { desktop_log: { found: true, saved_as: "desktop.txt", lines: 20 }, engine_log: { found: true, saved_as: "chat.jsonl", records } };
}

/** Lightroom applying a preset file to the selected photo: its crs: attributes, for the keys the photo has. */
function clickPreset(name: string): void {
  const text = readFileSync(path.join(h.presetDir, `${name}.xmp`), "utf8");
  const target = h.lr.copies.get(h.lr.selected)?.settings ?? h.lr.settings;
  for (const [attr, raw] of presetDescription(parseXml(text)).attrs) {
    const key = attr.replace(/^crs:/, "");
    if (!attr.startsWith("crs:") || !(key in target)) continue;
    target[key] = typeof target[key] === "number" ? Number(raw) : raw; // "+0.30" and "15.4" keep the photo's type
  }
}

/** Jim's clicks and Enters, from the prompt's words. */
async function jim(text: string): Promise<string | null> {
  if (text.includes(`click ${PHOTO}`) || text.includes(`Click ${PHOTO}`)) h.lr.selected = h.lr.uuid;
  if (/Which copy should the session continue on/.test(text)) return h.sim.pick;
  if (/3\. Then press Enter here/.test(text) && !h.sim.noRestart) h.plugin.dropEventClient();
  const preset = /click "(AVG P4check [^"]+)" once/.exec(text);
  if (preset && !h.sim.presetClickIgnored) clickPreset(preset[1] as string);
  if (/7\. Come back to this window/.test(text)) await simulatedChat();
  if (/5\. Press Enter here|Still in the catalog/.test(text)) for (const uuid of [...h.lr.copies.keys()]) if (uuid !== h.sim.keepCopy) h.lr.copies.delete(uuid);
  if (/^ {2}3\. Press Enter here/.test(text)) for (const f of readdirSync(h.presetDir)) unlinkSync(path.join(h.presetDir, f));
  return "";
}

/** One run of the check against the sim, with Jim's y/n answers in order ("no answer" once they run out). */
export function runCheck(answers: Answer[], options: { busy?: boolean; restartTimeoutMs?: number; copiesTimeoutMs?: number; tamper?: (tools: Tools) => void } = {}) {
  const queue = [...answers];
  h.lr.customWhiteBalanceOnTemperature = h.sim.customWhiteBalance;
  const client = newClient();
  const previews = new PreviewService(client, { previewDir: dir("previews") });
  const busy = (): boolean => options.busy === true || (h.sim.lockBusyAfterChat && h.chatDone);
  const gate = new BridgeGate(client, async () => (busy() ? { ok: false, port: 8767, pid: 4242 } : { ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
  const tools = new Tools({
    client,
    map,
    previews,
    intents: new IntentLibrary({ map, userDir: dir("intents") }),
    sessionLogDir: dir("sessions"),
    presetDir: h.presetDir,
    engineVersion: "test",
    ensureBridge: () => gate.ready(),
  });
  options.tamper?.(tools);
  return runPhase4Check({
    client,
    gate,
    tools,
    previews,
    map,
    ask: async () => queue.shift() ?? "no answer",
    prompt: jim,
    say: (line) => h.said.push(line),
    collectChat,
    presetDir: h.presetDir,
    stamp: "2026-09-28T10-00-00-000Z",
    connectTimeoutMs: 2000,
    restartTimeoutMs: options.restartTimeoutMs ?? 5000,
    ...(options.copiesTimeoutMs !== undefined ? { copiesTimeoutMs: options.copiesTimeoutMs } : {}),
  });
}

export const YES = ["y", "y", "y", "y", "y"] as Answer[];
export const failures = (): string[] => h.said.filter((l) => l.startsWith("FAILED"));
