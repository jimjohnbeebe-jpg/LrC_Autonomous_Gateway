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
// Where the config lives on Windows:
//   Microsoft Store (MSIX) install: %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json
//     [handle: docs\reports\phase0\S3.md "Steps 2-3"; Jim's machine has Claude_pzs8sxrjxfjjc]
//   Classic install: %APPDATA%\Claude\claude_desktop_config.json [unverified on this machine: absent there]
// Whether a fresh Windows account has the folder, but not the file, after Claude Desktop's first
// start is [unverified] (PHASE6_PLAN row 1, decision D1; the AC-6 run in row 3 shows it).

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SERVER_NAME = "lrc-avg";
export const RETIRED_SERVERS = ["lrc-avg-spike-s3"] as const;
export const CONFIG_FILE = "claude_desktop_config.json";

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

/** Every Claude Desktop data folder that exists (MSIX first, then the classic location). */
export function findClaudeFolders(env: NodeJS.ProcessEnv = process.env): string[] {
  const found: string[] = [];
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData) {
    const packages = path.join(localAppData, "Packages");
    if (existsSync(packages)) {
      for (const dir of readdirSync(packages)) {
        if (!dir.startsWith("Claude_")) continue;
        const candidate = path.join(packages, dir, "LocalCache", "Roaming", "Claude");
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  }
  const appData = env["APPDATA"];
  if (appData) {
    const candidate = path.join(appData, "Claude");
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
}

/** Every Claude Desktop config file found (MSIX first, then the classic location). */
export function findDesktopConfigs(env: NodeJS.ProcessEnv = process.env): string[] {
  return findClaudeFolders(env)
    .map((folder) => path.join(folder, CONFIG_FILE))
    .filter((file) => existsSync(file));
}
