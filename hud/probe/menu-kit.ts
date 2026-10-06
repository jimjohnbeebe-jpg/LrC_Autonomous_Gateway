// Helpers for the menu probe (Phase 7 row 5, menu.ts): the real engine against Jim's Lightroom (as
// Claude Desktop's engine runs it, engine\src\mcp\main.ts, but without the MCP server), the plugin's
// own log (%TEMP%\LrC-AVG\bridge.log, plugin\LrC-AVG.lrplugin\Log.lua) read from where the probe
// started, and the put-back that always runs at the end (the Phase 5 precedent: repo
// docs\reports\phase5\probes\hud-engine-2026-09-30\probe-hud-engine.mts.txt, step 5).
import { existsSync, openSync, readSync, closeSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BridgeClient } from "../../engine/dist/bridge/index.js";
import { findHudExe } from "../../engine/dist/hud/launch.js";
import { IntentLibrary } from "../../engine/dist/intents/index.js";
import { ToolLog } from "../../engine/dist/log/index.js";
import { ENGINE_VERSION, Tools, devOverrides } from "../../engine/dist/mcp/index.js";
import { loadDefaultParamMap } from "../../engine/dist/params/index.js";
import { PreviewService } from "../../engine/dist/preview/index.js";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// --- The plugin's log ----------------------------------------------------------------------------
const BRIDGE_LOG = path.join(tmpdir(), "LrC-AVG", "bridge.log");

/** The plugin's log from the byte where the probe started (the file only grows during a run; a restart that starts it over reads from 0). */
export class PluginLog {
  private readonly from = existsSync(BRIDGE_LOG) ? statSync(BRIDGE_LOG).size : 0;
  private mark = 0;

  text(): string {
    if (!existsSync(BRIDGE_LOG)) return "";
    const size = statSync(BRIDGE_LOG).size;
    const start = size >= this.from ? this.from : 0;
    const buf = Buffer.alloc(size - start);
    const fd = openSync(BRIDGE_LOG, "r");
    try {
      readSync(fd, buf, 0, buf.length, start);
    } finally {
      closeSync(fd);
    }
    return buf.toString("utf8");
  }

  lines(): string[] {
    return this.text().split(/\r?\n/).filter(Boolean);
  }

  /** Starts a step: `since()` counts only lines written after this. */
  step(): void {
    this.mark = this.lines().length;
  }

  since(): string[] {
    return this.lines().slice(this.mark);
  }

  /** Lines since the step's start that contain `part`. */
  count(part: string): number {
    return this.since().filter((l) => l.includes(part)).length;
  }

  /** Waits up to `ms` for a line since the step's start that contains `part`. */
  async wait(part: string, ms: number): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (this.count(part) > 0) return true;
      await sleep(250);
    }
    return this.count(part) > 0;
  }
}

// --- The engine ----------------------------------------------------------------------------------
/** bridge-gate.ts SESSION_SILENCE_MS (not exported from the mcp index). */
const SESSION_SILENCE_MS = 60_000;

/** What the probe uses of the engine (engine\dist has no .d.ts, and the JS-inferred types are too narrow). */
type Json = { json: Record<string, unknown> };
export type ProbeTools = {
  beginSession(args: Record<string, unknown>): Promise<Json>;
  step(args: Record<string, unknown>): Promise<Json>;
  endSession(args: Record<string, unknown>): Promise<Json>;
  sessionManager(): { current(): { id: string } | null } | null;
  deck(): { open(): Promise<void>; close(): void; connected(): boolean } | null;
};
export type ProbeClient = {
  /** The result as the engine checked it with its own schema (bridge\protocol.ts COMMANDS). */
  request(name: string, payload: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<any>;
  hello(): { plugin_version?: string } | null;
  stop(): void;
};
export type Engine = { client: ProbeClient; tools: ProbeTools; map: ReturnType<typeof loadDefaultParamMap> };

/** The engine with the Deck; `deckOn()` false makes it find no Deck to start (the fallback step). */
export async function startEngine(outDir: string, deckOn: () => boolean, say: (m: string) => void): Promise<Engine> {
  const dev = devOverrides();
  let tools: ProbeTools | null = null;
  const client = new BridgeClient({
    engineVersion: `${ENGINE_VERSION}-menu-probe`,
    log: (m: string) => say(`  (${m})`),
    silenceAllowanceMs: () => ((tools?.sessionManager()?.current() ?? null) !== null ? SESSION_SILENCE_MS : 0),
    ...dev.bridge,
  });
  client.start();
  await client.waitConnected(30_000);
  const map = loadDefaultParamMap();
  const made = new Tools({
    client,
    map,
    previews: new PreviewService(client),
    intents: new IntentLibrary({ map }),
    sessionLogDir: path.join(outDir, "sessions"),
    engineVersion: `${ENGINE_VERSION}-menu-probe`,
    ensureBridge: async () => void (await client.waitConnected(15_000)),
    log: new ToolLog(outDir),
    deck: { log: (m: string) => say(`  (${m})`), launcher: { exe: () => (deckOn() ? findHudExe() : null) } },
  });
  tools = made as unknown as ProbeTools;
  await tools.deck()?.open();
  return { client: client as unknown as ProbeClient, tools, map };
}

export async function settingsOf(e: Engine, uuid: string): Promise<Record<string, unknown>> {
  return e.map.fromSdk((await e.client.request("get_settings", { target_uuid: uuid })).settings).settings;
}

export const differing = (a: Record<string, unknown>, b: Record<string, unknown>): string[] =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));

/** Ends an open edit with "revert", then compares the photo with `start`; applies the first edit's snapshot again if anything differs. */
export async function putBack(e: Engine, uuid: string, start: Record<string, unknown>, snapshotId: string | null): Promise<string[]> {
  const open = e.tools.sessionManager()?.current();
  if (open) await e.tools.endSession({ session_id: open.id, outcome: "revert" });
  let diff = differing(await settingsOf(e, uuid), start);
  if (diff.length > 0 && snapshotId) {
    await e.client.request("apply_snapshot", { target_uuid: uuid, snapshot_id: snapshotId }, { timeoutMs: 30_000 });
    diff = differing(await settingsOf(e, uuid), start);
  }
  return diff;
}

/** Waits up to `ms` for `pred`. */
export async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await sleep(200);
  return pred();
}
