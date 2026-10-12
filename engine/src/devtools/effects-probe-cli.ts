// `npm run effects:probe`: the effects probe from the command line (the steps are in effects-probe.ts;
// issue #125). Run from the repo root with Lightroom open in Develop, the LrC-AVG plugin enabled, the
// "fixtures" collection holding 20260907-_OZ80093.NEF and DSC_0031.JPG, and Claude Desktop quit (this
// takes the engine's instance lock). It asks nothing. Results, under %TEMP%\LrC-AVG\effects\ (Claude
// Code collects them into docs\reports\phase8.5\effects\):
//   census\s10_<photo>.json          one settings dump per photo of the collection (s10-census.ts)
//   effects_probe_<time>.json        the results
//   effects_bridge_log_<time>.txt    a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { runEffectsProbe } from "./effects-probe.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "effects");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `effects_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  }
  Object.assign(results, { node: process.version, engine_version: ENGINE_VERSION });
  const file = path.join(OUT_DIR, `effects_probe_${stamp}.json`);
  writeFileSync(file, `${redact(JSON.stringify(results, null, 2))}\n`);
  return file;
}

async function main(): Promise<number> {
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const { worked, results } = await runEffectsProbe({
    client, gate, map: loadDefaultParamMap(), ask: async () => "no answer", say: (line) => console.log(line), stamp,
    dumpDir: path.join(OUT_DIR, "census"), recorderDir: OUT_DIR,
  });
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "effects done".');
  return worked ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${redact(save({ check: "effects", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
