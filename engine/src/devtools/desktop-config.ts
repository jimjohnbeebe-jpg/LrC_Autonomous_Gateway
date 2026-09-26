// Registering the engine in Claude Desktop's config, so Jim does not edit JSON by hand (rule 04).
// Generalised from spikes\S3\install-desktop-config.ts. This module holds the parts the tests cover;
// install-desktop-config-cli.ts (`npm run desktop:install`) does the file work.
//
// The entry added: "lrc-avg" -> this Node (process.execPath) running engine\dist\mcp\main.js, with
// LRC_AVG_LOG_DIR set to the repo's logs\ folder (the dev default of PRD section 6.2), so the Phase 2
// chat's tool log lands where the check collects it. The S3 test server "lrc-avg-spike-s3" is removed
// (the Phase 1/2 set-up item in PHASES.md). Every other server is left exactly as it is.
//
// Where the config lives on Windows:
//   Microsoft Store (MSIX) install: %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json
//     [handle: docs\reports\phase0\S3.md "Steps 2-3"; Jim's machine has Claude_pzs8sxrjxfjjc]
//   Classic install: %APPDATA%\Claude\claude_desktop_config.json [unverified on this machine: absent there]

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const SERVER_NAME = "lrc-avg";
export const RETIRED_SERVERS = ["lrc-avg-spike-s3"] as const;

export const desktopConfigSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});
export type DesktopConfig = z.infer<typeof desktopConfigSchema>;

export type ServerEntry = { command: string; args: string[]; env: Record<string, string> };

/** The entry for the engine in the repo at `repoRoot`, run by the Node at `nodePath`. */
export function engineEntry(repoRoot: string, nodePath: string): ServerEntry {
  return {
    command: nodePath,
    args: [path.join(repoRoot, "engine", "dist", "mcp", "main.js")],
    env: { LRC_AVG_LOG_DIR: path.join(repoRoot, "logs") },
  };
}

export type ConfigPlan = {
  updated: DesktopConfig;
  added: boolean;
  updatedEntry: boolean;
  removed: string[];
  /** Nothing to change: the entry is there as wanted and no retired server is left. */
  unchanged: boolean;
};

/** What the config becomes: the engine entry set, the retired servers gone, the rest untouched. */
export function planConfig(config: DesktopConfig, entry: ServerEntry): ConfigPlan {
  const servers: Record<string, unknown> = { ...(config.mcpServers ?? {}) };
  const existing = servers[SERVER_NAME];
  const same = JSON.stringify(existing) === JSON.stringify(entry);
  const removed = RETIRED_SERVERS.filter((name) => name in servers);
  for (const name of removed) delete servers[name];
  servers[SERVER_NAME] = entry;
  return {
    updated: { ...config, mcpServers: servers },
    added: existing === undefined,
    updatedEntry: existing !== undefined && !same,
    removed,
    unchanged: same && removed.length === 0,
  };
}

/** Every Claude Desktop config file found (MSIX first, then the classic location). */
export function findDesktopConfigs(env: NodeJS.ProcessEnv = process.env): string[] {
  const found: string[] = [];
  const localAppData = env["LOCALAPPDATA"];
  if (localAppData) {
    const packages = path.join(localAppData, "Packages");
    if (existsSync(packages)) {
      for (const dir of readdirSync(packages)) {
        if (!dir.startsWith("Claude_")) continue;
        const candidate = path.join(packages, dir, "LocalCache", "Roaming", "Claude", "claude_desktop_config.json");
        if (existsSync(candidate)) found.push(candidate);
      }
    }
  }
  const appData = env["APPDATA"];
  if (appData) {
    const candidate = path.join(appData, "Claude", "claude_desktop_config.json");
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
}
