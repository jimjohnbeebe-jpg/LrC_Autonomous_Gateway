// `npm run s14:check`: spike S14 from the command line (the steps are in s14-check.ts; the plan in
// s14-config.ts). Run from the repo root with Lightroom open in Develop, the LrC-AVG plugin enabled,
// the "fixtures" collection holding 20260907-_OZ80093.NEF and DSC_0031.JPG, and Claude Desktop quit
// (this takes the engine's instance lock). Jim answers two y/n questions in this window
// (spikes\S14\README.md). Results, under %TEMP%\LrC-AVG\S14\ (Claude Code collects them into
// docs\reports\phase10\S14\):
//   charts\S14-*.png                the two charts, imported in place (kept: the catalog points at them)
//   census\s10_<photo>.json         one settings dump per photo of "fixtures" (s10-census.ts)
//   census\s14_monochrome_<photo>.json  the settings under the Monochrome profile (s14-keys.ts)
//   s14_check_<time>.json           the results
//   s14_bridge_log_<time>.txt       a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { ask } from "./mask-carry-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { runS14Check } from "./s14-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "S14");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `s14_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  }
  Object.assign(results, { node: process.version, engine_version: ENGINE_VERSION });
  const file = path.join(OUT_DIR, `s14_check_${stamp}.json`);
  writeFileSync(file, `${redact(JSON.stringify(results, null, 2))}\n`);
  return file;
}

async function main(): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const { worked, results } = await runS14Check(
    { client, gate, map: loadDefaultParamMap(), ask, say: (line) => console.log(line), stamp, dumpDir: path.join(OUT_DIR, "census"), recorderDir: OUT_DIR },
    path.join(OUT_DIR, "charts"),
  );
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "S14 done".');
  return worked ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${redact(save({ check: "s14", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
