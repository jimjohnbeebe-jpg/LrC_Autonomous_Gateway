// MCP prompts and the .mcpb manifest (issue #219) through a real MCP client over the in-memory transport.
// Neither touches Lightroom, so the server gets no real Tools.

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
  it("lists the request template and the help prompt", async () => {
    const { prompts } = await mcp.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["lrc-avg-edit", "lrc-avg-help"]);
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
    expect(manifest.tools.every((t) => t.description.length > 0)).toBe(true);
  });

  it("reports a tool the manifest lacks", () => {
    const manifest = buildManifest(ENGINE_VERSION, TOOL_DEFS.slice(1));
    expect(manifestToolProblems(manifest, TOOL_DEFS.map((d) => d.name))).toEqual([`missing: ${TOOL_DEFS[0]?.name}`]);
  });
});
