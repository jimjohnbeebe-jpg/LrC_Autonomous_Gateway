// AVG-S3: add the "lrc-avg-spike-s3" MCP server to Claude Desktop's config, so Jim does not
// edit JSON by hand.
//
// Run (PowerShell, repo root):   node spikes\S3\install-desktop-config.ts
// Options (for testing only):    --config <path>   use this config file instead of searching
//                                --dry-run         show what would change, write nothing
//
// Where the config lives on Windows:
//   Microsoft Store (MSIX) install: %LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\Roaming\Claude\claude_desktop_config.json
//     [handle: Jim's machine, %LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\...\claude_desktop_config.json, docs\MCP_AVAILABILITY.md §2]
//   Classic install: %APPDATA%\Claude\claude_desktop_config.json [unverified on this machine: absent there]
// Behaviour: validates the file, writes a timestamped backup next to it before changing
// anything, adds or updates only the one entry, and leaves every other server untouched.
// Running it twice changes nothing the second time. It prints server names only, never
// env values (another server's env holds a GitHub token).

import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const SERVER_NAME = "lrc-avg-spike-s3";
const serverScript = path.join(path.dirname(fileURLToPath(import.meta.url)), "server.ts");
const wanted = { command: process.execPath, args: [serverScript] };

const configSchema = z.looseObject({
  mcpServers: z.record(z.string(), z.unknown()).optional(),
});

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const configIdx = argv.indexOf("--config");
const explicitConfig = configIdx >= 0 ? argv[configIdx + 1] : undefined;

function findConfigs(): string[] {
  const found: string[] = [];
  const localAppData = process.env["LOCALAPPDATA"];
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
  const appData = process.env["APPDATA"];
  if (appData) {
    const candidate = path.join(appData, "Claude", "claude_desktop_config.json");
    if (existsSync(candidate)) found.push(candidate);
  }
  return found;
}

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  console.error("Nothing was changed. Tell Claude Code what this says.");
  process.exit(1);
}

let configPath: string;
if (explicitConfig) {
  configPath = path.resolve(explicitConfig);
  if (!existsSync(configPath)) fail(`config file not found: ${configPath}`);
} else {
  const found = findConfigs();
  if (found.length === 0) fail("could not find Claude Desktop's claude_desktop_config.json. Open Claude Desktop once, then run this again.");
  if (found.length > 1) {
    console.log(`Found ${found.length} Claude Desktop config files; using the Microsoft Store one (listed first):`);
    for (const f of found) console.log(`  ${f}`);
  }
  configPath = found[0] as string;
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
} catch (err) {
  fail(`the config file is not valid JSON (${String((err as Error).message)}); it was left as it is.`);
}
const parsed = configSchema.safeParse(raw);
if (!parsed.success) fail(`the config file has an unexpected shape; it was left as it is. (${parsed.error.issues[0]?.message ?? "invalid"})`);
const config = parsed.data;
const servers: Record<string, unknown> = { ...(config.mcpServers ?? {}) };

const existing = servers[SERVER_NAME];
const same = JSON.stringify(existing) === JSON.stringify(wanted);
console.log(`Claude Desktop config: ${configPath}`);
console.log(`MCP servers already configured: ${Object.keys(servers).join(", ") || "(none)"}`);

if (same) {
  console.log(`"${SERVER_NAME}" is already set up. Nothing changed.`);
  console.log("Next: quit Claude Desktop completely (tray icon > Quit) and start it again.");
  process.exit(0);
}

servers[SERVER_NAME] = wanted;
const updated = { ...config, mcpServers: servers };

if (dryRun) {
  console.log(`--dry-run: would ${existing === undefined ? "add" : "update"} "${SERVER_NAME}" -> ${wanted.command} ${wanted.args.join(" ")}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${configPath}.backup-${stamp}`;
copyFileSync(configPath, backup);
writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n");

// Read back what was written, so a bad write cannot go unnoticed.
const check = configSchema.safeParse(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
const written = check.success ? check.data.mcpServers?.[SERVER_NAME] : undefined;
if (JSON.stringify(written) !== JSON.stringify(wanted)) {
  copyFileSync(backup, configPath);
  fail("the entry did not read back correctly; the original config was restored from the backup.");
}

console.log(`${existing === undefined ? "Added" : "Updated"} "${SERVER_NAME}" (backup of the old file: ${path.basename(backup)}).`);
console.log("Next: quit Claude Desktop completely (tray icon > Quit) and start it again.");
