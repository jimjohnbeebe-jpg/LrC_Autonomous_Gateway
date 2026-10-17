// The "last started" record (src/log/last-start.ts, PHASE9_PLAN decision D4): written at each MCP
// initialize, in %LOCALAPPDATA%\LrC-AVG\, and never a reason for the server to fail.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientIdentity } from "../src/mcp/client-info.js";
import { createServer } from "../src/mcp/server.js";
import type { Tools } from "../src/mcp/tools.js";
import { LAST_START_FILE, buildLastStart, lastStartPath, lastStartSchema, writeLastStart } from "../src/log/last-start.js";

const MAIN_JS = "C:\\Users\\x\\AppData\\Local\\LrC-AVG\\resources\\engine\\dist\\mcp\\main.js";
const NODE = "C:\\Users\\x\\AppData\\Local\\LrC-AVG\\resources\\node\\node.exe";

describe("last-start record", () => {
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let file: string;
  const options = { engineVersion: "1.0.0", execPath: NODE, mainJs: MAIN_JS, now: () => new Date("2026-10-17T12:00:00.000Z") };
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-last-start-"));
    env = { LOCALAPPDATA: path.join(tmp, "local") };
    file = path.join(tmp, "local", "LrC-AVG", LAST_START_FILE);
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("lives in %LOCALAPPDATA%\\LrC-AVG\\last-start.json, or ~\\.lrc-avg without LOCALAPPDATA", () => {
    expect(lastStartPath(env)).toBe(file);
    expect(lastStartPath({})).toBe(path.join(os.homedir(), ".lrc-avg", LAST_START_FILE));
  });

  it("writes time, engine version, the client's name and version, the Node and the engine entry", () => {
    writeLastStart({ ...options, env, client: { name: "claude-ai", version: "0.1.0" } });
    const written: unknown = JSON.parse(readFileSync(file, "utf8"));
    expect(lastStartSchema.parse(written)).toEqual({
      time: "2026-10-17T12:00:00.000Z",
      engine_version: "1.0.0",
      client_name: "claude-ai",
      client_version: "0.1.0",
      exec_path: NODE,
      main_js: MAIN_JS,
    });
    expect(Object.keys(written as object)).toEqual(["time", "engine_version", "client_name", "client_version", "exec_path", "main_js"]);
  });

  it("writes nulls when the client sent no usable clientInfo or no version, and overwrites the last record", () => {
    writeLastStart({ ...options, env, client: { name: "claude-ai", version: "0.1.0" } });
    writeLastStart({ ...options, env, client: null });
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ client_name: null, client_version: null });
    expect(buildLastStart({ ...options, client: { name: "opencode", version: "" } })).toMatchObject({ client_name: "opencode", client_version: null });
  });

  it("defaults the Node and the entry to this process", () => {
    const r = buildLastStart({ engineVersion: "1.0.0", client: null });
    expect(r.exec_path).toBe(process.execPath);
    expect(r.main_js).toBe(process.argv[1] ?? "");
    expect(() => lastStartSchema.parse(r)).not.toThrow();
  });

  it("never throws: a failed write is logged once and ignored", () => {
    mkdirSync(path.join(tmp, "local"), { recursive: true });
    writeFileSync(path.join(tmp, "local", "LrC-AVG"), "a file where the folder should be");
    const logged: string[] = [];
    expect(() => writeLastStart({ ...options, env, client: null, log: (m) => logged.push(m) })).not.toThrow();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("could not write");
    expect(logged[0]).toContain(LAST_START_FILE);
  });

  it("is what the server's initialized hook writes: clientInfo is known by then", async () => {
    const server = createServer({} as Tools);
    server.oninitialized = () => writeLastStart({ ...options, env, client: clientIdentity(server.getClientVersion()) });
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await server.connect(serverSide);
    const client = new Client({ name: "test-client", version: "9.9.9" });
    await client.connect(clientSide);
    // the client sends notifications/initialized after connect() resolves
    await vi.waitFor(() => readFileSync(file, "utf8"));
    expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ client_name: "test-client", client_version: "9.9.9" });
    await client.close();
  });
});
