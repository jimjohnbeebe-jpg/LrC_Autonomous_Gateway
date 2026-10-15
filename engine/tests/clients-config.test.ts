// clients-config.ts on temp files only (never Jim's real configs): the Hermes append and its guard,
// the refusal of a file that already has mcp_servers, the sha256-checked restore, the repair of a
// stopped run, and the per-run configs that touch nothing of Jim's.

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hermesRefused, register, restore, restoreLeftovers, type ConfigPaths } from "../src/devtools/clients-config.js";
import { baseEnv, clientEntry, launchFor } from "../src/devtools/clients-launch.js";

let tmp: string;
let paths: ConfigPaths;
let runDir: string;
const entry = { command: "C:\\node\\node.exe", args: ["C:\\repo\\engine\\dist\\mcp\\main.js"], env: { LRC_AVG_LOG_DIR: "C:\\x y\\logs" } };
const sha = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

beforeEach(() => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "clients-config-"));
  paths = { hermes: path.join(tmp, "hermes.yaml"), antigravity: path.join(tmp, "mcp_config.json") };
  runDir = path.join(tmp, "run");
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("Hermes", () => {
  it("appends one mcp_servers block, keeps the file's line ends, and restores the exact bytes", () => {
    writeFileSync(paths.hermes, "model:\r\n  default: x/y\r\n");
    const before = sha(paths.hermes);
    expect(hermesRefused(paths.hermes)).toBe(false);
    expect(hermesRefused(path.join(tmp, "missing.yaml"))).toBe(false);
    const reg = register("hermes", entry, runDir, { paths });
    expect(reg?.method).toBe("append");
    const text = readFileSync(paths.hermes, "utf8");
    expect(text.match(/^mcp_servers\s*:/gm)).toHaveLength(1);
    expect(text).toContain('\r\nmcp_servers:\r\n  lrc_avg: {"command":"C:\\\\node\\\\node.exe"');
    expect(reg?.sha256).toBe(before);
    restore(reg!);
    expect(sha(paths.hermes)).toBe(before);
    expect(restoreLeftovers(runDir)).toEqual([]);
  });

  it("refuses a file that already has mcp_servers and leaves it as it is", () => {
    writeFileSync(paths.hermes, "model: a\nmcp_servers:\n  other: {}\n");
    const before = sha(paths.hermes);
    const reg = register("hermes", entry, runDir, { paths });
    expect(reg?.method).toBe("refused");
    expect(hermesRefused(paths.hermes)).toBe(true); // clients:check skips Hermes on this
    expect(sha(paths.hermes)).toBe(before);
    restore(reg!);
    expect(restoreLeftovers(runDir)).toEqual([]);
  });

  it("restore fails loudly when the bytes do not check out", () => {
    writeFileSync(paths.hermes, "model: a\n");
    const reg = register("hermes", entry, runDir, { paths })!;
    writeFileSync(reg.backup, "tampered\n");
    expect(() => restore(reg)).toThrow(/sha256/);
  });
});

describe("leftovers of a stopped run", () => {
  it("restores every file still listed, then lists none", () => {
    writeFileSync(paths.hermes, "model: a\n");
    writeFileSync(paths.antigravity, JSON.stringify({ mcpServers: { mine: { command: "x" } } }));
    const hermesBefore = sha(paths.hermes);
    const agyBefore = sha(paths.antigravity);
    register("hermes", entry, runDir, { paths });
    register("antigravity", entry, runDir, { paths, global: true });
    expect(JSON.parse(readFileSync(paths.antigravity, "utf8")).mcpServers["lrc-avg"]).toEqual(entry);
    const restored = restoreLeftovers(runDir);
    expect(restored.map((r) => r.method).sort()).toEqual(["append", "global"]);
    expect(sha(paths.hermes)).toBe(hermesBefore);
    expect(sha(paths.antigravity)).toBe(agyBefore);
    expect(restoreLeftovers(runDir)).toEqual([]);
  });
});

describe("a global Antigravity config that does not exist yet", () => {
  it("is created for the run and deleted again on restore", () => {
    const reg = register("antigravity", entry, runDir, { paths, global: true });
    expect(JSON.parse(readFileSync(paths.antigravity, "utf8")).mcpServers["lrc-avg"]).toEqual(entry);
    restore(reg!);
    expect(existsSync(paths.antigravity)).toBe(false);
    expect(restoreLeftovers(runDir)).toEqual([]);
  });
});

describe("per-run configs", () => {
  it("Antigravity's workspace config and Claude Code's file go into the run folder only", () => {
    const ws = register("antigravity", entry, runDir, { paths });
    expect(ws?.method).toBe("workspace");
    expect(JSON.parse(readFileSync(ws!.file, "utf8")).mcpServers["lrc-avg"]).toEqual(entry);
    expect(register("claude-code", entry, runDir, { paths })).toBeNull();
    expect(existsSync(path.join(runDir, "claude-code.json"))).toBe(true);
    expect(register("opencode", entry, runDir, { paths })).toBeNull();
    expect(existsSync(paths.antigravity)).toBe(false);
  });

  it("clientEntry runs the built engine with baseEnv under the extras; launchFor drops Claude Code's markers", () => {
    const e = clientEntry({ LRC_AVG_LOG_DIR: "L" });
    expect(e.command).toBe(process.execPath);
    expect(e.args[0]).toMatch(/engine[\\/]dist[\\/]mcp[\\/]main\.js$/);
    expect(e.env).toEqual({ ...baseEnv(), LRC_AVG_LOG_DIR: "L" });
    process.env["CLAUDE_CODE_PROBE_MARK"] = "1";
    try {
      const l = launchFor("claude-code", { exe: "claude.exe", prompt: "hi", entry: e, runDir });
      expect(l.env["CLAUDE_CODE_PROBE_MARK"]).toBeUndefined();
      expect(l.stdin).toBe("hi");
      const c = launchFor("codex", { exe: "codex.exe", prompt: "hi", entry: e, runDir });
      expect(c.args.some((a) => a.startsWith("mcp_servers.lrc_avg.env={ ") && a.includes('"LRC_AVG_LOG_DIR" = "L"'))).toBe(true);
    } finally {
      delete process.env["CLAUDE_CODE_PROBE_MARK"];
    }
  });
});
