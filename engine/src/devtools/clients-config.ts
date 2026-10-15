// Registering the engine in a client for one probe or check run (ISSUE155_PLAN R5/R6), and putting
// Jim's config back afterwards. Claude Code, OpenCode and Codex take a per-run config, so nothing of
// Jim's is edited (register returns null; clients-launch.ts passes the config). Hermes reads only its
// config.yaml `mcp_servers:` (tools\mcp_tool_config.py:638 under %LOCALAPPDATA%\hermes\hermes-agent),
// so its file is backed up byte for byte and one top-level block appended; a file that already has
// the key is refused, never given a second one. `hermes mcp add` is not used (interactive and
// discovery-first [unverified]). Antigravity first gets a workspace config in the run folder; the
// global ~/.gemini/config/mcp_config.json only when the probe saw no tool call from the workspace one.
// Every edit of Jim's files is listed in <runDir>\backup\registry.json until restored, so a stopped run
// is repaired by restoreLeftovers. Callers restore in `finally`.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { applyDesktopConfig } from "../setup/apply-config.js";
import { claudeCodeConfig, type ClientId, type McpEntry } from "./clients-launch.js";

export type Registration = { client: ClientId; method: "append" | "refused" | "workspace" | "global"; file: string; backup: string; sha256: string };

const registrationSchema = z.strictObject({
  client: z.enum(["claude-code", "opencode", "hermes", "antigravity", "codex"]),
  method: z.enum(["append", "refused", "workspace", "global"]),
  file: z.string(),
  backup: z.string(),
  sha256: z.string(),
});

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const registryOf = (runDir: string): string => path.join(runDir, "backup", "registry.json");

/** Where the config files live; the tests point them at temp files. */
export type ConfigPaths = { hermes: string; antigravity: string };
export function defaultConfigPaths(env: NodeJS.ProcessEnv = process.env): ConfigPaths {
  return {
    hermes: path.join(env["LOCALAPPDATA"] ?? path.join(os.homedir(), "AppData", "Local"), "hermes", "config.yaml"),
    antigravity: path.join(os.homedir(), ".gemini", "config", "mcp_config.json"),
  };
}

function readRegistry(runDir: string): Registration[] {
  const file = registryOf(runDir);
  if (!existsSync(file)) return [];
  return z.array(registrationSchema).parse(JSON.parse(readFileSync(file, "utf8")));
}

function writeRegistry(runDir: string, regs: Registration[]): void {
  const file = registryOf(runDir);
  if (regs.length === 0) rmSync(file, { force: true });
  else writeFileSync(file, JSON.stringify(regs, null, 2) + "\n");
}

/**
 * Byte copy of `file` into <runDir>\backup\, listed in the registry before anything is changed. A file
 * that does not exist gets sha256 "" and no backup file; restore deletes it again.
 */
function backUp(client: ClientId, method: Registration["method"], file: string, runDir: string, listed: boolean): Registration {
  const dir = path.join(runDir, "backup");
  mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, `${client}-${path.basename(file)}`);
  const bytes = existsSync(file) ? readFileSync(file) : null;
  if (bytes) writeFileSync(backup, bytes);
  const reg: Registration = { client, method, file, backup, sha256: bytes ? sha256(bytes) : "" };
  if (listed) writeRegistry(runDir, [...readRegistry(runDir).filter((r) => r.file !== file), reg]);
  return reg;
}

/** The YAML block for Hermes: JSON flow values are YAML too. Key "lrc_avg" (no dash) [inference]. */
function hermesBlock(entry: McpEntry, eol: string): string {
  const body = { command: entry.command, args: entry.args, env: entry.env };
  return `mcp_servers:${eol}  lrc_avg: ${JSON.stringify(body)}${eol}`;
}

function registerHermes(entry: McpEntry, runDir: string, file: string): Registration {
  const text = readFileSync(file, "utf8");
  if (/^mcp_servers\s*:/m.test(text)) return backUp("hermes", "refused", file, runDir, false);
  const reg = backUp("hermes", "append", file, runDir, true);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  writeFileSync(file, text + (text === "" || text.endsWith("\n") ? "" : eol) + hermesBlock(entry, eol));
  return reg;
}

function registerAntigravity(entry: McpEntry, runDir: string, global: boolean, file: string): Registration {
  if (!global) {
    const ws = path.join(runDir, ".agents", "mcp_config.json");
    mkdirSync(path.dirname(ws), { recursive: true });
    writeFileSync(ws, JSON.stringify({ mcpServers: { "lrc-avg": entry } }, null, 2) + "\n");
    return { client: "antigravity", method: "workspace", file: ws, backup: "", sha256: "" };
  }
  const reg = backUp("antigravity", "global", file, runDir, true);
  if (reg.sha256 === "") {
    // No global config yet; applyDesktopConfig refuses a configPath that does not exist (apply-config.ts locate).
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ mcpServers: { "lrc-avg": entry } }, null, 2) + "\n");
    return reg;
  }
  const result = applyDesktopConfig({ entry, configPath: file });
  // Our byte backup is the one restore uses; apply-config's own copy next to Jim's file is not needed.
  if (result.backup) rmSync(path.join(path.dirname(file), result.backup), { force: true });
  return reg;
}

/**
 * Register the engine for one run. null: a per-run config, nothing of Jim's edited (Claude Code's
 * file is written into runDir). Hermes "refused": its config already has `mcp_servers:`, left as is.
 */
export function register(id: ClientId, entry: McpEntry, runDir: string, o: { global?: boolean; paths?: ConfigPaths } = {}): Registration | null {
  const paths = o.paths ?? defaultConfigPaths();
  mkdirSync(runDir, { recursive: true });
  switch (id) {
    case "claude-code":
      writeFileSync(claudeCodeConfig(runDir), JSON.stringify({ mcpServers: { "lrc-avg": entry } }, null, 2) + "\n");
      return null;
    case "opencode":
    case "codex":
      return null;
    case "hermes":
      return registerHermes(entry, runDir, paths.hermes);
    case "antigravity":
      return registerAntigravity(entry, runDir, o.global === true, paths.antigravity);
  }
}

/** Put the backed-up bytes back and check them; a refused or workspace registration changed nothing of Jim's. */
export function restore(r: Registration): void {
  if (r.method === "refused" || r.method === "workspace") return;
  if (r.sha256 === "") rmSync(r.file, { force: true });
  else {
    copyFileSync(r.backup, r.file);
    const now = sha256(readFileSync(r.file));
    if (now !== r.sha256) throw new Error(`restoring ${r.file} from ${r.backup}: sha256 ${now}, expected ${r.sha256}`);
  }
  const runDir = path.dirname(path.dirname(r.backup));
  writeRegistry(runDir, readRegistry(runDir).filter((x) => x.file !== r.file));
}

/** Restore what a stopped run left listed in <runDir>\backup\registry.json; returns what was restored. */
// ponytail: restores the backup even if Jim changed the file after the stopped run; a stopped run is rare.
export function restoreLeftovers(runDir: string): Registration[] {
  const left = readRegistry(runDir);
  for (const r of left) restore(r);
  return left;
}
