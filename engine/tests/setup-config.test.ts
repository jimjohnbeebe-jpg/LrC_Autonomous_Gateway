// Registering the engine in Claude Desktop's config (src/setup/desktop-config.ts, apply-config.ts):
// the dev entry (`npm run desktop:install`) and the user entry (`lrc-avg-setup`).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyDesktopConfig, describeResult, SetupError } from "../src/setup/apply-config.js";
import { CONFIG_FILE, engineEntry, findDesktopConfigs, planConfig, SERVER_NAME } from "../src/setup/desktop-config.js";

const NODE = "C:\\Program Files\\nodejs\\node.exe";
const devMain = path.join("D:\\Developer\\LrC_Autonomous_Gateway", "engine", "dist", "mcp", "main.js");
const entry = engineEntry(devMain, NODE, { LRC_AVG_LOG_DIR: path.join("D:\\Developer\\LrC_Autonomous_Gateway", "logs") });
const github = { command: "github-mcp-server.exe", args: ["stdio"], env: { GITHUB_PERSONAL_ACCESS_TOKEN: "secret" } };

describe("setup: Claude Desktop config entries", () => {
  it("runs the engine with this Node; the dev entry points the tool log at the repo's logs folder", () => {
    expect(entry).toEqual({ command: NODE, args: [devMain], env: { LRC_AVG_LOG_DIR: path.join("D:\\Developer\\LrC_Autonomous_Gateway", "logs") } });
  });

  it("gives the user entry no env, so the tool log goes to its default folder", () => {
    expect(engineEntry("C:\\npm\\node_modules\\lrc-avg\\dist\\mcp\\main.js", NODE)).toEqual({ command: NODE, args: ["C:\\npm\\node_modules\\lrc-avg\\dist\\mcp\\main.js"] });
  });

  it("adds lrc-avg, removes the S3 test server and keeps every other server and setting", () => {
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

  it("removes lrc-avg (and the S3 server) for --remove, keeps the rest, and changes nothing when it is gone", () => {
    const plan = planConfig({ mcpServers: { github, [SERVER_NAME]: entry, "lrc-avg-spike-s3": {} }, other: 1 }, null);
    expect(plan).toMatchObject({ added: false, updatedEntry: false, removed: [SERVER_NAME, "lrc-avg-spike-s3"], unchanged: false });
    expect(plan.updated).toEqual({ mcpServers: { github }, other: 1 });
    expect(planConfig(plan.updated, null)).toMatchObject({ unchanged: true, removed: [] });
  });
});

describe("setup: finding and writing Claude Desktop's config", () => {
  let tmp: string;
  let env: NodeJS.ProcessEnv;
  let msix: string;
  let classic: string;
  beforeEach(() => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-desktop-"));
    env = { LOCALAPPDATA: path.join(tmp, "local"), APPDATA: path.join(tmp, "roaming") };
    msix = path.join(tmp, "local", "Packages", "Claude_abc", "LocalCache", "Roaming", "Claude");
    classic = path.join(tmp, "roaming", "Claude");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("finds the Microsoft Store and the classic locations", () => {
    mkdirSync(msix, { recursive: true });
    mkdirSync(classic, { recursive: true });
    mkdirSync(path.join(tmp, "local", "Packages", "Other_x"), { recursive: true });
    writeFileSync(path.join(msix, CONFIG_FILE), "{}");
    expect(findDesktopConfigs(env)).toEqual([path.join(msix, CONFIG_FILE)]);
    writeFileSync(path.join(classic, CONFIG_FILE), "{}");
    expect(findDesktopConfigs(env)).toHaveLength(2);
  });

  it("writes a backup, keeps the other servers, and changes nothing the second time", () => {
    mkdirSync(msix, { recursive: true });
    const file = path.join(msix, CONFIG_FILE);
    writeFileSync(file, JSON.stringify({ mcpServers: { github }, other: true }));
    const first = applyDesktopConfig({ entry, env });
    expect(first).toMatchObject({ configPath: file, created: false, before: ["github"], after: ["github", SERVER_NAME], changes: [`add "${SERVER_NAME}"`] });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ mcpServers: { github, [SERVER_NAME]: entry }, other: true });
    expect(readdirSync(msix).filter((f) => f.startsWith(`${CONFIG_FILE}.backup-`))).toEqual([first.backup]);
    const again = applyDesktopConfig({ entry, env });
    expect(again).toMatchObject({ changes: [], backup: null });
    expect(describeResult(again, false).at(-1)).toContain("Nothing to change");
  });

  it("creates the config in the one Claude folder when there is no file yet (decision D1)", () => {
    mkdirSync(msix, { recursive: true });
    const r = applyDesktopConfig({ entry, env });
    expect(r).toMatchObject({ configPath: path.join(msix, CONFIG_FILE), created: true, backup: null, changes: [`add "${SERVER_NAME}"`] });
    expect(JSON.parse(readFileSync(r.configPath, "utf8"))).toEqual({ mcpServers: { [SERVER_NAME]: entry } });
  });

  it("refuses without a Claude folder, or with two folders and no file, and writes nothing", () => {
    expect(() => applyDesktopConfig({ entry, env })).toThrow(/Start Claude Desktop once/);
    mkdirSync(msix, { recursive: true });
    mkdirSync(classic, { recursive: true });
    expect(() => applyDesktopConfig({ entry, env })).toThrow(/found 2 Claude Desktop folders/);
    expect(existsSync(path.join(msix, CONFIG_FILE)) || existsSync(path.join(classic, CONFIG_FILE))).toBe(false);
  });

  it("refuses two config files, bad JSON and a bad shape, and leaves the file as it was", () => {
    mkdirSync(msix, { recursive: true });
    mkdirSync(classic, { recursive: true });
    writeFileSync(path.join(msix, CONFIG_FILE), "{}");
    writeFileSync(path.join(classic, CONFIG_FILE), "{}");
    expect(() => applyDesktopConfig({ entry, env })).toThrow(/found 2 Claude Desktop config files/);
    const file = path.join(tmp, "explicit.json");
    for (const bad of ["{not json", JSON.stringify({ mcpServers: [] })]) {
      writeFileSync(file, bad);
      expect(() => applyDesktopConfig({ entry, configPath: file, env })).toThrow(SetupError);
      expect(readFileSync(file, "utf8")).toBe(bad);
    }
    expect(() => applyDesktopConfig({ entry, configPath: path.join(tmp, "missing.json"), env })).toThrow(/config file not found/);
  });

  it("writes nothing in a dry run, and --remove with no file changes nothing", () => {
    const file = path.join(tmp, "explicit.json");
    writeFileSync(file, "{}");
    expect(applyDesktopConfig({ entry, configPath: file, dryRun: true, env }).changes).toEqual([`add "${SERVER_NAME}"`]);
    expect(readFileSync(file, "utf8")).toBe("{}");
    expect(readdirSync(tmp)).toEqual(["explicit.json"]);
    expect(applyDesktopConfig({ entry, configPath: file, env }).backup).toMatch(/^explicit\.json\.backup-/);
    mkdirSync(msix, { recursive: true });
    expect(applyDesktopConfig({ entry: null, env })).toMatchObject({ created: false, changes: [] });
    expect(existsSync(path.join(msix, CONFIG_FILE))).toBe(false);
  });
});
