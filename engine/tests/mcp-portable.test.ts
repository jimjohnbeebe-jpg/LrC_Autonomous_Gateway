// Issue #155 R4: a tool list every MCP client can take. Names stay at most 40 characters (a client
// prefix such as `mcp_lrc_avg_` still leaves them under the 63-character cut of Gemini-family
// clients), descriptions at most 4,096 characters (Claude Code's upfront cut), and no inputSchema has
// anyOf/oneOf/allOf at its root [inference: the limits, ISSUE155_PLAN.md R4 and its client table].

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer, type Tools } from "../src/mcp/index.js";

let tools: Tool[];

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({} as Tools).connect(serverSide);
  const client = new Client({ name: "portable", version: "0" });
  await client.connect(clientSide);
  tools = (await client.listTools()).tools;
  await client.close();
});

const longest = (lengths: number[]): number => Math.max(...lengths);

describe("portable tool list (issue #155 R4)", () => {
  it("keeps every tool name at most 40 characters", () => {
    const max = longest(tools.map((t) => t.name.length));
    expect(tools.filter((t) => t.name.length > 40).map((t) => t.name), `longest name now: ${max}`).toEqual([]);
  });

  it("keeps every description at most 4,096 characters", () => {
    const max = longest(tools.map((t) => (t.description ?? "").length));
    expect(tools.filter((t) => (t.description ?? "").length > 4096).map((t) => t.name), `longest description now: ${max}`).toEqual([]);
  });

  it("has no anyOf, oneOf or allOf at the root of any inputSchema", () => {
    const rooted = tools.filter((t) => ["anyOf", "oneOf", "allOf"].some((k) => k in t.inputSchema)).map((t) => t.name);
    expect(rooted).toEqual([]);
  });
});
