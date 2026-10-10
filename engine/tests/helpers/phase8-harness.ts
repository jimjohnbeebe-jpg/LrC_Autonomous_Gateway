// Set-up of the Phase 8 check tests (tests\phase8-check.test.ts): the simulated Lightroom with a
// "fixtures" collection of both pipelines (the raw master and a second NEF; DSC_0031.JPG on process
// version 15.4 and 11.0 and its "Copy 1"; a TIFF whose original is missing), a preset folder holding
// row 5's two rendered reference presets, and Jim simulated from the prompts' words:
//   - the restart's Enter drops the plugin's connection, as quitting Lightroom closes its sockets
//     [inference] (the client reconnects);
//   - "click <preset> once" applies the preset file's crs: attributes to the selected photo for the
//     keys it has, except a rendered preset's CameraProfile "Default …", which the sim keeps "Embedded"
//     [inference: how Lightroom stores a clicked rendered preset's profile is row 5's open question];
//   - "Come back to this window" runs the chat: a second engine, standing in for Claude Desktop's,
//     runs a session on the selected photo with its own tool log, which collectChat then reads;
//   - the presets' "3. Press Enter here" deletes every preset file.

import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach } from "vitest";
import { BridgeClient } from "../../src/bridge/index.js";
import type { Answer } from "../../src/devtools/phase1-check.js";
import type { ChatLogs } from "../../src/devtools/phase2-check.js";
import { runPhase8Check } from "../../src/devtools/phase8-check.js";
import { COLLECTION, REFERENCE_PRESETS } from "../../src/devtools/phase8-config.js";
import { checkStateSchema, type CheckState } from "../../src/devtools/phase8-state.js";
import { memoryStore } from "../../src/devtools/phase5-state.js";
import { IntentLibrary } from "../../src/intents/index.js";
import { ToolLog } from "../../src/log/index.js";
import { BridgeGate, ENGINE_VERSION, Tools } from "../../src/mcp/index.js";
import { loadDefaultParamMap } from "../../src/params/index.js";
import { parseXml, presetDescription } from "../../src/presets/index.js";
import { PreviewService } from "../../src/preview/index.js";
import { FakePlugin } from "./fake-plugin.js";
import { LightroomSim, nefDump } from "./lightroom-sim.js";
import { renderedDumps } from "./lightroom-sim-rendered.js";

export const map = loadDefaultParamMap();
const FIXTURES = fileURLToPath(new URL("../fixtures/presets/", import.meta.url));
export const UUIDS = { nef2: "SIM-NEF2", jpg: "SIM-JPG", jpg11: "SIM-JPG-11", copy1: "SIM-JPG-C1", tif: "SIM-TIF" } as const;

export const h = {
  plugin: null as unknown as FakePlugin,
  lr: null as unknown as LightroomSim,
  tmp: "",
  presetDir: "",
  said: [] as string[],
  clients: [] as BridgeClient[],
  state: memoryStore(checkStateSchema),
  /** Simulated Jim stops (input ends) at the first prompt matching this. */
  stopAt: null as RegExp | null,
  clicked: false,
};
const dir = (name: string): string => path.join(h.tmp, name);

