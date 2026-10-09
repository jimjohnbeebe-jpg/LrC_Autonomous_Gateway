// `npm run s10:check [-- --fixtures | --census]`: spike S10 from the command line (the steps are in
// s10-check.ts). Run from the repo root with Lightroom open, the LrC-AVG plugin enabled, the S10
// spike plugin's recorder already run (spikes\S10\README.md), and Claude Desktop not using LrC-AVG
// (this takes the engine's instance lock). Jim answers y/n questions in this window about the
// selected photo. `--fixtures` adds the fixture photos to the collection by name, then the census;
// `--census` is the census alone; both write nothing to a photo and ask nothing.
// Results, under %TEMP%\LrC-AVG\S10\ (Claude Code collects them with spikes\S10\collect.ts):
//   census\s10_<photo>.json        one settings dump per photo of the "fixtures" collection
//   s10_check_<time>.json          the results
//   s10_bridge_log_<time>.txt      a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { runS10Check } from "./s10-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "S10");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `s10_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `s10_check_${stamp}.json`);
  writeFileSync(file, `${redact(JSON.stringify(results, null, 2))}\n`);
  return file;
}

/** y/n questions in this window (wb-check-cli.ts). */
function terminal(): { ask: (question: string) => Promise<Answer>; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const ask = async (question: string): Promise<Answer> => {
    for (;;) {
      process.stdout.write(`${question} Type y or n, then Enter: `);
      const next = await lines.next();
      if (next.done) return "no answer";
      const answer = String(next.value).trim().toLowerCase();
      if (answer === "y" || answer === "n") return answer;
    }
  };
  return { ask, close: () => rl.close() };
}

async function main(): Promise<number> {
  const io = terminal();
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const { worked, results } = await runS10Check(
    { client, gate, map: loadDefaultParamMap(), ask: io.ask, say: (line) => console.log(line), stamp, dumpDir: path.join(OUT_DIR, "census"), recorderDir: path.join(OUT_DIR, "run1") },
    { censusOnly: process.argv.includes("--census"), fixtures: process.argv.includes("--fixtures") },
  );
  io.close();
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "S10 done".');
  return worked ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    // started_at as the collector requires it (spikes\S10\collect.ts), so a start-up failure is summarised too (Greptile, PR #96).
    console.log(`Results saved automatically: ${redact(save({ check: "s10", started_at: new Date().toISOString(), errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
