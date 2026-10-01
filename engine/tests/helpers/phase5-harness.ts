// Set-up of the Phase 5 check tests (tests\phase5-check*.test.ts): the simulated Lightroom in its
// "tonal" model behind a fake plugin (lightroom-sim.ts), a stand-in for the plugin's log
// (%TEMP%\LrC-AVG\bridge.log: the HUD's "shown"/"closed" lines and each click's "sent" line, in
// Log.lua's format), and simulated Jim (phase5-sim-jim.ts), who acts on the check's words. Short
// waits: clicks 5 s, the bridge back 2 s, the approval wait 2.5 s (ToolsDeps.approvalWaitMs).

import { appendFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";
import { BridgeClient, type HudEventName } from "../../src/bridge/index.js";
import type { Answer } from "../../src/devtools/phase1-check.js";
import { runPhase5Check, type CheckOutcome } from "../../src/devtools/phase5-check.js";
import { PHOTO } from "../../src/devtools/phase5-config.js";
import { memoryStateStore, type StateStore } from "../../src/devtools/phase5-state.js";
import { PluginLog, traceHudUpdates, type HudTraceEntry } from "../../src/devtools/phase5-trace.js";
import { IntentLibrary } from "../../src/intents/index.js";
import { ToolLog } from "../../src/log/index.js";
import { BridgeGate, ENGINE_VERSION, Tools } from "../../src/mcp/index.js";
import { loadDefaultParamMap } from "../../src/params/index.js";
import { PreviewService } from "../../src/preview/index.js";
import { PageSettings } from "../../src/settings/index.js";
import { FakePlugin, type FakeReply } from "./fake-plugin.js";
import { hudEvent } from "./lightroom-sim-hud.js";
import { LightroomSim } from "./lightroom-sim.js";
import { collectChat, jimPrompt, jimSays } from "./phase5-sim-jim.js";

export const map = loadDefaultParamMap();
/** Longer than Jim's 1.1 s before his Approve (phase5-sim-jim.ts), which the check needs to see the step blocked (phase5-session-b.ts). */
export const APPROVAL_WAIT_MS = 2500;

/** How simulated Jim and the simulated chats behave in the next run. */
export type SimOptions = {
  /** Jim's answer to each y/n question (default "y"). */
  answer: (question: string) => Answer;
  pick: "A" | "B" | "C";
  /** Clicks Jim does not make: "abort-a", "approve", "abort-wait", "pick", "accept-c", "menu-accept", "menu-hud", "menu-abort". */
  skip: Set<string>;
  /** Jim leaves Mode as it is during the Plug-in Manager visit. */
  pageUnchanged: boolean;
  /** The plugin keeps answering pings during the visit. */
  noPause: boolean;
  /** Jim's Pick also changes the original (a click reaching a photo it should not). */
  tamperOnPick: boolean;
  /** Claude Desktop keeps the bridge after each chat until Jim quits it. */
  lockBusyAfterChat: boolean;
  /** Passes the simulated Claude makes in a golden-hour chat. */
  chatPasses: number;
  /** Input ends at the "come back" prompt of this golden chat (1-6). */
  stopAtChat: number | null;
  /** The plugin logged each click this much earlier: the photo then comes back that much later after the click (AC-2). */
  clickLogEarlierMs: number;
};
export const DEFAULTS = (): SimOptions => ({ answer: () => "y", pick: "B", skip: new Set(), pageUnchanged: false, noPause: false, tamperOnPick: false, lockBusyAfterChat: false, chatPasses: 2, stopAtChat: null, clickLogEarlierMs: 0 });

export const h = {
  plugin: null as unknown as FakePlugin,
  lr: null as unknown as LightroomSim,
  tmp: "",
  logFile: "",
  sim: DEFAULTS(),
  said: [] as string[],
  clients: [] as BridgeClient[],
  store: memoryStateStore() as StateStore & { saved: unknown },
  /** Claude Desktop holds the bridge (the check's lock attempt fails). */
  busy: false,
  /** The chat being held, from the check's words ("The approve chat", "Chat 3 of 6"). */
  chat: "",
};
export const dir = (name: string): string => path.join(h.tmp, name);

/** A line in the stand-in plugin log, in Log.lua's format (local time to the ms). */
export function pluginLog(text: string, earlierMs = 0): void {
  const d = new Date(Date.now() - earlierMs);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
  if (existsSync(h.logFile)) appendFileSync(h.logFile, `${stamp} INFO  ${text}\n`); // a timer may fire after the test removed the folder
}

/** A click in the HUD or a menu item: the event for the HUD's current session, and its "sent" line. */
export function click(name: HudEventName, extra: Record<string, unknown> = {}, source: "hud" | "menu" = "hud"): void {
  const last = h.lr.hud.last();
  if (!last) return;
  const id = `click-${Math.random().toString(36).slice(2, 10)}`;
  pluginLog(`hud: ${name} ${id} from the ${source}: sent`, h.sim.clickLogEarlierMs);
  hudEvent(h.plugin, name, { session_id: last.session_id, seq_seen: last.seq, source, ...extra }, id);
}

/** The HUD's log lines: "hud: shown" when an update opens it, "hud: closed" shortly after an end stage (5 s in Lightroom). */
function logHud(plugin: FakePlugin): void {
  const original = plugin.handlers.get("hud_update");
  if (!original) return;
  plugin.handlers.set("hud_update", async (p, id): Promise<FakeReply> => {
    const r = await original(p, id);
    if (typeof r === "object" && r.ok) {
      const res = r.payload as { applied?: boolean; opened?: boolean };
      if (res.opened) pluginLog("hud: shown");
      if (res.applied && ["accepted", "aborted", "ended"].includes(String(p["stage"]))) {
        setTimeout(() => {
          if (!h.lr.hud.shown) return;
          h.lr.hud.shown = false;
          pluginLog("hud: closing, the session ended");
          pluginLog("hud: closed");
        }, 30);
      }
    }
    return r;
  });
}

export function usePhase5Harness(): void {
  beforeEach(async () => {
    h.tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-p5check-"));
    for (const d of ["previews", "chat-logs"]) mkdirSync(dir(d));
    h.logFile = dir("bridge.log");
    writeFileSync(h.logFile, "");
    h.plugin = await FakePlugin.start();
    h.lr = new LightroomSim(dir("previews"));
    h.lr.renderModel = "tonal";
    h.lr.filename = PHOTO;
    h.lr.install(h.plugin);
    logHud(h.plugin);
    h.sim = DEFAULTS();
    h.said.length = 0;
    h.store = memoryStateStore();
    h.busy = false;
    h.chat = "";
  });
  afterEach(async () => {
    for (const c of h.clients.splice(0)) c.stop();
    await h.plugin.close();
    rmSync(h.tmp, { recursive: true, force: true });
  });
}

/** A client of the fake plugin; `sessionOpen` gives it the session's silence allowance, as main.ts does. */
export function newClient(sessionOpen: () => boolean = () => false): BridgeClient {
  const c = new BridgeClient({ commandPort: h.plugin.commandPort, eventPort: h.plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => h.plugin.token, silenceAllowanceMs: () => (sessionOpen() ? 60000 : 0) });
  h.clients.push(c);
  return c;
}

/** Tools wired as the check's and Claude Desktop's engines are: the settings page, the HUD, the short approval wait. */
export function newTools(client: BridgeClient, ensureBridge: () => Promise<void>, name: string, settings = new PageSettings(client, {})): Tools {
  return new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: dir("previews") }),
    intents: new IntentLibrary({ map, userDir: dir(`${name}-intents`) }),
    sessionLogDir: dir(`${name}-sessions`),
    settings,
    engineVersion: ENGINE_VERSION,
    ensureBridge,
    approvalWaitMs: APPROVAL_WAIT_MS,
    ...(name === "desk" ? { log: new ToolLog(dir("chat-logs")) } : { log: new ToolLog(dir(`${name}-tools`)) }),
  });
}