export function usePhase8Harness(): void {
  beforeEach(async () => {
    h.tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-p8check-"));
    for (const d of ["previews", "chat-logs", "presets"]) mkdirSync(dir(d));
    h.presetDir = dir("presets");
    copyFileSync(path.join(FIXTURES, "reference-rendered.lrc15.xmp"), path.join(h.presetDir, `${REFERENCE_PRESETS[0]}.xmp`));
    copyFileSync(path.join(FIXTURES, "reference-rendered-mono.lrc15.xmp"), path.join(h.presetDir, `${REFERENCE_PRESETS[1]}.xmp`));
    h.plugin = await FakePlugin.start();
    h.lr = new LightroomSim(dir("previews"));
    const lib = (uuid: string, local_id: number, filename: string, file_format: string, settings: Record<string, unknown>, copy_name?: string) =>
      h.lr.library.photos.push({ uuid, local_id, filename, rating: 0, keywords: [], day: "2004-09-25", gps: null, file_format, settings: structuredClone(settings), ...(copy_name ? { copy_name } : {}) });
    lib(UUIDS.nef2, 11, "_DSC0103.NEF", "RAW", nefDump.settings);
    lib(UUIDS.jpg, 12, "DSC_0031.JPG", "JPG", renderedDumps["15.4"].settings);
    lib(UUIDS.jpg11, 13, "DSC_0031.JPG", "JPG", renderedDumps["11.0"].settings);
    lib(UUIDS.copy1, 14, "DSC_0031.JPG", "JPG", renderedDumps["15.4"].settings, "Copy 1");
    lib(UUIDS.tif, 15, "20260907-_OZ80099-Edit.tif", "TIFF", renderedDumps["15.4"].settings);
    h.lr.missing.add(UUIDS.tif);
    h.lr.library.collections.push({ local_id: 503, name: COLLECTION, smart: false, photos: [h.lr.uuid, UUIDS.nef2, UUIDS.jpg, UUIDS.jpg11, UUIDS.copy1, UUIDS.tif] });
    h.lr.install(h.plugin);
    h.said.length = 0;
    h.state = memoryStore(checkStateSchema);
    h.stopAt = null;
    h.clicked = false;
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

/** Claude Desktop's engine in the chat: a session on the selected photo, one pass, accept. */
async function simulatedChat(): Promise<void> {
  const client = newClient();
  client.start();
  const desktop = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: dir("previews") }),
    intents: new IntentLibrary({ map, userDir: dir("desk-intents") }),
    sessionLogDir: dir("desk-sessions"),
    engineVersion: ENGINE_VERSION,
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    log: new ToolLog(dir("chat-logs")),
    hud: false,
  });
  const id = String((await desktop.beginSession({ intent_id: "portrait_natural_light", return_image: "none" })).json["session_id"]);
  await desktop.step({ session_id: id, settings: { vibrance: 3 }, rationale: "warmer skin", return_image: "none" });
  await desktop.endSession({ session_id: id, outcome: "accept" });
  client.stop();
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
  const file = readdirSync(h.presetDir, { recursive: true, encoding: "utf8" }).find((f) => path.basename(f) === `${name}.xmp`);
  if (!file) return;
  const target = h.lr.settingsOf(h.lr.selected);
  for (const [attr, raw] of presetDescription(parseXml(readFileSync(path.join(h.presetDir, file), "utf8"))).attrs) {
    const key = attr.replace(/^crs:/, "");
    if (!attr.startsWith("crs:") || !(key in target) || (key === "CameraProfile" && raw.startsWith("Default "))) continue;
    const was = target[key];
    target[key] = typeof was === "number" ? Number(raw) : typeof was === "boolean" ? raw === "True" : raw;
  }
  h.clicked = true;
}

/** Jim's clicks and Enters, from the prompt's words. */
async function jim(text: string): Promise<string | null> {
  if (h.stopAt?.test(text)) return null;
  if (/3\. Then press Enter here/.test(text)) h.plugin.dropEventClient();
  const preset = /click "(AVG P8check [^"]+)" once/.exec(text);
  if (preset) clickPreset(preset[1] as string);
  if (/6\. Come back to this window/.test(text)) await simulatedChat();
  if (/^ {2}3\. Press Enter here/.test(text)) for (const f of readdirSync(h.presetDir, { recursive: true, encoding: "utf8" })) if (f.endsWith(".xmp")) unlinkSync(path.join(h.presetDir, f));
  return "";
}

/** One run of the check against the sim, with Jim's y/n answers in order ("no answer" once they run out). */
export function runCheck(answers: Answer[], options: { fresh?: boolean; tamper?: (tools: Tools) => void } = {}) {
  const queue = [...answers];
  const client = newClient();
  const previews = new PreviewService(client, { previewDir: dir("previews") });
  const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
  const tools = new Tools({
    client,
    map,
    previews,
    intents: new IntentLibrary({ map, userDir: dir("intents") }),
    sessionLogDir: dir("sessions"),
    presetDir: h.presetDir,
    engineVersion: "test",
    ensureBridge: () => gate.ready(),
    hud: false,
  });
  options.tamper?.(tools);
  return runPhase8Check(
    {
      client,
      gate,
      tools,
      map,
      ask: async () => queue.shift() ?? "no answer",
      prompt: jim,
      say: (line) => h.said.push(line),
      collectChat,
      presetDir: h.presetDir,
      state: h.state,
      stamp: `2026-10-10T10-00-0${h.state.saved?.runs.length ?? 0}-000Z`,
      connectTimeoutMs: 2000,
      restartTimeoutMs: 5000,
      bridgeWaitMs: 2000,
      pollMs: 20,
      settleMs: 0,
    },
    options.fresh ? { fresh: true } : {},
  );
}

/** Every y/n: the preset listed, the chat's three questions, the snapshot deleted. */
export const YES: Answer[] = ["y", "y", "y", "y", "y"];
export const failures = (): string[] => h.said.filter((l) => l.startsWith("FAILED"));
export const saved = (): CheckState => h.state.saved as CheckState;
