// `npm run curve:probe` (GitHub issue #187): the curve probe from the command line (the steps are in
// curve-probe.ts). Run from the repo root with Lightroom open in Develop, issue #187's photo
// (20220828-_DSC1159-HDR.dng) selected in the open collection, the LrC-AVG plugin enabled, and Claude Desktop
// quit (this takes the engine's instance lock). Jim answers one y/n question in this window
// (docs\reports\phase10\curve-probe.md, "Steps for Jim"). Results, under %TEMP%\LrC-AVG\curve\ (Claude Code
// collects them into docs\reports\phase10\curve-probe\):
//   curve_probe_<time>.json        the results
//   curve_bridge_log_<time>.txt    a copy of the plugin's log, user folder redacted
//   sessions\                      the engine session's provenance log (part a)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { runCurveProbe } from "./curve-probe.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "curve");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `curve_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  }
  Object.assign(results, { node: process.version, engine_version: ENGINE_VERSION });
  const file = path.join(OUT_DIR, `curve_probe_${stamp}.json`);
  writeFileSync(file, `${redact(JSON.stringify(results, null, 2))}\n`);
  return file;
}

async function main(): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const { worked, results } = await runCurveProbe({
    client, gate, map: loadDefaultParamMap(), ask, say: (line) => console.log(line), stamp,
    dumpDir: OUT_DIR, recorderDir: OUT_DIR, sessionDir: path.join(OUT_DIR, "sessions"),
  });
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "curve probe done".');
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
    console.log(`Results saved automatically: ${redact(save({ check: "curve-probe", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
