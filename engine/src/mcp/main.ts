#!/usr/bin/env node
// The engine's entry point: a stdio MCP server that Claude Desktop starts and owns (ARCHITECTURE
// section 2, AVG-002). stdout carries the MCP stream, so everything else goes to stderr (Claude
// Desktop keeps it in its mcp-server-<name>.log) and to the tool log (log/tool-log.ts).
//
// Start-up: purge old previews (PRD NFR-6), take the instance lock and start connecting to
// Lightroom (bridge-gate.ts), then serve MCP. Tools wait up to 5 s for the bridge, so a call made
// right after start-up does not fail while the connection is still being made.
// Shutdown: when stdin ends. On Windows the parent often dies without a signal, and an orphaned
// engine would keep the plugin's single-client sockets and the lock [upstream claim:
// vendor\automaat\server\src\index.ts:194-206].

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { BridgeClient } from "../bridge/index.js";
import { ToolLog, defaultLogDir } from "../log/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { BridgeGate } from "./bridge-gate.js";
import { acquireInstanceLock, defaultLockFile } from "./instance-lock.js";
import { createServer } from "./server.js";
import { Tools } from "./tools.js";
import { ENGINE_VERSION } from "./version.js";

const say = (message: string): void => console.error(`[lrc-avg] ${message}`);

const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: say });
const previews = new PreviewService(client);
previews.purge();
const toolLog = new ToolLog(defaultLogDir());
const gate = new BridgeGate(client, () => acquireInstanceLock(defaultLockFile()));
if (!gate.start()) say("another engine holds the Lightroom bridge; tools answer ENGINE_BUSY until it exits");

const tools = new Tools({ client, map: loadDefaultParamMap(), previews, ensureBridge: () => gate.ready(), log: toolLog });
await createServer(tools).connect(new StdioServerTransport());

let stopping = false;
const shutdown = (reason: string) => (): void => {
  if (stopping) return;
  stopping = true;
  say(`shutting down: ${reason}`);
  gate.release();
  previews.purge();
  process.exit(0);
};
process.stdin.once("end", shutdown("stdin ended (the client exited)"));
process.stdin.once("close", shutdown("stdin closed (the client exited)"));
process.once("SIGINT", shutdown("SIGINT"));
process.once("SIGTERM", shutdown("SIGTERM"));

say(`engine ${ENGINE_VERSION} ready on stdio (node ${process.version}); tool log: ${toolLog.file()}; previews: ${previews.directory()}`);
