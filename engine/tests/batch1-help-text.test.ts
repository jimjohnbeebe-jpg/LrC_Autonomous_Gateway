// Hands-on batch 1, guidance: lr_help (src/mcp/defs-help.ts), the server's instructions, the shorter
// lr_begin_session description and the suggested mask name style, through a real MCP client.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HELP_TEXT, INSTRUCTIONS } from "../src/mcp/defs-help.js";
import { createServer, type Tools } from "../src/mcp/index.js";

let client: Client;
let tools: Tool[];
const tool = (name: string): Tool | undefined => tools.find((t) => t.name === name);
const prop = (t: Tool | undefined, key: string): { description?: string } => (t?.inputSchema.properties?.[key] ?? {}) as { description?: string };

beforeAll(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({} as Tools).connect(serverSide);
  client = new Client({ name: "batch1-help", version: "0" });
  await client.connect(clientSide);
  tools = (await client.listTools()).tools;
});

afterAll(async () => {
  await client.close();
});

describe("hands-on batch 1: guidance", () => {
  it("lists lr_help as a read-only tool with no arguments, and it returns HELP_TEXT", async () => {
    const help = tool("lr_help");
    expect(help?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: false });
    expect(help?.inputSchema.required ?? []).toEqual([]);
    const res = await client.callTool({ name: "lr_help", arguments: {} });
    expect(res.isError).toBeFalsy();
    const text = (res.content as Array<{ type: string; text?: string }>).find((c) => c.type === "text")?.text;
    expect(JSON.parse(String(text))).toEqual({ help: HELP_TEXT });
    expect(HELP_TEXT).toMatch(/A rename alone .* uses no pass/);
    expect(HELP_TEXT).toMatch(/clip_baseline/);
    expect(HELP_TEXT).toMatch(/crop_metrics/);
  });

  it("advertises the instructions, which point to lr_help", () => {
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(/lr_help/);
  });

  it("keeps lr_begin_session's description under 2,000 characters, pointing to lr_help", () => {
    const begin = tool("lr_begin_session")?.description ?? "";
    expect(begin.length).toBeLessThan(2000);
    expect(begin).toMatch(/THE USER'S REQUEST COMES FIRST/);
    expect(begin).toMatch(/lr_help explains/);
    expect(prop(tool("lr_begin_session"), "notes").description).toMatch(/suggested on every session/);
  });

  it("suggests a mask name style on create and edit, and says a rename alone uses no pass", () => {
    expect(prop(tool("lr_create_mask"), "name").description).toMatch(/suggested/);
    expect(prop(tool("lr_edit_mask"), "name").description).toMatch(/suggested/);
    expect(tool("lr_edit_mask")?.description).toMatch(/A rename alone .* is not a pass/);
  });

  it("says which metrics a region preview's result carries", () => {
    expect(tool("lr_get_preview")?.description).toMatch(/metrics_scope.*crop_metrics/);
  });
});
