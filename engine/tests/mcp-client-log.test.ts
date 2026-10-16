// Issue #155 R1: every tool-log line of a call names the client from the MCP handshake (clientInfo),
// a call refused before it reached a tool included.

import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { ToolLog } from "../src/log/index.js";
import { createServer, ENGINE_VERSION, Tools } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import type { BridgeClient } from "../src/bridge/index.js";
import type { PreviewService } from "../src/preview/index.js";

let tmp: string;
let mcp: Client;

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-client-log-"));
  const map = loadDefaultParamMap();
  const tools = new Tools({
    client: {} as BridgeClient,
    map,
    previews: {} as PreviewService,
    intents: new IntentLibrary({ map, userDir: path.join(tmp, "intents") }),
    engineVersion: ENGINE_VERSION,
    ensureBridge: () => Promise.resolve(),
    log: new ToolLog(path.join(tmp, "logs")),
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(tools).connect(serverSide);
  mcp = new Client({ name: "opencode", version: "1.0" });
  await mcp.connect(clientSide);
});

afterEach(async () => {
  await mcp.close();
  rmSync(tmp, { recursive: true, force: true });
});

it("logs the client of an ok call and of an unknown-tool call", async () => {
  expect((await mcp.callTool({ name: "lr_list_intents", arguments: {} })).isError).toBeFalsy();
  expect((await mcp.callTool({ name: "lr_no_such_tool", arguments: {} })).isError).toBe(true);
  const dir = path.join(tmp, "logs");
  const lines = readdirSync(dir).flatMap((f) => readFileSync(path.join(dir, f), "utf8").trim().split("\n"));
  expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toEqual([
    expect.objectContaining({ tool: "lr_list_intents", ok: true, client: { name: "opencode", version: "1.0" } }),
    expect.objectContaining({ tool: "lr_no_such_tool", ok: false, client: { name: "opencode", version: "1.0" } }),
  ]);
});
