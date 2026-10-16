// The clients check's Claude Desktop chat (issue #155 R6: "Claude Desktop: one chat, as in earlier checks
// (the regression)"), as phase8-chat.ts: the check holds the photo back with its own snapshot, gives the
// bridge up for Claude Desktop's engine, Jim holds one chat and answers y/n here. The chat is judged from
// the tool log Claude Desktop's engine wrote (phase2-collect.ts, phase5-chat-eval.ts, whose readers take
// only records with `ok`, so a pending line is never a call), then the bridge is taken back
// (phase5-chat-flow.ts takeBridgeBack) and the photo put back. The session log's `client` is recorded:
// what Claude Desktop sends as clientInfo is [unverified] until this chat (vault ISSUE155_PLAN.md).

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ENGINE_VERSION } from "../mcp/index.js";
import { SERVER_NAME } from "../setup/desktop-config.js";
import { holdBack, putBack, yes, type ClientsDeps, type Run } from "./clients-run.js";
import { testOf } from "./clients-state.js";
import type { Answer } from "./phase1-check.js";
import { collectChatLogs } from "./phase2-collect.js";
import { chatSessionLog, evaluateChat } from "./phase5-chat-eval.js";
import { takeBridgeBack } from "./phase5-chat-flow.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DESKTOP_PROMPT = "Edit the photo selected in Lightroom with the neutral technical correction intent: one pass, then accept it.";

const STEPS = [
  "  1. Start Claude Desktop (Start menu > Claude), so it runs the engine this check was built with.",
  "  2. Open a new chat, type this sentence and press Enter:",
  `       ${DESKTOP_PROMPT}`,
  "  3. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it (Always allow).",
  "  4. Wait until Claude says it has finished and has ended the session.",
];

/** False when input ended mid-chat: the photo stays pending and the next run puts it back and asks again. */
export async function desktopChat(deps: ClientsDeps, run: Run): Promise<boolean> {
  deps.say("");
  deps.say("Claude Desktop: one chat (the regression).");
  const held = await holdBack(deps, run);
  await deps.gate.release(); // leave the bridge to Claude Desktop's engine
  for (const line of STEPS) deps.say(line);
  const since = new Date();
  if ((await deps.prompt("  5. Come back to this window and press Enter.")) === null) return false;
  const answers: Answer[] = [];
  for (const q of ["Did Claude finish without an error message in the chat?", "Are Claude's changes visible on the Develop sliders?"]) answers.push(await deps.ask(q));
  const logs = collectChatLogs(since, {
    desktopLog: path.join(process.env["LOCALAPPDATA"] ?? "", "Claude", "Logs", `mcp-server-${SERVER_NAME}.log`),
    // Claude Desktop's engine logs to the repo's logs\ folder (install-desktop-config-cli.ts), as phase8-check-cli.ts reads it.
    engineLogDir: process.env["LRC_AVG_LOG_DIR"] || path.join(repoRoot, "logs"),
    outDir: deps.outDir,
    stamp: `${deps.stamp}_desktop`,
    home: os.homedir(),
    serverName: SERVER_NAME,
    prefix: "clients",
    checkName: "clients:check",
  });
  const e = evaluateChat(logs.engine_log.records);
  const { log, error } = chatSessionLog(e);
  const lines = {
    session_on_the_photo: e.session_begun && log?.target.uuid === held.uuid,
    passes: e.passes >= 1,
    ended: e.session_ended === "accept" || e.session_ended === "revert",
    engine_version: log?.engine_version === ENGINE_VERSION,
    jim: answers.every((a) => a === "y"),
  };
  deps.say(`  Chat: ${e.session_begun ? `${e.passes} pass(es), ended ${e.session_ended ?? "NO"}` : "no session began"}; client "${log?.client?.name ?? "?"}"; engine ${log?.engine_version ?? "?"} (this check: ${ENGINE_VERSION}).`);
  const back = await takeBridgeBack(deps, run, "the Claude Desktop chat");
  const differing = back ? await putBack(deps, run, held) : ["the bridge"];
  if (answers.includes("no answer")) return false;
  const ok = Object.values(lines).every(Boolean);
  run.state.desktop = testOf(ok, { lines, answers, client: log?.client ?? null, model: log?.model ?? null, session_log_error: error, evaluation: { ...e, tool_calls: e.tool_calls.length }, logs: { desktop_log: logs.desktop_log, engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as } }, put_back_differing: differing });
  run.save();
  deps.say(`  Claude Desktop chat: ${yes(ok)}.`);
  return true;
}
