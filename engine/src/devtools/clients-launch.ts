// How the client probe (engine\tests\probe\, `npm run clients:probe`) and the client check
// (`npm run clients:check`) start each installed AI client headless against the built engine
// (ISSUE155_PLAN R5/R6). General MCP compatibility (decision D1): nothing here changes what the
// engine does; it only starts clients. A client that is not installed is "not run", never a failure.
// The MCP server is named "lrc-avg"; Codex and Hermes key it "lrc_avg" (a TOML dotted key and a YAML
// key without the dash) [inference]. The flags below come from each client's own help, saved in
// docs\reports\phase8.5\clients-probe\ (2026-10-15); Antigravity's (`agy`) are [unverified]: it was not
// installed when this was written.

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { engineEntry } from "../setup/desktop-config.js";

export type ClientId = "claude-code" | "opencode" | "hermes" | "antigravity" | "codex";
export const CLIENT_IDS: readonly ClientId[] = ["claude-code", "opencode", "hermes", "antigravity", "codex"];
/** setup's engineEntry shape, with env always set. */
export type McpEntry = { command: string; args: string[]; env: Record<string, string> };
export type Launch = { file: string; args: string[]; env: NodeJS.ProcessEnv; shell: boolean; cwd: string; stdin?: string };

/**
 * Models the probe names (plan R5); the other clients use their defaults. OpenCode: an OpenAI model
 * with image input and tool calls through OpenRouter [handle: docs\reports\phase8.5\clients-probe\
 * opencode-models-openrouter.tsv, the openrouter/openai/gpt-6-luna line: image=true toolcall=true].
 * Hermes: a fourth family (Mistral) with both [handle: same file, openrouter/mistralai/mistral-large-4-0].
 */
export const MODELS: Partial<Record<ClientId, string>> = {
  opencode: "openrouter/openai/gpt-6-luna",
  hermes: "mistralai/mistral-large-4-0",
};

const ENV_KEYS = ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP"];

/**
 * The environment the engine gets from a client entry. Some clients pass a server only its entry's
 * env plus a filtered set (Hermes: tools\mcp_tool_config.py:147-192 under %LOCALAPPDATA%\hermes\
 * hermes-agent, `_build_safe_env`) [inference: others may pass less]; without SystemRoot and PATH the
 * engine may not start on Windows [inference]. Names are matched without case, as Windows does.
 */
export function baseEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ENV_KEYS) {
    const found = Object.keys(process.env).find((k) => k.toUpperCase() === key.toUpperCase());
    const value = found === undefined ? undefined : process.env[found];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The repo's built engine: engine\dist\mcp\main.js (the same path from src\devtools and dist\devtools). */
export const ENGINE_MAIN = fileURLToPath(new URL("../../dist/mcp/main.js", import.meta.url));

/** The entry that runs the built engine with this Node and env { ...baseEnv(), ...extra }. */
export function clientEntry(extra: Record<string, string>): McpEntry {
  const env = { ...baseEnv(), ...extra };
  const e = engineEntry(ENGINE_MAIN, process.execPath, env);
  return { command: e.command, args: e.args, env };
}

/** The first file named `name` (with each PATHEXT extension) on PATH, else null. */
function onPath(name: string): string | null {
  const exts = ["", ...(process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)];
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = path.join(dir, name + ext.toLowerCase());
      if (existsSync(file)) return file;
    }
  }
  return null;
}

let npmRoot: string | null | undefined;
/** `npm root -g`, once; null when npm is missing. */
function globalModules(): string | null {
  if (npmRoot === undefined) {
    try {
      npmRoot = execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      npmRoot = null;
    }
  }
  return npmRoot;
}

const existing = (file: string | null): string | null => (file !== null && existsSync(file) ? file : null);

/**
 * The client's real executable, or null (not installed: "not run"). The npm shims (opencode.ps1,
 * codex.ps1) are skipped for the exe they start, so no shell is needed [handle: Claude Code,
 * 2026-10-15, `Get-Command opencode, codex` -> ...\npm\opencode.ps1, codex.ps1; the exes found under
 * `npm root -g`]. Hermes ships only hermes.cmd [handle: same run, %LOCALAPPDATA%\hermes\bin\hermes.cmd].
 */
export function findClient(id: ClientId): string | null {
  const npm = globalModules();
  switch (id) {
    case "claude-code":
      return existing(path.join(os.homedir(), ".local", "bin", "claude.exe")) ?? onPath("claude");
    case "opencode":
      return npm ? existing(path.join(npm, "opencode-ai", "bin", "opencode.exe")) : null;
    case "codex":
      return npm ? existing(path.join(npm, "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe")) : null;
    case "hermes":
      return existing(process.env["LOCALAPPDATA"] ? path.join(process.env["LOCALAPPDATA"], "hermes", "bin", "hermes.cmd") : null) ?? onPath("hermes");
    case "antigravity":
      return onPath("agy");
  }
}

