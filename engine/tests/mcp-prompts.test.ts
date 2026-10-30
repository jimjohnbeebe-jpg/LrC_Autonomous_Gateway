// MCP prompts and the .mcpb manifest (issue #219) through a real MCP client over the in-memory transport.
// Neither touches Lightroom, so the server gets no real Tools.

import { readFileSync } from "node:fs";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildManifest } from "../src/devtools/mcpb-manifest.js";
import { manifestToolProblems } from "../src/devtools/mcpb-build.js";
import { createServer, ENGINE_VERSION, TOOL_DEFS, type Tools } from "../src/mcp/index.js";
import { HELP_TEXT } from "../src/mcp/defs-help.js";

let mcp: Client;

beforeEach(async () => {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer({} as unknown as Tools).connect(serverSide);
  mcp = new Client({ name: "test", version: "0" });
  await mcp.connect(clientSide);
});
afterEach(() => mcp.close());

describe("prompts", () => {
  it("lists the request template, the help prompt and the shoot prompts", async () => {
    const { prompts } = await mcp.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["lrc-avg-edit", "lrc-avg-help", "lrc-avg-cull", "lrc-avg-keyword", "lrc-avg-batch"]);
  });

  it.each(["lrc-avg-cull", "lrc-avg-keyword", "lrc-avg-batch"])("%s names only registered tools, the contact sheet among them, and puts the request in", async (name) => {
    const got = await mcp.getPrompt({ name, arguments: { request: "my words" } });
    const text = (got.messages[0]?.content as { text: string }).text;
    const named = [...new Set(text.match(/\blr_[a-z_]+\b/g))];
    const registered = new Set(TOOL_DEFS.map((d) => d.name));
    expect(named.filter((n) => !registered.has(n))).toEqual([]);
    expect(named).toContain("lr_get_contact_sheet");
    expect(text).toContain("My request: my words");
    expect(text).toContain("full tool profile");
    expect(text).not.toMatch(/cells\[n-1\]|targets "selected"/); // Greptile, PR #262: label gaps; the approved uuids, not the selection again
  });

  it("puts the user's request into the template", async () => {
    const got = await mcp.getPrompt({ name: "lrc-avg-edit", arguments: { request: "warm the sunset" } });
    const text = (got.messages[0]?.content as { text: string }).text;
    expect(text).toContain("My request: warm the sunset");
    expect(text).toContain("lr_begin_session");
  });

  it("serves the lr_help text", async () => {
    const got = await mcp.getPrompt({ name: "lrc-avg-help" });
    expect((got.messages[0]?.content as { text: string }).text).toBe(HELP_TEXT);
  });

  it("refuses an unknown prompt", async () => {
    await expect(mcp.getPrompt({ name: "nope" })).rejects.toThrow(/Unknown prompt/);
  });
});

describe(".mcpb manifest", () => {
  it("lists exactly the tools a client sees, with the engine's version", async () => {
    const manifest = buildManifest(ENGINE_VERSION, TOOL_DEFS);
    const { tools } = await mcp.listTools();
    expect(manifestToolProblems(manifest, tools.map((t) => t.name))).toEqual([]);
    expect(manifest.version).toBe(ENGINE_VERSION);
    const plugin = JSON.parse(readFileSync(path.join(import.meta.dirname, "..", "..", ".claude-plugin", "plugin.json"), "utf8")) as { version: string };
    expect(plugin.version).toBe(ENGINE_VERSION);
    expect(manifest.tools.every((t) => t.description.length > 0)).toBe(true);
  });

  it("reports a tool the manifest lacks", () => {
    const manifest = buildManifest(ENGINE_VERSION, TOOL_DEFS.slice(1));
    expect(manifestToolProblems(manifest, TOOL_DEFS.map((d) => d.name))).toEqual([`missing: ${TOOL_DEFS[0]?.name}`]);
  });
});