/** One run of the check against the sim; `fresh` starts over (`--new`). */
export function runCheck(options: { fresh?: boolean } = {}): Promise<CheckOutcome> {
  let tools: Tools | null = null;
  const client = newClient(() => (tools?.sessionManager()?.current() ?? null) !== null);
  const trace: HudTraceEntry[] = [];
  traceHudUpdates(client, trace);
  const gate = new BridgeGate(client, async () => (h.busy ? { ok: false, port: 8767, pid: 4242 } : { ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
  const settings = new PageSettings(client, {});
  tools = newTools(client, () => gate.ready(), "check", settings);
  return runPhase5Check(
    {
      client,
      gate,
      tools,
      map,
      settings,
      ask: async (q) => h.sim.answer(q),
      prompt: jimPrompt,
      say: (line) => {
        h.said.push(line);
        jimSays(line);
      },
      collectChat,
      pluginLog: new PluginLog(h.logFile),
      hudTrace: trace,
      state: h.store,
      stamp: `2026-09-30T10-00-0${h.store.saved ? 1 : 0}-000Z`,
      connectTimeoutMs: 2000,
      clickWaitMs: 5000,
      bridgeWaitMs: 1500,
      pollMs: 20,
      approvalWaitMs: APPROVAL_WAIT_MS,
    },
    options,
  );
}

export const failures = (): string[] => h.said.filter((l) => l.startsWith("FAILED"));
