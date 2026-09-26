// `npm run phase1:check`: the Phase 1 acceptance check from the command line (the steps are in
// phase1-check.ts). Run from the repo root with Lightroom open, the LrC-AVG plugin enabled and the
// NEF selected in Develop. Jim answers two y/n questions in this window at the end.
// Results: %TEMP%\LrC-AVG\P1\p1_check_<time>.json, plus a copy of the plugin's log
// (<temp>\LrC-AVG\bridge.log). Claude Code collects them; nothing to copy by hand.

import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient } from "../bridge/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { describeError, runPhase1Check, type Answer } from "./phase1-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "P1");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  // The plugin writes its log under Lightroom's temp folder; that it is %TEMP% is [unverified]
  // (CLAUDE.md), so finding it here is itself a result.
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `p1_bridge_log_${stamp}.txt`);
    copyFileSync(PLUGIN_LOG, copy);
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  const file = path.join(OUT_DIR, `p1_check_${stamp}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2) + "\n");
  return file;
}

async function main(): Promise<number> {
  // Answers are read through readline's buffered line iterator, so a line typed (or piped) before its
  // question is asked is not lost; if input ends, the answer is recorded as "no answer".
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
  const { accepted, results } = await runPhase1Check({
    client: new BridgeClient({ log: (m) => console.error(`  (${m})`) }),
    map: loadDefaultParamMap(),
    ask,
    say: (line) => console.log(line),
  });
  rl.close();
  console.log(`Results saved automatically: ${save(results)}`);
  console.log('Nothing to copy. Tell Claude Code "done".');
  return accepted ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a dry run on 2026-09-26, where the summary was lost]. The bridge client and
// readline are closed by then, so Node exits by itself.
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${save({ check: "phase1", errors: [describeError(err)] })}`);
    process.exitCode = 1;
  },
);
