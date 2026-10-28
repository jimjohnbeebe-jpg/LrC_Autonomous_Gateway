#!/usr/bin/env node
// `lrc-avg-setup` (PHASE6_PLAN decision 2): add the installed engine to Claude Desktop's config as
// "lrc-avg", run by this Node with an absolute path, so the entry does not depend on PATH or npx.
//   lrc-avg-setup              add or update the entry
//   lrc-avg-setup --remove     take it out again (uninstall)
//   --config <path>            use that file (testing); --dry-run writes nothing
//   --tools <full|edit>        the tool profile (issue #165, LRC_AVG_TOOLS in the entry); without it, a profile
//                              already in the entry is kept
//   --installer                for the Windows setup (PHASE9_PLAN row 2): no prompts, exit 0 whatever
//                              happens, and the outcome in %LOCALAPPDATA%\LrC-AVG\setup-result.json/.txt
// The work is in setup-run.ts, the file rules (backup, read-back, nothing changed the second time) in
// apply-config.ts, the config's location in desktop-config.ts.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runSetup } from "./setup-run.js";

/** This package's version: engine\package.json is two folders up from both src\setup and dist\setup [handle: engine\tsconfig.json rootDir ./src, outDir ./dist], and ships with the engine. */
function engineVersion(): string {
  try {
    const raw: unknown = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return z.object({ version: z.string() }).parse(raw).version;
  } catch {
    return "unknown";
  }
}

const mainJs = fileURLToPath(new URL("../mcp/main.js", import.meta.url));
const { exitCode, out, err } = runSetup(process.argv.slice(2), { mainJs, execPath: process.execPath, version: engineVersion() });
for (const line of out) console.log(line);
for (const line of err) console.error(line);
process.exit(exitCode);
