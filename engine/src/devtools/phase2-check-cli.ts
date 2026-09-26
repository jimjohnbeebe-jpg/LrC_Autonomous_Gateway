// `npm run phase2:check`: the Phase 2 acceptance check from the command line (the steps are in
// phase2-check.ts). Run from the repo root with Lightroom open, the LrC-AVG plugin enabled, the NEF
// selected in Develop, and Claude Desktop not running. Jim answers y/n questions in this window
// (his choice, as in Phase 1) and holds the chat in Claude Desktop when it says so.
// Results, all under %TEMP%\LrC-AVG\P2\ (Claude Code collects them; nothing to copy by hand):
//   p2_check_<time>.json                the results
//   p2_check_tools_<time>\              the check's own tool log
//   p2_desktop_mcp_log_<time>.txt       Claude Desktop's lrc-avg log from the chat, user folder redacted
//   p2_chat_tool_log_<time>.jsonl       the engine's tool log from the chat, user folder redacted
//   p2_bridge_log_<time>.txt            a copy of the plugin's log, user folder redacted
// Where Claude Desktop logs: %LOCALAPPDATA%\Claude\Logs\mcp-server-<server name>.log [handle:
// docs\reports\phase0\S3\desktop-mcp-log-excerpt.txt header; the folder listing on Jim's machine,
// 2026-09-26, shows mcp-server-*.log files there]. The engine's tool log is in the repo's logs\
// folder, where the Claude Desktop entry points LRC_AVG_LOG_DIR (desktop-config.ts).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/index.js";
import { ToolLog } from "../log/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { SERVER_NAME } from "./desktop-config.js";
import { describeError } from "./phase1-check.js";
import { collectChatLogs } from "./phase2-collect.js";
import { HISTORY_PREFIX, redactHome, runPhase2Check, type Answer, type ChatLogs } from "./phase2-check.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "P2");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const redact = (text: string): string => redactHome(text, os.homedir());

function collectChat(since: Date): ChatLogs {
  return collectChatLogs(since, {
    desktopLog: path.join(process.env["LOCALAPPDATA"] ?? "", "Claude", "Logs", `mcp-server-${SERVER_NAME}.log`),
    engineLogDir: path.join(repoRoot, "logs"),
    outDir: OUT_DIR,
    stamp,
    home: os.homedir(),
    serverName: SERVER_NAME,
  });
}

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    // Redacted like everything else here: the plugin logs its token file's path in the home folder.
    const copy = path.join(OUT_DIR, `p2_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `p2_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

async function main(): Promise<number> {
  // Answers are read through readline's buffered line iterator, so a line typed before its question
  // is not lost; if input ends, the answer is recorded as "no answer".
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
  const waitEnter = async (prompt: string): Promise<boolean> => {
    process.stdout.write(`${prompt} `);
    return !(await lines.next()).done;
  };

  const log = (m: string) => console.error(`  (${m})`);
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log, ...dev.bridge });
  const previews = new PreviewService(client);
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort), { onAcquire: () => previews.purge() });
  const tools = new Tools({
    client,
    map: loadDefaultParamMap(),
    previews,
    ensureBridge: () => gate.ready(),
    log: new ToolLog(path.join(OUT_DIR, `p2_check_tools_${stamp}`)),
    historyPrefix: HISTORY_PREFIX,
  });
  const { accepted, results } = await runPhase2Check({
    client,
    gate,
    tools,
    previews,
    map: loadDefaultParamMap(),
    ask,
    waitEnter,
    say: (line) => console.log(line),
    collectChat,
  });
  rl.close();
  console.log(`Results saved automatically: ${save(results)}`);
  console.log('Nothing to copy. Tell Claude Code "done".');
  return accepted ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26, where the summary was lost; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${save({ check: "phase2", errors: [describeError(err)] })}`);
    process.exitCode = 1;
  },
);
