#!/usr/bin/env node
// The engine's entry point: a stdio MCP server that Claude Desktop starts and owns (ARCHITECTURE
// section 2, AVG-002). stdout carries the MCP stream, so everything else goes to stderr (Claude
// Desktop keeps it in its mcp-server-<name>.log) and to the tool log (log/tool-log.ts).
//
// Start-up: serve MCP. The instance lock and the connection to Lightroom are taken on the first
// tool call that needs them, and given back after IDLE_RELEASE_MS without a call (bridge-gate.ts):
// Claude Desktop kept a second engine that it never called, and that one must not hold the bridge
// [handle: Jim's Phase 2 run, 2026-09-26, PIDs 2304 and 12632; the details are in bridge-gate.ts;
// why Desktop keeps two engines is unverified]. A call waits up to 5 s for the connection. Old previews are purged when this engine takes
// the lock (PRD NFR-6), and again at shutdown if it holds it: an engine without the lock never
// touches the shared previews folder, where the engine that holds it may have a preview waiting.
// Shutdown: when stdin ends. On Windows the parent often dies without a signal, and an orphaned
// engine would keep the plugin's single-client sockets and the lock [upstream claim:
// vendor\automaat\server\src\index.ts:194-206].

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { ToolLog, defaultLogDir } from "../log/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { BridgeGate } from "./bridge-gate.js";
import { devOverrides } from "./dev-overrides.js";
import { acquireInstanceLock } from "./instance-lock.js";
import { createServer } from "./server.js";
import { Tools } from "./tools.js";
import { ENGINE_VERSION } from "./version.js";

const say = (message: string): void => console.error(`[lrc-avg] ${message}`);
/**
 * Give the bridge back after a minute without a tool call, so another engine (a second Claude
 * Desktop consumer) can take it. Taking it again costs a reconnect: 521 ms in Phase 1 run 3
 * [handle: docs\reports\phase1\PHASE1.md "Numbers", connect_ms]. The minute is [inference].
 */
const IDLE_RELEASE_MS = 60000;

const dev = devOverrides();
const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: say, ...dev.bridge });
const previews = new PreviewService(client);
const toolLog = new ToolLog(defaultLogDir());
const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort), {
  onAcquire: () => {
    say("took the Lightroom bridge lock");
    previews.purge();
  },
  idleReleaseMs: IDLE_RELEASE_MS,
  onIdleRelease: () => say(`no tool call for ${IDLE_RELEASE_MS / 1000} s; gave the Lightroom bridge back`),
});

const map = loadDefaultParamMap();
const tools = new Tools({
  client,
  map,
  previews,
  intents: new IntentLibrary({ map }),
  ensureBridge: () => gate.ready(),
  log: toolLog,
  onCallStart: () => gate.beginUse(),
  onCallEnd: () => gate.endUse(),
});
await createServer(tools).connect(new StdioServerTransport());

let stopping = false;
const shutdown = (reason: string) => (): void => {
  if (stopping) return;
  stopping = true;
  say(`shutting down: ${reason}`);
  if (gate.holdsLock()) previews.purge();
  void gate.release();
  process.exit(0); // the OS frees the lock port with the process
};
process.stdin.once("end", shutdown("stdin ended (the client exited)"));
process.stdin.once("close", shutdown("stdin closed (the client exited)"));
process.once("SIGINT", shutdown("SIGINT"));
process.once("SIGTERM", shutdown("SIGTERM"));

say(`engine ${ENGINE_VERSION} ready on stdio (node ${process.version}); tool log: ${toolLog.file()}; previews: ${previews.directory()}`);