/** The client's own environment without Claude Code's markers, so a nested `claude` does not think it runs inside this session [inference]. */
function clientEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of Object.keys(env)) if (k === "CLAUDECODE" || k.startsWith("CLAUDE_CODE_")) delete env[k];
  return env;
}

/** A TOML value for Codex's `-c key=value`: JSON strings and string arrays are TOML too; env as an inline table. */
const toml = (v: string | string[] | Record<string, string>): string =>
  typeof v === "string" || Array.isArray(v) ? JSON.stringify(v) : `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)} = ${JSON.stringify(x)}`).join(", ")} }`;

/** One argument for cmd.exe (Hermes runs through hermes.cmd, so shell: true). */
// ponytail: the probe's prompt is plain text; cmd metacharacters and quotes are dropped, not escaped.
const cmdArg = (s: string): string => `"${s.replace(/[\r\n]+/g, " ").replace(/["%^&|<>]/g, "")}"`;

/** The per-run Claude Code MCP config (clients-config.ts register writes it). */
export const claudeCodeConfig = (runDir: string): string => path.join(runDir, "claude-code.json");

export function launchFor(id: ClientId, o: { exe: string; prompt: string; entry: McpEntry; runDir: string }): Launch {
  const { exe, prompt, entry, runDir } = o;
  switch (id) {
    // -p, --output-format stream-json (with --verbose), --strict-mcp-config, --mcp-config, --allowedTools
    // [handle: docs\reports\phase8.5\clients-probe\claude-help.txt:23,132,145,170,229,259]; prompt on stdin [inference].
    case "claude-code":
      return { file: exe, args: ["-p", "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--mcp-config", claudeCodeConfig(runDir), "--allowedTools", "mcp__lrc-avg"], env: clientEnv(), shell: false, cwd: runDir, stdin: prompt };
    // run --format json --auto -m [handle: opencode-run-help.txt in the same folder]; the server comes from
    // OPENCODE_CONFIG_CONTENT, so Jim's opencode.jsonc is untouched [unverified: https://opencode.ai/docs/config/];
    // the mcp entry shape {type: "local", command: [...], environment} [handle: https://opencode.ai/docs/mcp-servers/].
    case "opencode": {
      const config = { mcp: { "lrc-avg": { type: "local", command: [entry.command, ...entry.args], environment: entry.env, enabled: true } } };
      return { file: exe, args: ["run", "--format", "json", "--auto", "-m", MODELS.opencode ?? "", prompt], env: clientEnv({ OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }), shell: false, cwd: runDir };
    }
    // exec --json --ephemeral --skip-git-repo-check -C, `-c` values parsed as TOML, `-` reads stdin
    // [handle: codex-exec-help.txt:13-21,69,81,84,102]. tool_timeout_sec [handle: https://learn.chatgpt.com/docs/extend/mcp?surface=cli];
    // default_tools_approval_mode [unverified].
    case "codex": {
      const key = "mcp_servers.lrc_avg";
      const c = [`${key}.command=${toml(entry.command)}`, `${key}.args=${toml(entry.args)}`, `${key}.env=${toml(entry.env)}`, `${key}.tool_timeout_sec=60`, `${key}.default_tools_approval_mode="auto"`];
      return { file: exe, args: ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-C", runDir, ...c.flatMap((x) => ["-c", x]), "-"], env: clientEnv(), shell: false, cwd: runDir, stdin: prompt };
    }
    // -z (one-shot, approvals bypassed), -m, --provider, --ignore-rules, --usage-file [handle: hermes-help.txt:112-130,168].
    case "hermes":
      return { file: cmdArg(exe), args: ["-z", cmdArg(prompt), "-m", cmdArg(MODELS.hermes ?? ""), "--provider", "openrouter", "--ignore-rules", "--usage-file", cmdArg(path.join(runDir, "hermes-usage.json"))], env: clientEnv(), shell: true, cwd: runDir };
    // -p, --output-format json, --dangerously-skip-permissions [unverified: agy was not installed]; the
    // workspace config <runDir>\.agents\mcp_config.json is read from the cwd [unverified].
    case "antigravity":
      return { file: exe, args: ["-p", prompt, "--output-format", "json", "--dangerously-skip-permissions"], env: clientEnv(), shell: false, cwd: runDir };
  }
}
