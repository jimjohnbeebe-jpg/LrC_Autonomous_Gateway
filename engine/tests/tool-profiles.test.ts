// Tool profiles (issue #165, epic #207 decision D6; src/mcp/profiles.ts): which tools the server lists and
// accepts, picked by LRC_AVG_TOOLS; the setup's --tools and the .mcpb manifest that write it.

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildManifest } from "../src/devtools/mcpb-manifest.js";
import { createServer, ENGINE_VERSION, TOOL_DEFS, type Tools } from "../src/mcp/index.js";
import { DEFAULT_PROFILE, EDIT_TOOLS, PROFILE_ENV, PROFILES, toolProfile } from "../src/mcp/profiles.js";
import { engineEntry, planConfig, SERVER_NAME, TOOL_PROFILES, TOOLS_ENV } from "../src/setup/desktop-config.js";
import { runSetup } from "../src/setup/setup-run.js";

type Text = Array<{ type: string; text?: string }>;
const stub = { recordRejected: () => undefined, recordPending: () => undefined, progressNote: () => null } as unknown as Tools;

async function connect(): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer(stub).connect(serverSide);
  const client = new Client({ name: "profiles", version: "0" });
  await client.connect(clientSide);
  return client;
}

async function call(client: Client, name: string): Promise<{ isError: boolean; json: Record<string, unknown> }> {
  const res = await client.callTool({ name, arguments: {} });
  const text = (res.content as Text).find((c) => c.type === "text")?.text;
  return { isError: res.isError === true, json: JSON.parse(String(text)) as Record<string, unknown> };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the profiles", () => {
  it("names only registered tools in the edit profile, once each", () => {
    const registered = new Set(TOOL_DEFS.map((d) => d.name));
    expect(EDIT_TOOLS.filter((n) => !registered.has(n))).toEqual([]);
    expect(new Set(EDIT_TOOLS).size).toBe(EDIT_TOOLS.length);
  });

  it("reads LRC_AVG_TOOLS in any letter case; unset or unknown gives full", () => {
    expect(DEFAULT_PROFILE).toBe("full");
    expect(toolProfile({})).toEqual({ name: "full" });
    expect(toolProfile({ [PROFILE_ENV]: " Edit " })).toEqual({ name: "edit" });
    expect(toolProfile({ [PROFILE_ENV]: "small" })).toEqual({ name: "full", ignored: "small" });
  });

  it("has the setup's copy of the variable and values equal to the engine's", () => {
    expect(TOOLS_ENV).toBe(PROFILE_ENV);
    expect([...TOOL_PROFILES]).toEqual([...PROFILES]);
  });
});

describe("the server under a profile", () => {
  it("lists every registered tool by default, and lr_help says full", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual(TOOL_DEFS.map((d) => d.name));
    expect((await call(client, "lr_help")).json["tool_profile"]).toMatchObject({ name: "full", tools: "every tool" });
    await client.close();
  });

  it("lists only the edit tools under edit, refuses the others naming the full profile, and lr_help lists them", async () => {
    vi.stubEnv(PROFILE_ENV, "edit");
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...EDIT_TOOLS].sort());
    const refused = await call(client, "lr_search_photos");
    expect(refused.isError).toBe(true);
    expect(JSON.stringify(refused.json)).toMatch(/UNKNOWN_TOOL.*in the full profile, not in \\"edit\\": LRC_AVG_TOOLS=full/);
    expect((await call(client, "lr_help")).json["tool_profile"]).toMatchObject({ name: "edit", tools: [...EDIT_TOOLS] });
    await client.close();
  });

  it("serves full for an unknown value and says so in lr_help", async () => {
    vi.stubEnv(PROFILE_ENV, "small");
    const client = await connect();
    expect((await client.listTools()).tools).toHaveLength(TOOL_DEFS.length);
    expect((await call(client, "lr_help")).json["tool_profile"]).toMatchObject({ name: "full", ignored: expect.stringMatching(/"small" is not a profile/) });
    await client.close();
  });
});

describe("what writes the profile", () => {
  const entry = engineEntry("C:\\x\\main.js", "C:\\node.exe");

  it("keeps an existing entry's profile when the setup runs again without --tools, and sets it with --tools", () => {
    const chosen = { ...entry, env: { [TOOLS_ENV]: "edit" } };
    expect(planConfig({ mcpServers: { [SERVER_NAME]: chosen } }, entry)).toMatchObject({ unchanged: true });
    const full = engineEntry("C:\\x\\main.js", "C:\\node.exe", { [TOOLS_ENV]: "full" });
    expect(planConfig({ mcpServers: { [SERVER_NAME]: chosen } }, full).updated.mcpServers?.[SERVER_NAME]).toEqual(full);
    expect(planConfig({}, entry).updated.mcpServers?.[SERVER_NAME]).toEqual(entry);
  });

  it("refuses an unknown --tools value", () => {
    const out = runSetup(["--tools", "small"], { mainJs: "C:\\x\\main.js", execPath: "C:\\node.exe", version: "0" });
    expect(out.exitCode).toBe(1);
    expect(out.err[0]).toMatch(/--tools needs one of full, edit/);
  });

  it("offers the profile in the .mcpb manifest, which lists every tool", () => {
    const manifest = buildManifest(ENGINE_VERSION, TOOL_DEFS);
    expect(manifest.tools).toHaveLength(TOOL_DEFS.length);
    expect(manifest.server.mcp_config.env).toEqual({ [PROFILE_ENV]: "${user_config.tool_profile}" });
    expect(manifest.user_config["tool_profile"]).toMatchObject({ type: "string", default: "full", required: false });
  });
});
