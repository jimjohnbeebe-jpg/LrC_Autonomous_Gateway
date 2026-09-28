// `npm run phase4:check`: the Phase 4 acceptance check from the command line (the steps are in
// phase4-check.ts). Run from the repo root with Lightroom open in the Develop module, the LrC-AVG
// plugin enabled, and Claude Desktop not running. Jim clicks the photo when asked, answers y/n
// questions in this window (as in Phases 1-3), restarts Lightroom when it says so, holds the chat in
// Claude Desktop, and removes the copies and presets at the end.
// Results, all under %TEMP%\LrC-AVG\P4\ (Claude Code collects them; nothing to copy by hand):
//   p4_check_<time>.json                the results
//   p4_check_tools_<time>\              the check's own tool log
//   p4_sessions_<time>\                 the check's session logs and recipes
//   p4_desktop_mcp_log_<time>.txt       Claude Desktop's lrc-avg log from the chat, user folder redacted
//   p4_chat_tool_log_<time>.jsonl       the engine's tool log from the chat, user folder redacted
//   p4_bridge_log_<time>.txt            a copy of the plugin's log, user folder redacted
// The check's preset goes into Lightroom's preset folder (presets\folder.ts defaultPresetDir), where
// Lightroom finds it after the restart [handle: docs\reports\phase4\S7.md Verdict 1]; the cleanup removes it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { ToolLog } from "../log/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { defaultPresetDir } from "../presets/index.js";
import { PreviewService } from "../preview/index.js";
import { SERVER_NAME } from "./desktop-config.js";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { collectChatLogs } from "./phase2-collect.js";
import { runPhase4Check, type Answer } from "./phase4-check.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "P4");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `p4_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `p4_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

/** Questions and prompts in this window, from a buffered line iterator, so a line typed before its question is not lost (phase2-check-cli.ts). */
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
  const presetDir = defaultPresetDir();
  if (!presetDir) throw new Error("APPDATA is not set, so Lightroom's preset folder is not known");
  const io = terminal();
  const log = (m: string) => console.error(`  (${m})`);
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log, ...dev.bridge });
  const previews = new PreviewService(client);
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort), { onAcquire: () => previews.purge() });
  const map = loadDefaultParamMap();
  const tools = new Tools({
    client,
    map,
    previews,
    intents: new IntentLibrary({ map }),
    sessionLogDir: path.join(OUT_DIR, `p4_sessions_${stamp}`),
    presetDir,
    engineVersion: ENGINE_VERSION,
    ensureBridge: () => gate.ready(),
    log: new ToolLog(path.join(OUT_DIR, `p4_check_tools_${stamp}`)),
  });
  const { accepted, results } = await runPhase4Check({
    client,
    gate,
    tools,
    previews,
    map,
    ask: io.ask,
    prompt: io.prompt,
    say: (line) => console.log(line),
    presetDir,
    stamp,
    collectChat: (since) =>
      collectChatLogs(since, {
        desktopLog: path.join(process.env["LOCALAPPDATA"] ?? "", "Claude", "Logs", `mcp-server-${SERVER_NAME}.log`),
        // Where Claude Desktop's engine writes its tool log: LRC_AVG_LOG_DIR, which the Desktop entry
        // sets to the repo's logs\ folder (desktop-config.ts); a dry run points both at a scratch folder.
        engineLogDir: process.env["LRC_AVG_LOG_DIR"] || path.join(repoRoot, "logs"),
        outDir: OUT_DIR,
        stamp,
        home: os.homedir(),
        serverName: SERVER_NAME,
        prefix: "p4",
        checkName: "phase4:check",
      }),
  });
  io.close();
  console.log(`Results saved automatically: ${save(results)}`);
  console.log('Nothing to copy. Tell Claude Code "done".');
  return accepted ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${save({ check: "phase4", errors: [describeError(err)] })}`);
    process.exitCode = 1;
  },
);
