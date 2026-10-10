// `npm run phase8:check`: the Phase 8 acceptance check from the command line (the parts are in
// phase8-check.ts). Run from the repo root with Lightroom open in the Develop module, the LrC-AVG
// plugin enabled, and Claude Desktop quit. Parts 1-3 need nothing from Jim; then he restarts Lightroom
// once, clicks a preset, holds one chat in Claude Desktop, deletes two presets and a snapshot, and
// answers y/n here. Run again after a stop, it continues where it stopped (phase8-state.ts); `-- --new`
// starts over. The check's engine is wired as phase4-check-cli.ts's (no settings page: every session
// is autonomous), without the HUD, which would open for each of its ~45 sessions [inference: 31 photos, 11
// intents, Part 3]. Results, all under
// %TEMP%\LrC-AVG\P8\ (Claude Code collects them; nothing to copy by hand):
//   p8_state.json                          what is done so far (the next run continues from it)
//   p8_check_<time>.json                   each run's results
//   p8_check_tools_<time>\                 the check's own tool log
//   p8_sessions_<time>\                    the check's session logs and recipes
//   p8_desktop_mcp_log_<time>_chat.txt     Claude Desktop's lrc-avg log from the chat, user folder redacted
//   p8_chat_tool_log_<time>_chat.jsonl     the engine's tool log from the chat, user folder redacted
//   p8_bridge_log_<time>.txt               a copy of the plugin's log, user folder redacted

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
import { SERVER_NAME } from "../setup/desktop-config.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { collectChatLogs } from "./phase2-collect.js";
import { runPhase8Check } from "./phase8-check.js";
import { checkStateSchema } from "./phase8-state.js";
import { jsonStateStore } from "./phase5-state.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// A dry run against a stand-in plugin points these at a scratch folder (as phase5-check-cli.ts).
const OUT_DIR = process.env["LRC_AVG_P8_OUT"] || path.join(os.tmpdir(), "LrC-AVG", "P8");
const PLUGIN_LOG = process.env["LRC_AVG_PLUGIN_LOG"] || path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");

const redact = (text: string): string => redactHome(text, os.homedir());

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `p8_bridge_log_${stamp}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  } else {
    results["plugin_log_copied"] = null;
  }
  results["node"] = process.version;
  results["engine_version"] = ENGINE_VERSION;
  const file = path.join(OUT_DIR, `p8_check_${stamp}.json`);
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
    sessionLogDir: path.join(OUT_DIR, `p8_sessions_${stamp}`),
    presetDir,
    engineVersion: ENGINE_VERSION,
    ensureBridge: (waitMs) => gate.ready(waitMs),
    log: new ToolLog(path.join(OUT_DIR, `p8_check_tools_${stamp}`)),
    hud: false,
  });
  const { accepted, finished, results } = await runPhase8Check(
    {
      client,
      gate,
      tools,
      map,
      ask: io.ask,
      prompt: io.prompt,
      say: (line) => console.log(line),
      presetDir,
      state: jsonStateStore(path.join(OUT_DIR, "p8_state.json"), checkStateSchema),
      stamp,
      collectChat: (since, tag) =>
        collectChatLogs(since, {
          desktopLog: path.join(process.env["LOCALAPPDATA"] ?? "", "Claude", "Logs", `mcp-server-${SERVER_NAME}.log`),
          // Claude Desktop's engine writes its tool log to LRC_AVG_LOG_DIR, which the Desktop entry sets
          // to the repo's logs\ folder (install-desktop-config-cli.ts); a dry run points both at a scratch folder.
          engineLogDir: process.env["LRC_AVG_LOG_DIR"] || path.join(repoRoot, "logs"),
          outDir: OUT_DIR,
          stamp: `${stamp}_${tag}`,
          home: os.homedir(),
          serverName: SERVER_NAME,
          prefix: "p8",
          checkName: "phase8:check",
        }),
    },
    { fresh: process.argv.includes("--new") },
  );
  io.close();
  console.log(`Results saved automatically: ${save(results)}`);
  console.log(finished ? 'Nothing to copy. Tell Claude Code "done".' : "Nothing to copy. Run the same command again to continue, or tell Claude Code what happened.");
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
    console.log(`Results saved automatically: ${save({ check: "phase8", errors: [describeError(err)] })}`);
    process.exitCode = 1;
  },
);
