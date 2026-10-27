// `npm run sdkver:check` (GitHub issue #209): the sdkver check from the command line (the steps are in
// sdkver-check.ts). Run from the repo root with Lightroom open, the LrC-AVG plugin enabled, the "fixtures"
// collection in the catalog and Claude Desktop quit (this takes the engine's instance lock). Nothing is selected
// or written in Lightroom and nothing is asked (docs\reports\phase11\SDKVER.md, spikes\SDKVER\README.md).
// Results, under %TEMP%\LrC-AVG\sdkver\ (Claude Code collects them into docs\reports\phase11\SDKVER\):
//   sdkver_<declared>_<time>.json   the run and, from the second run on, its comparison; the next run reads these
//   dumps\<time>\s10_<photo>.json   one settings dump per photo, in the S5 shape (spikes\S5\pin.ts reads them)
//   sdkver_bridge_log_<time>.txt    a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { readRuns, runSdkverCheck } from "./sdkver-check.js";
import { fmtSdk } from "./sdkver-diff.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "sdkver");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const INFO_LUA = path.join(process.cwd(), "plugin", "LrC-AVG.lrplugin", "Info.lua");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `sdkver_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  }
  Object.assign(results, { node: process.version, engine_version: ENGINE_VERSION });
  const declared = (results["run"] as { declared?: number } | undefined)?.declared;
  const file = path.join(OUT_DIR, `sdkver_${declared === undefined ? "failed" : fmtSdk(declared)}_${stamp}.json`);
  writeFileSync(file, `${redact(JSON.stringify(results, null, 2))}\n`);
  return file;
}

/** This repo's Info.lua, or null: the run then labels itself with what the plugin reports. */
function readInfo(): { path: string; text: string } | null {
  try {
    return { path: INFO_LUA, text: readFileSync(INFO_LUA, "utf8") };
  } catch {
    return null;
  }
}

async function main(): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const { worked, results } = await runSdkverCheck({
    client, gate, map: loadDefaultParamMap(), say: (line) => console.log(line), stamp,
    dumpDir: path.join(OUT_DIR, "dumps", stamp), info: readInfo(), previous: readRuns(OUT_DIR),
  });
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "sdkver done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${redact(save({ check: "sdkver", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
