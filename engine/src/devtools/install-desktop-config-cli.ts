// `npm run desktop:install`: add the repo's engine to Claude Desktop's config as "lrc-avg", with the
// tool log in the repo's logs\ folder, and remove the S3 test server (the rules are in
// setup\desktop-config.ts, the file work in setup\apply-config.ts). Run from the repo root.
// Options (for Claude Code's testing only): --config <path> uses that file; --dry-run writes nothing.
// A user install runs `lrc-avg-setup` instead (setup\setup-cli.ts).

import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyDesktopConfig, describeResult, SetupError } from "../setup/apply-config.js";
import { engineEntry } from "../setup/desktop-config.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const configIdx = argv.indexOf("--config");
const configPath = configIdx >= 0 ? argv[configIdx + 1] : undefined;
const RESTART = "Next: quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit), then run the Phase 2 check.";

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  console.error("Nothing was changed. Tell Claude Code what this says.");
  process.exit(1);
}

const mainJs = path.join(repoRoot, "engine", "dist", "mcp", "main.js");
if (!existsSync(mainJs)) fail(`the engine is not built (${mainJs} is missing); run npm run build first.`);
if (configIdx >= 0 && configPath === undefined) fail("--config needs a file path.");

try {
  const entry = engineEntry(mainJs, process.execPath, { LRC_AVG_LOG_DIR: path.join(repoRoot, "logs") });
  const result = applyDesktopConfig({ entry, configPath, dryRun });
  for (const line of describeResult(result, dryRun)) console.log(line);
  console.log(RESTART);
} catch (err) {
  if (err instanceof SetupError) fail(err.message);
  throw err;
}
