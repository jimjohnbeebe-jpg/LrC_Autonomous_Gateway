#!/usr/bin/env node
// `lrc-avg-setup` (PHASE6_PLAN decision 2): add the installed engine to Claude Desktop's config as
// "lrc-avg", run by this Node with an absolute path, so the entry does not depend on PATH or npx.
//   lrc-avg-setup              add or update the entry
//   lrc-avg-setup --remove     take it out again (uninstall)
//   --config <path>            use that file (testing); --dry-run writes nothing
// The file rules (backup, read-back, nothing changed the second time) are in apply-config.ts.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyDesktopConfig, describeResult, SetupError } from "./apply-config.js";
import { engineEntry } from "./desktop-config.js";

const USAGE = "Usage: lrc-avg-setup [--remove] [--dry-run] [--config <path>]";
const RESTART = "Next: quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit), then start it again.";

function fail(message: string): never {
  console.error(`FAILED: ${message}`);
  console.error("Claude Desktop's config was not changed.");
  process.exit(1);
}

const argv = process.argv.slice(2);
const configIdx = argv.indexOf("--config");
const configPath = configIdx >= 0 ? argv[configIdx + 1] : undefined;
if (configIdx >= 0 && (configPath === undefined || configPath.startsWith("--"))) fail(`--config needs a file path. ${USAGE}`);
const unknown = argv.filter((a, i) => !["--remove", "--dry-run", "--config"].includes(a) && !(configIdx >= 0 && i === configIdx + 1));
if (unknown.length > 0) fail(`unknown argument ${unknown.join(" ")}. ${USAGE}`);
const remove = argv.includes("--remove");
const dryRun = argv.includes("--dry-run");

const mainJs = fileURLToPath(new URL("../mcp/main.js", import.meta.url));
if (!remove && !existsSync(mainJs)) fail(`the engine is incomplete: ${mainJs} is missing. Install lrc-avg again.`);

try {
  const result = applyDesktopConfig({ entry: remove ? null : engineEntry(mainJs, process.execPath), configPath, dryRun });
  for (const line of describeResult(result, dryRun)) console.log(line);
  if (!remove) console.log(`"lrc-avg" runs: ${process.execPath} ${mainJs}`);
  if (!dryRun) console.log(RESTART);
} catch (err) {
  if (err instanceof SetupError) fail(err.message);
  throw err;
}
