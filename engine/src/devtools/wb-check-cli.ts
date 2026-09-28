// `npm run wb:check`: the white balance check from the command line (the steps are in wb-check.ts).
// Run from the repo root with Lightroom open in the Develop module, the LrC-AVG plugin enabled, and
// Claude Desktop not using LrC-AVG (this takes the engine's instance lock). Jim clicks the photo when
// asked and answers y/n questions in this window, as in the phase checks.
// Results, under %TEMP%\LrC-AVG\WB\ (Claude Code collects them; nothing to copy by hand):
//   wb_check_<time>.json         the results
//   wb_bridge_log_<time>.txt     a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { runWbCheck } from "./wb-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "WB");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `wb_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `wb_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

/** Questions and prompts in this window, from a buffered line iterator (phase4-check-cli.ts). */
function terminal(): { prompt: (text: string) => Promise<string | null>; ask: (question: string) => Promise<Answer>; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (text: string): Promise<string | null> => {
    process.stdout.write(`${text} `);
    const next = await lines.next();
    return next.done ? null : String(next.value).trim();
  };
  const ask = async (question: string): Promise<Answer> => {
    for (;;) {
      const answer = await prompt(`${question} Type y or n, then Enter:`);
      if (answer === null) return "no answer";
      if (answer.toLowerCase() === "y" || answer.toLowerCase() === "n") return answer.toLowerCase() as Answer;
    }
  };
  return { prompt, ask, close: () => rl.close() };
}

async function main(): Promise<number> {
  const io = terminal();
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const { worked, results } = await runWbCheck({ client, gate, map: loadDefaultParamMap(), ask: io.ask, prompt: io.prompt, say: (line) => console.log(line), stamp });
  io.close();
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "done".');
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
    console.log(`Results saved automatically: ${redact(save({ check: "wb", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
