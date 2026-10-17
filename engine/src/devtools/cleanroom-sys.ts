// The clean room's view of this Windows account (vault PHASE9_PLAN.md D9.1): the paths it parks and
// checks, and the outside world it touches (the registry, the process list, the Claude Code CLI, the
// uninstallers and installers). Everything outside is behind `Sys`, so the tests run on temp folders
// with fakes and never touch the real registry, processes or configs.

import { execFileSync, spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { exeVersion } from "./clients-deck.js";
import { defaultConfigPaths } from "./clients-config.js";

export type UninstallKey = { key: string; displayName: string; installLocation: string | null; uninstallString: string | null; mainBinary: string | null };
export type Proc = { name: string; path: string | null };

export type Sys = {
  env: NodeJS.ProcessEnv;
  home: string;
  repo: string;
  /** HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall, every subkey. */
  uninstallKeys(): UninstallKey[];
  processes(): Proc[];
  /** The Claude Code CLI (`claude …`), for its user-scope MCP entries. */
  claude(args: string[]): { status: number | null; output: string };
  /** Runs an exe and waits for it; the exit code (null: did not start or timed out). */
  run(exe: string, args: string[]): number | null;
  exeVersion(exe: string): string | null;
  sleep(ms: number): Promise<void>;
  now(): Date;
};

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const UNINSTALL = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

/** The engine's data folder as the Microsoft Store Claude Desktop redirects it, one per Claude package. */
function storeData(local: string): string[] {
  try {
    return readdirSync(path.join(local, "Packages"))
      .filter((n) => n.toLowerCase().startsWith("claude_"))
      .map((n) => path.join(local, "Packages", n, "LocalCache", "Local", "LrC-AVG"));
  } catch {
    return [];
  }
}

/** Every place the clean room parks or checks. */
export function pathsOf(sys: Sys) {
  const local = sys.env["LOCALAPPDATA"] ?? path.join(sys.home, "AppData", "Local");
  const appData = sys.env["APPDATA"] ?? path.join(sys.home, "AppData", "Roaming");
  const temp = sys.env["TEMP"] ?? os.tmpdir();
  const install = path.join(local, "LrC-AVG");
  return {
    parkDir: path.join(temp, "LrC-AVG-cleanroom"),
    parkFile: path.join(temp, "LrC-AVG-cleanroom", "park.json"),
    resultsDir: path.join(temp, "LrC-AVG", "cleanroom"),
    /** The product's (and the 1.0.0 Deck's) per-user install folder, which also holds the data. */
    install,
    /** The Deck before 1.0.0 (Deck 0.3.x, "LrC-AVG HUD"). */
    oldDeck: path.join(local, "LrC-AVG HUD"),
    tempData: path.join(temp, "LrC-AVG"),
    /**
     * The data folders parked, and checked by --verify-gone --expect-data-gone; the com.lrcavg.desktop two are the
     * WebView2 data of that identifier [handle: vault PHASE9_PLAN.md "Found" 5, installer.nsi:871-884]; ~\.lrc-avg
     * holds the bridge token and ports (engine\src\bridge\endpoint.ts) and hud_endpoint.json (engine\src\hud\channel.ts);
     * the Microsoft Store Claude Desktop redirects the engine's %LOCALAPPDATA%\LrC-AVG into its package [handle: Jim's
     * run 1, 2026-10-17: last-start.json and logs\ in Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\LrC-AVG\].
     */
    dataFolders: [install, path.join(temp, "LrC-AVG"), path.join(local, "com.lrcavg.desktop"), path.join(appData, "com.lrcavg.desktop"), path.join(sys.home, ".lrc-avg"), ...storeData(local)],
    modules: path.join(appData, "Adobe", "Lightroom", "Modules"),
    prefs: path.join(appData, "Adobe", "Lightroom", "Preferences"),
    startMenu: path.join(appData, "Microsoft", "Windows", "Start Menu", "Programs"),
    desktop: path.join(sys.home, "Desktop"),
    claudeJson: path.join(sys.home, ".claude.json"),
    opencode: path.join(sys.home, ".config", "opencode", "opencode.jsonc"),
    hermes: defaultConfigPaths({ ...sys.env, LOCALAPPDATA: local }).hermes,
    antigravity: path.join(sys.home, ".gemini", "config", "mcp_config.json"),
  };
}
export type Paths = ReturnType<typeof pathsOf>;

/**
 * `reg query <key> /s` output: a line starting with HKEY_ opens a subkey, "    Name    REG_SZ    Value" lines
 * follow [handle: `reg query HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall /s /f LrC-AVG`, run by
 * Claude Code 2026-10-17: key "LrC-AVG HUD" with MainBinaryName, DisplayName, InstallLocation, UninstallString].
 */
export function parseRegQuery(text: string): UninstallKey[] {
  const keys: UninstallKey[] = [];
  let cur: Record<string, string> | null = null;
  let name = "";
  const flush = () => {
    if (cur?.["DisplayName"]) keys.push({ key: name, displayName: cur["DisplayName"], installLocation: unquote(cur["InstallLocation"]), uninstallString: unquote(cur["UninstallString"]), mainBinary: cur["MainBinaryName"] ?? null });
  };
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("HKEY_")) {
      flush();
      cur = {};
      name = line.trim();
      continue;
    }
    const m = /^\s+(\S.*?)\s{4}REG_\w+\s{4}(.*)$/.exec(line);
    if (m && cur) cur[m[1] as string] = m[2] as string;
  }
  flush();
  return keys;
}

const unquote = (s: string | undefined): string | null => (s === undefined || s === "" ? null : s.replace(/^"(.*)"$/, "$1"));

const procSchema = z.object({ Name: z.string(), Path: z.string().nullable().optional() });

function realProcesses(): Proc[] {
  const ps = "Get-Process | Select-Object Name,Path | ConvertTo-Json -Compress";
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  const raw = JSON.parse(out) as unknown;
  return z.array(procSchema).parse(Array.isArray(raw) ? raw : [raw]).map((p) => ({ name: p.Name, path: p.Path ?? null }));
}

export function realSys(): Sys {
  return {
    env: process.env,
    home: os.homedir(),
    repo: REPO,
    uninstallKeys: () => parseRegQuery(execFileSync("reg", ["query", UNINSTALL, "/s"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })),
    processes: realProcesses,
    claude: (args) => {
      const r = spawnSync("claude", args, { encoding: "utf8", timeout: 60_000 });
      return { status: r.status, output: `${r.stdout ?? ""}${r.stderr ?? ""}${r.error ? r.error.message : ""}`.trim() };
    },
    run: (exe, args) => spawnSync(exe, args, { stdio: "ignore", timeout: 180_000 }).status,
    exeVersion,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}

/**
 * What must be quit first: Lightroom (Lightroom.exe) and Claude Desktop, told apart from Claude Code
 * by its path under \WindowsApps\Claude_; both processes are named "claude" [handle: vault PHASE9_PLAN.md
 * "Found" 7]. Lightroom's process name "Lightroom" is [unverified: Lightroom was not running in this session].
 */
export function blockers(sys: Sys): string[] {
  const procs = sys.processes();
  const out: string[] = [];
  if (procs.some((p) => p.name.toLowerCase() === "lightroom")) out.push("Lightroom Classic");
  if (procs.some((p) => (p.path ?? "").toLowerCase().includes("\\windowsapps\\claude_"))) out.push("Claude Desktop (right-click the Claude icon in the system tray > Quit)");
  return out;
}
