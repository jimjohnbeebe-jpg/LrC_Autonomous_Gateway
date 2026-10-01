// `npm run phase5:check`: the Phase 5 acceptance check from the command line (the parts are in
// phase5-check.ts). Run from the repo root with Lightroom open in the Develop module, the LrC-AVG
// plugin enabled, and Claude Desktop not running at the start. Jim clicks where the window says,
// answers y/n questions here (as in Phases 1-4), and holds the chats in Claude Desktop. Run again
// after a stop, it continues where it stopped (phase5-state.ts); `-- --new` starts over.
// The check's engine is wired as the MCP server's is (engine\src\mcp\main.ts): the settings page
// (PageSettings), and the 60 s silence allowance while a session is open (SESSION_SILENCE_MS), so
// a session rides out a Plug-in Manager pause as Claude Desktop's would. Results, all under
// %TEMP%\LrC-AVG\P5\ (Claude Code collects them; nothing to copy by hand):
//   p5_state.json                         what is done so far (the next run continues from it)
//   p5_check_<time>.json                  each run's results
//   p5_check_tools_<time>\                the check's own tool log
//   p5_sessions_<time>\                   the check's session logs and recipes
//   p5_desktop_mcp_log_<time>_<chat>.txt  Claude Desktop's lrc-avg log from each chat, user folder redacted
//   p5_chat_tool_log_<time>_<chat>.jsonl  the engine's tool log from each chat, user folder redacted
//   p5_bridge_log_<time>.txt              a copy of the plugin's log, user folder redacted

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BridgeClient } from "../bridge/index.js";
import { IntentLibrary } from "../intents/index.js";
import { ToolLog } from "../log/index.js";
import { SESSION_SILENCE_MS } from "../mcp/bridge-gate.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { PageSettings } from "../settings/index.js";
import { SERVER_NAME } from "../setup/desktop-config.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { collectChatLogs } from "./phase2-collect.js";
import { runPhase5Check } from "./phase5-check.js";
import { fileStateStore } from "./phase5-state.js";
import { PluginLog, traceHudUpdates, type HudTraceEntry } from "./phase5-trace.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// A dry run against a stand-in plugin points these at a scratch folder (as LRC_AVG_COMMAND_PORT and
// the other development overrides do, mcp\dev-overrides.ts), so it neither writes into the plugin's
// real log nor leaves a state file that Jim's run would continue.
const OUT_DIR = process.env["LRC_AVG_P5_OUT"] || path.join(os.tmpdir(), "LrC-AVG", "P5");
const PLUGIN_LOG = process.env["LRC_AVG_PLUGIN_LOG"] || path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `p5_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `p5_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

/** Questions and prompts in this window, from a buffered line iterator, so a line typed before its question is not lost (phase4-check-cli.ts). */
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

/** Claude Desktop's error and time-out lines in a chat's saved MCP log excerpt [inference: how a timed-out call would show there is not known]. */
function desktopErrors(file: string | null): string[] {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8").split(/\r?\n/).filter((l) => /\[error\]|timed? ?out|timeout|cancel/i.test(l));
}

async function main(): Promise<number> {
  const io = terminal();
  const log = (m: string) => console.error(`  (${m})`);
  const dev = devOverrides();
  let sessionOpen = (): boolean => false;
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log, silenceAllowanceMs: () => (sessionOpen() ? SESSION_SILENCE_MS : 0), ...dev.bridge });
  const hudTrace: HudTraceEntry[] = [];
  traceHudUpdates(client, hudTrace);
  const previews = new PreviewService(client);
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort), { onAcquire: () => previews.purge() });
  const map = loadDefaultParamMap();
  const settings = new PageSettings(client);
  const tools = new Tools({
    client,
    map,
    previews,
    intents: new IntentLibrary({ map }),
    sessionLogDir: path.join(OUT_DIR, `p5_sessions_${stamp}`),
    settings,
    engineVersion: ENGINE_VERSION,
    ensureBridge: (waitMs) => gate.ready(waitMs),
    log: new ToolLog(path.join(OUT_DIR, `p5_check_tools_${stamp}`)),
  });
  sessionOpen = () => (tools.sessionManager()?.current() ?? null) !== null;
  const { accepted, finished, results } = await runPhase5Check(
    {
      client,
      gate,
      tools,
      map,
      settings,
      ask: io.ask,
      prompt: io.prompt,
      say: (line) => console.log(line),
      pluginLog: new PluginLog(PLUGIN_LOG),
      hudTrace,
      state: fileStateStore(path.join(OUT_DIR, "p5_state.json")),
      stamp,
      collectChat: (since, tag) => {
        const logs = collectChatLogs(since, {
          desktopLog: path.join(process.env["LOCALAPPDATA"] ?? "", "Claude", "Logs", `mcp-server-${SERVER_NAME}.log`),
          // Claude Desktop's engine writes its tool log to LRC_AVG_LOG_DIR, which the Desktop entry sets
          // to the repo's logs\ folder (install-desktop-config-cli.ts); a dry run points both at a scratch folder.
          engineLogDir: process.env["LRC_AVG_LOG_DIR"] || path.join(repoRoot, "logs"),
          outDir: OUT_DIR,
          stamp: `${stamp}_${tag}`,
          home: os.homedir(),
          serverName: SERVER_NAME,
          prefix: "p5",
          checkName: "phase5:check",
        });
        const saved = logs.desktop_log.saved_as ? path.join(OUT_DIR, logs.desktop_log.saved_as) : null;
        return { ...logs, desktop_errors: desktopErrors(saved) };
      },
    },
    { fresh: process.argv.includes("--new") },
  );
  io.close();
  console.log(`Results saved automatically: ${save(results)}`);
  console.log(finished ? 'Nothing to copy. Tell Claude Code "done".' : 'Nothing to copy. Run the same command again to continue, or tell Claude Code what happened.');
  return accepted ? 0 : finished ? 1 : 2;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${save({ check: "phase5", errors: [describeError(err)] })}`);
    process.exitCode = 1;
  },
);
