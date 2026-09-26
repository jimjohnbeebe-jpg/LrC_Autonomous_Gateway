// Registering the engine in Claude Desktop's config (src/devtools/desktop-config.ts).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { engineEntry, findDesktopConfigs, planConfig, SERVER_NAME } from "../src/devtools/desktop-config.js";

const entry = engineEntry("D:\\Developer\\LrC_Autonomous_Gateway", "C:\\Program Files\\nodejs\\node.exe");

describe("devtools: Claude Desktop config", () => {
  it("runs the built engine with this Node and points the tool log at the repo's logs folder", () => {
    expect(entry).toEqual({
      command: "C:\\Program Files\\nodejs\\node.exe",
      args: [path.join("D:\\Developer\\LrC_Autonomous_Gateway", "engine", "dist", "mcp", "main.js")],
      env: { LRC_AVG_LOG_DIR: path.join("D:\\Developer\\LrC_Autonomous_Gateway", "logs") },
    });
  });

  it("adds lrc-avg, removes the S3 test server and keeps every other server and setting", () => {
    const github = { command: "github-mcp-server.exe", args: ["stdio"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" } };
    const plan = planConfig({ mcpServers: { github, "lrc-avg-spike-s3": { command: "node" } }, other: { keep: true } }, entry);
    expect(plan).toMatchObject({ added: true, updatedEntry: false, removed: ["lrc-avg-spike-s3"], unchanged: false });
    expect(plan.updated).toEqual({ mcpServers: { github, [SERVER_NAME]: entry }, other: { keep: true } });
  });

  it("updates a stale lrc-avg entry and changes nothing the second time", () => {
    const stale = planConfig({ mcpServers: { [SERVER_NAME]: { command: "old" } } }, entry);
    expect(stale).toMatchObject({ added: false, updatedEntry: true, removed: [], unchanged: false });
    expect(planConfig(stale.updated, entry)).toMatchObject({ unchanged: true, added: false, updatedEntry: false });
  });

  it("works on a config without mcpServers", () => {
    expect(planConfig({}, entry).updated).toEqual({ mcpServers: { [SERVER_NAME]: entry } });
  });
});

describe("devtools: finding Claude Desktop's config", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-desktop-"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("finds the Microsoft Store and the classic locations", () => {
    const msix = path.join(tmp, "local", "Packages", "Claude_abc", "LocalCache", "Roaming", "Claude");
    const classic = path.join(tmp, "roaming", "Claude");
    mkdirSync(msix, { recursive: true });
    mkdirSync(classic, { recursive: true });
    mkdirSync(path.join(tmp, "local", "Packages", "Other_x"), { recursive: true });
    writeFileSync(path.join(msix, "claude_desktop_config.json"), "{}");
    expect(findDesktopConfigs({ LOCALAPPDATA: path.join(tmp, "local"), APPDATA: path.join(tmp, "roaming") })).toEqual([
      path.join(msix, "claude_desktop_config.json"),
    ]);
    writeFileSync(path.join(classic, "claude_desktop_config.json"), "{}");
    expect(findDesktopConfigs({ LOCALAPPDATA: path.join(tmp, "local"), APPDATA: path.join(tmp, "roaming") })).toHaveLength(2);
  });
});
