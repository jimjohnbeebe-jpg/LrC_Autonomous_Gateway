// `npm run desktop:install`: add the engine to Claude Desktop's config as "lrc-avg" and remove the S3
// test server (the rules are in desktop-config.ts). Run from the repo root.
// Options (for Claude Code's testing only): --config <path> uses that file; --dry-run writes nothing.
// Behaviour, as in the S3 installer: validates the file, writes a timestamped backup next to it
// before changing anything, reads the result back (and restores the backup if it does not match),
// and changes nothing the second time. It prints server names only, never env values (another
// server's env holds a token).

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { desktopConfigSchema, engineEntry, findDesktopConfigs, planConfig, SERVER_NAME } from "./desktop-config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const configIdx = argv.indexOf("--config");
const explicitConfig = configIdx >= 0 ? argv[configIdx + 1] : undefined;
const RESTART = "Next: quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit), then run the Phase 2 check.";

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  console.error("Nothing was changed. Tell Claude Code what this says.");
  process.exit(1);
}

const entry = engineEntry(repoRoot, process.execPath);
if (!existsSync(entry.args[0] as string)) fail(`the engine is not built (${entry.args[0]} is missing); run npm run build first.`);

let configPath: string;
if (explicitConfig) {
  configPath = path.resolve(explicitConfig);
  if (!existsSync(configPath)) fail(`config file not found: ${configPath}`);
} else {
  const found = findDesktopConfigs();
  if (found.length === 0) fail("could not find Claude Desktop's claude_desktop_config.json. Open Claude Desktop once, then run this again.");
  if (found.length > 1) {
    // Writing to the wrong one would "succeed" while Desktop keeps reading the other.
    console.error(`Found ${found.length} Claude Desktop config files, so it is not clear which one Claude Desktop uses:`);
    for (const f of found) console.error(`  ${f}`);
    fail("more than one config file; none was changed.");
  }
  configPath = found[0] as string;
}

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
} catch (err) {
  fail(`the config file is not valid JSON (${String((err as Error).message)}); it was left as it is.`);
}
const parsed = desktopConfigSchema.safeParse(raw);
if (!parsed.success) fail(`the config file has an unexpected shape; it was left as it is. (${parsed.error.issues[0]?.message ?? "invalid"})`);

const plan = planConfig(parsed.data, entry);
console.log(`Claude Desktop config: ${configPath}`);
console.log(`MCP servers before: ${Object.keys(parsed.data.mcpServers ?? {}).join(", ") || "(none)"}`);
if (plan.unchanged) {
  console.log(`"${SERVER_NAME}" is already set up. Nothing changed.`);
  console.log(RESTART);
  process.exit(0);
}
const what = [
  plan.added ? `add "${SERVER_NAME}"` : plan.updatedEntry ? `update "${SERVER_NAME}"` : null,
  ...plan.removed.map((name) => `remove "${name}"`),
].filter(Boolean);
if (dryRun) {
  console.log(`--dry-run: would ${what.join(", ")}; ${SERVER_NAME} -> ${entry.command} ${entry.args.join(" ")}`);
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${configPath}.backup-${stamp}`;
copyFileSync(configPath, backup);
writeFileSync(configPath, JSON.stringify(plan.updated, null, 2) + "\n");

// Read back what was written, so a bad write cannot go unnoticed.
const check = desktopConfigSchema.safeParse(JSON.parse(readFileSync(configPath, "utf8")) as unknown);
const servers = check.success ? (check.data.mcpServers ?? {}) : {};
if (JSON.stringify(servers[SERVER_NAME]) !== JSON.stringify(entry) || plan.removed.some((name) => name in servers)) {
  copyFileSync(backup, configPath);
  fail("the config did not read back as written; the original was restored from the backup.");
}

console.log(`Done: ${what.join(", ")} (backup of the old file: ${path.basename(backup)}).`);
console.log(`MCP servers now: ${Object.keys(servers).join(", ")}`);
console.log(RESTART);
