// Issue #208: the engine's server is MCP SDK v2, but clients in the field (Claude Desktop, Claude Code,
// OpenCode, Codex...) may still be built on v1 [inference]. This drives the v2 server with the v1 SDK's own Client
// (@modelcontextprotocol/sdk 1.32.0, an engine devDependency) over v1's InMemoryTransport: initialize,
// tools/list (the 46 tools of __snapshots__/tools-list.json) and tools/call (a result, and an isError
// result with our ToolError shape). In memory, not stdio: a v1 transport's serverSide has the message
// interface a v2 server connects to, so no child process is needed and the test needs no Lightroom.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, it } from "vitest";
import { createServer, ENGINE_VERSION, type Tools } from "../src/mcp/index.js";

type Content = Array<{ type: string; text?: string }>;

it("lets an MCP SDK v1 client initialize, list the 46 tools and call tools on the v2 server", async () => {
  // lr_help is static text; an unknown tool is refused before any Tools method but recordRejected.
  const tools = { recordRejected: () => undefined } as unknown as Tools;
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  // v1 and v2 declare their Transport types separately; the message interface is the same.
  await createServer(tools).connect(serverSide as never);
  const client = new Client({ name: "v1-client", version: "0" });
  try {
    await client.connect(clientSide);
    expect(client.getServerVersion()).toMatchObject({ name: "lrc-avg", version: ENGINE_VERSION });
    expect(client.getServerCapabilities()).toHaveProperty("tools");
    expect(client.getInstructions()).toEqual(expect.stringContaining("lr_help"));

    const pinned = JSON.parse(readFileSync(fileURLToPath(new URL("./__snapshots__/tools-list.json", import.meta.url)), "utf8")) as Array<{ name: string }>;
    const { tools: listed } = await client.listTools();
    expect(pinned).toHaveLength(46);
    expect(listed.map((t) => t.name)).toEqual(pinned.map((t) => t.name));
    expect(listed.every((t) => t.inputSchema.type === "object")).toBe(true);

    const help = await client.callTool({ name: "lr_help", arguments: {} });
    expect(help.isError).toBeFalsy();
    expect(JSON.parse(String((help.content as Content).find((c) => c.type === "text")?.text))).toMatchObject({ help: expect.any(String) });

    const unknown = await client.callTool({ name: "lr_no_such_tool", arguments: {} });
    expect(unknown.isError).toBe(true);
    expect(JSON.parse(String((unknown.content as Content)[0]?.text))).toMatchObject({ ok: false, error: { code: "UNKNOWN_TOOL", recoverable: false } });
  } finally {
    await client.close();
  }
});
