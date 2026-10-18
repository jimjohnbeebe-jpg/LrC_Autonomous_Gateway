// Putting Claude Desktop's "lrc-avg" entry back after `npm run intents:check -- --restore` (issue #180;
// src/devtools/intents-restore.ts), with a temporary folder standing in for %LOCALAPPDATA%.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { entryBefore, putClaudeDesktopBack } from "../src/devtools/intents-restore.js";

let tmp: string;
let env: NodeJS.ProcessEnv;
let dir: string;
let config: string;
let mainJs: string;

const WORKTREE = { command: "node", args: [] as string[], env: { LRC_AVG_LOG_DIR: "C:\\worktree\\logs" } };
const USUAL = { command: "C:\\Repo\\node.exe", args: ["D:\\repo\\engine\\dist\\mcp\\main.js"], env: { LRC_AVG_LOG_DIR: "D:\\repo\\logs" } };
const OLDER = { command: "C:\\Setup\\node.exe", args: ["C:\\Setup\\main.js"] };
const OTHER = { command: "other.exe", args: [], env: { TOKEN: "secret" } };

const json = (servers: Record<string, unknown>): string => JSON.stringify({ theme: "dark", mcpServers: servers }, null, 2) + "\n";
const backup = (time: string, servers: Record<string, unknown>): void => writeFileSync(`${config}.backup-2026-10-18T${time}Z`, json(servers));
const now = (): { mcpServers: Record<string, unknown> } => JSON.parse(readFileSync(config, "utf8")) as { mcpServers: Record<string, unknown> };

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrcavg-restore-"));
  env = { LOCALAPPDATA: path.join(tmp, "Local") };
  dir = path.join(tmp, "Local", "Claude-Data", "claude_abc");
  mkdirSync(dir, { recursive: true });
  config = path.join(dir, "claude_desktop_config.json");
  mainJs = path.join(tmp, "worktree", "engine", "dist", "mcp", "main.js");
  WORKTREE.args = [mainJs];
  writeFileSync(config, json({ "lrc-avg": WORKTREE, other: OTHER }));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("intents:check --restore", () => {
  it("puts back the entry of the newest backup that does not run this engine, and leaves the other servers and settings alone", () => {
    backup("10-00-00-000", { "lrc-avg": OLDER, other: OTHER });
    backup("12-00-00-000", { "lrc-avg": USUAL, other: OTHER });
    backup("12-30-00-000", { "lrc-avg": WORKTREE, other: OTHER }); // a second desktop:install that changed nothing else
    const result = putClaudeDesktopBack(mainJs, env);
    expect(result).toMatchObject({ put_back: "YES", detail: expect.stringContaining("claude_desktop_config.json.backup-2026-10-18T12-00-00-000Z") });
    expect(now().mcpServers).toEqual({ "lrc-avg": USUAL, other: OTHER });
    expect(JSON.parse(readFileSync(config, "utf8"))).toMatchObject({ theme: "dark" });
  });

  it("takes the entry out when the backup that desktop:install made had none", () => {
    backup("12-00-00-000", { other: OTHER });
    expect(putClaudeDesktopBack(mainJs, env)).toMatchObject({ put_back: "YES", detail: expect.stringContaining("had none") });
    expect(now().mcpServers).toEqual({ other: OTHER });
  });

  it("does nothing when the entry does not run this engine, also when asked twice", () => {
    backup("12-00-00-000", { "lrc-avg": USUAL });
    expect(putClaudeDesktopBack(mainJs, env).put_back).toBe("YES");
    const after = readFileSync(config, "utf8");
    expect(putClaudeDesktopBack(mainJs, env).put_back).toBe("NOT NEEDED");
    expect(readFileSync(config, "utf8")).toBe(after);
  });

  it("says NO, and changes nothing, when no backup qualifies or the config is not clearly one", () => {
    const before = readFileSync(config, "utf8");
    expect(putClaudeDesktopBack(mainJs, env).put_back).toBe("NO");
    backup("12-00-00-000", { "lrc-avg": WORKTREE });
    writeFileSync(`${config}.backup-2026-10-18T13-00-00-000Z`, "not json");
    expect(putClaudeDesktopBack(mainJs, env).put_back).toBe("NO");
    expect(readFileSync(config, "utf8")).toBe(before);
    expect(putClaudeDesktopBack(mainJs, {})).toMatchObject({ put_back: "NO", detail: expect.stringContaining("0 Claude Desktop config files") });
  });

  it("picks the first backup, newest first, whose entry runs another engine, whatever the case of the path", () => {
    const backups = [
      { name: "c", text: "{" },
      { name: "b", text: json({ "lrc-avg": { command: "node", args: [mainJs.toUpperCase()] } }) },
      { name: "a", text: json({ "lrc-avg": USUAL }) },
    ];
    expect(entryBefore(backups, mainJs)).toEqual({ backup: "a", entry: USUAL });
    expect(entryBefore([], mainJs)).toBeUndefined();
  });
});
