// `npm run offline:check`: the missing-original check from the command line (the steps are in
// offline-check.ts). Run from the repo root with Lightroom open on the "fixtures" collection, the LrC-AVG
// plugin 0.19.1 loaded, and Claude Desktop quit (this takes the engine's instance lock). If Lightroom does
// not select the TIFF, Jim clicks it and presses Enter in this window. Results, under %TEMP%\LrC-AVG\offline\ (Claude Code collects them):
//   offline_check_<time>.json        the results
//   offline_bridge_log_<time>.txt    a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { ToolLog } from "../log/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { runOfflineCheck } from "./offline-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "offline");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `offline_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `offline_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

/** A line typed in this window (Enter), for the one step where Jim clicks the photo himself. */
function terminal(): { prompt: (text: string) => Promise<string | null>; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (text: string): Promise<string | null> => {
    process.stdout.write(`${text} `);
    const next = await lines.next();
    return next.done ? null : String(next.value).trim();
  };
  return { prompt, close: () => rl.close() };
}

async function main(): Promise<number> {
  const io = terminal();
  const dev = devOverrides();
  const map = loadDefaultParamMap();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const tools = new Tools({
    client,
    map,
    previews: new PreviewService(client),
    intents: new IntentLibrary({ map }),
    sessionLogDir: path.join(OUT_DIR, `offline_sessions_${stamp}`),
    engineVersion: ENGINE_VERSION,
    ensureBridge: () => gate.ready(),
    log: new ToolLog(path.join(OUT_DIR, `offline_check_tools_${stamp}`)),
  });
  const { worked, results } = await runOfflineCheck({ client, gate, tools, map, prompt: io.prompt, say: (line) => console.log(line) });
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
    console.log(`Results saved automatically: ${redact(save({ check: "offline", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
