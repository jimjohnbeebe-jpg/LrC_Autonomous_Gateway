// Registering the engine in Claude Desktop's config, so nobody edits JSON by hand (rule 04).
// Generalised from spikes\S3\install-desktop-config.ts. This module holds the pure parts the tests
// cover; apply-config.ts does the file work for both commands:
//   - `lrc-avg-setup` (setup-cli.ts, PHASE6_PLAN decision 2): this Node (process.execPath) running the
//     installed dist\mcp\main.js, no env, so the tool log goes to its default folder;
//   - `npm run desktop:install` (devtools\install-desktop-config-cli.ts): the repo's engine\dist, with
//     LRC_AVG_LOG_DIR set to the repo's logs\ folder (the dev default of PRD section 6.2).
// The S3 test server "lrc-avg-spike-s3" is removed (the Phase 1/2 set-up item in PHASES.md). Every
// other server is left exactly as it is.
//
// Where the config lives on Windows (three layouts seen so far; Claude Desktop moved on 2026-10-16):
//   1. %LOCALAPPDATA%\Claude-Data\claude_<id>\claude_desktop_config.json: where Jim's Microsoft Store build
//      (package family Claude_pzs8sxrjxfjjc, 2.42304.0.0) reads and wrote its config on 2026-10-16
//      [handle: vault PHASE9_PLAN.md "Found" 1; Get-ChildItem -Filter 'claude_desktop_config*.json' over
//      %APPDATA% and %LOCALAPPDATA%, 2026-10-17]
//   2. %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json: the older
//      Microsoft Store (MSIX) location [handle: docs\reports\phase0\S3.md "Steps 2-3"]. That folder now holds
//      only an empty ".user-data-left.claude_pzs8sxrjxfjjc", written 3 s before the layout-1 config [handle:
//      same listing as 1]; that the marker means "the data moved" is [inference], so a folder holding a
//      ".user-data-left.*" file is skipped, config or not
//   3. %APPDATA%\Claude\claude_desktop_config.json: the classic install [unverified on this machine: absent there]
// A folder that holds a config file wins over one that does not (apply-config.ts). Whether a fresh Windows
// account has the folder but not the file after Claude Desktop's first start is [unverified] (PHASE6_PLAN
// row 1, decision D1; the AC-6 run shows it).

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SERVER_NAME = "lrc-avg";
export const RETIRED_SERVERS = ["lrc-avg-spike-s3"] as const;
export const CONFIG_FILE = "claude_desktop_config.json";
/** An empty file Claude Desktop leaves in a data folder it moved away from [inference] (see the layouts above). */
const LEFT_MARKER = ".user-data-left.";

export const desktopConfigSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});
export type DesktopConfig = z.infer<typeof desktopConfigSchema>;

export type ServerEntry = { command: string; args: string[]; env?: Record<string, string> };

/** The entry that runs the engine's `mainJs` with the Node at `nodePath`. */
export function engineEntry(mainJs: string, nodePath: string, env?: Record<string, string>): ServerEntry {
  return env ? { command: nodePath, args: [mainJs], env } : { command: nodePath, args: [mainJs] };
}

export type ConfigPlan = {
  updated: DesktopConfig;
  added: boolean;
  updatedEntry: boolean;
  /** Servers taken out: the retired ones, and "lrc-avg" itself for a removal. */
  removed: string[];
  /** Nothing to change. */
  unchanged: boolean;
};

/** What the config becomes: the engine entry set (or, with `entry` null, removed), the retired servers gone, the rest untouched. */
export function planConfig(config: DesktopConfig, entry: ServerEntry | null): ConfigPlan {
  const servers: Record<string, unknown> = { ...(config.mcpServers ?? {}) };
  const existing = servers[SERVER_NAME];
  const same = entry !== null && JSON.stringify(existing) === JSON.stringify(entry);
  const names: string[] = entry === null ? [SERVER_NAME, ...RETIRED_SERVERS] : [...RETIRED_SERVERS];
  const removed = names.filter((name) => name in servers);
  for (const name of removed) delete servers[name];
  if (entry !== null) servers[SERVER_NAME] = entry;
  return {
    updated: { ...config, mcpServers: servers },
    added: entry !== null && existing === undefined,
    updatedEntry: entry !== null && existing !== undefined && !same,
    removed,
    unchanged: (entry === null || same) && removed.length === 0,
  };
}


/** The names of the folders inside `dir` that start with `prefix` (any letter case); empty when `dir` cannot be read. */
function subfolders(dir: string, prefix: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.toLowerCase().startsWith(prefix))
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

function hasLeftMarker(folder: string): boolean {
  try {
    return readdirSync(folder).some((name) => name.startsWith(LEFT_MARKER));
  } catch {
    return false;
  }
}

/**
 * Every Claude Desktop data folder that exists, newest layout first: Claude-Data, the MSIX Packages
 * folder (skipped when it holds a ".user-data-left.*" marker), then the classic location.
 */
export function findClaudeFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const found: string[] = [];
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData) {
    found.push(...subfolders(path.join(localAppData, "Claude-Data"), "claude_"));
    for (const pkg of subfolders(path.join(localAppData, "Packages"), "claude_")) {
      const candidate = path.join(pkg, "LocalCache", "Roaming", "Claude");
      if (existsSync(candidate) && !hasLeftMarker(candidate)) found.push(candidate);
    }
  }
  const appData = env["APPDATA"];
  if (appData) {
    const candidate = path.join(appData, "Claude");
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
}

/** Every Claude Desktop config file found, in the order of findClaudeFolders. */
export function findDesktopConfigs(env: NodeJS.ProcessEnv = process.env): string[] {
  return findClaudeFolders(env)
    .map((folder) => path.join(folder, CONFIG_FILE))
    .filter((file) => existsSync(file));
}
