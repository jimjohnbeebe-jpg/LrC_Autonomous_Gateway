// `npm run shoot:check` (issues #111, #112, #110): the Claude Desktop cull / keyword / batch chat check. Run it in
// PowerShell from the repo root BEFORE the chat, with Claude Desktop running this folder's engine (npm run
// desktop:install) on the full tool profile, and Lightroom open in Library. It starts no engine and sends nothing to
// Lightroom: it prints the chat's steps, waits for Jim's Enter, then reads the chat's records from the tool log Claude
// Desktop's engine wrote (phase2-collect.ts collectChatLogs; the folder is the entry's LRC_AVG_LOG_DIR, else the
// engine's default, log\tool-log.ts defaultLogDir), judges them (shoot-check.ts) and asks Jim y/n in this window.
// Results and the log excerpts: %TEMP%\LrC-AVG\shoot-check\. Report: docs\reports\phase11\SHOOT-CHECK.md.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { defaultLogDir } from "../log/index.js";
import { SERVER_NAME, findDesktopConfigs } from "../setup/desktop-config.js";
import { runs, serversOf } from "./intents-restore.js";
import { ask } from "./mask-carry-probe.js";
import { collectChatLogs } from "./phase2-collect.js";
import { redactHome } from "./phase2-check.js";
import { QUESTIONS, evaluateShootChat, verdict, type Answers } from "./shoot-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "shoot-check");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const mainJs = path.join(repoRoot, "engine", "dist", "mcp", "main.js");
const redact = (text: string): string => redactHome(text, os.homedir());
const say = (line: string): void => console.log(redact(line));

/** The chat's steps, as Jim follows them in Claude Desktop. */
const STEPS = [
  "In Lightroom's Library grid, select about 48 photos of one shoot, a burst among them (click the first, Shift+click the last).",
  "1. Cull. In a NEW Claude Desktop chat, click + below the message box and pick lrc-avg-cull (under lrc-avg). If there is no lrc-avg-cull, type instead:",
  "     Cull the photos selected in Lightroom with lrc-avg: look at them on contact sheets, propose picks and rejects, and wait for my yes before you flag anything.",
  "   Check Claude's table of picks and rejects, then type: yes",
  "2. Keywords. In the same chat, pick lrc-avg-keyword the same way. If there is none, type instead:",
  "     Keyword the photos selected in Lightroom with lrc-avg: propose keywords, a title and a caption for each, and wait for my yes before you write anything.",
  "   Check the table, type: yes. Then in Lightroom click one of the photos and look at its caption in the Metadata panel (right).",
  "3. Put back. Type:",
  "     Put back every flag, keyword, title, caption, headline and AI score or reason you changed in this chat, to the before values.",
  "4. Batch. In Lightroom click ONE photo of the shoot (the hero). Type:",
  "     Edit the photo selected in Lightroom with lrc-avg, intent neutral_technical_correction, one pass, then end the session with accept.",
  "   Then keep the hero selected and Ctrl+click 20 photos of the same scene. Pick lrc-avg-batch the same way. If there is none, type instead:",
  "     Sync the accepted session onto the other selected photos with lrc-avg, adaptive exposure on, show me a contact sheet of them, and wait for my yes before you sync.",
  "   Type: yes. When the sheet is shown, type: Undo the sync on photos 2 and 3 of the sheet.",
  "   Then type: Undo the sync on every other photo too, and put the hero back to its AVG pre-session snapshot.",
  "   Whenever Claude Desktop asks whether Claude may use an lrc-avg tool, click Allow (Always allow).",
];

/** Claude Desktop's lrc-avg entry: whether it runs this folder's engine, its tool profile and its log folder. */
function desktopEntry(): { runsThis: string; profile: string; logDir: string } {
  const files = findDesktopConfigs(process.env);
  if (files.length !== 1) return { runsThis: `unknown: ${files.length} Claude Desktop config files were found`, profile: "unknown", logDir: defaultLogDir() };
  const entry = serversOf(readFileSync(files[0] as string, "utf8"))?.[SERVER_NAME] as { env?: Record<string, string> } | undefined;
  const env = entry?.env ?? {};
  return { runsThis: runs(entry, mainJs) ? "yes" : "no", profile: env["LRC_AVG_TOOLS"]?.trim().toLowerCase() || "full", logDir: defaultLogDir({ ...process.env, ...env }) };
}

/** Wait for Enter; false when the input ended first. */
async function enter(text: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, terminal: false });
  process.stdout.write(`${text} `);
  const next = await rl[Symbol.asyncIterator]().next();
  rl.close();
  return next.done !== true;
}

async function main(): Promise<number> {
  const since = new Date();
  const stamp = since.toISOString().replace(/[:.]/g, "-");
  const r: Record<string, unknown> = { check: "shoot-check", issues: [111, 112, 110], started_at: since.toISOString(), node: process.version };
  const entry = desktopEntry();
  Object.assign(r, { desktop_entry_runs_this_engine: entry.runsThis, tool_profile: entry.profile, engine_log_dir: entry.logDir });
  let worked = false;
  let putBack: boolean | null = null;
  if (entry.runsThis === "no" || entry.profile !== "full") {
    say(entry.runsThis === "no" ? `Stopped: Claude Desktop's "${SERVER_NAME}" entry does not run ${mainJs}.` : `Stopped: Claude Desktop's "${SERVER_NAME}" entry has LRC_AVG_TOOLS=${entry.profile}; this check needs the full tool profile.`);
    say("Run npm run desktop:install, quit Claude Desktop from the tray icon, start it again, then run this again. Nothing was written.");
  } else {
    if (entry.runsThis !== "yes") say(`Note: whether Claude Desktop runs this folder's engine is ${entry.runsThis}; the check goes on.`);
    say("\nKeep this window open. Do these steps in Lightroom and Claude Desktop:\n");
    for (const line of STEPS) say(line);
    say("");
    if (await enter("When Claude has answered the last step, come back to this window and press Enter.")) {
      const logs = collectChatLogs(since, {
        desktopLog: path.join(process.env["LOCALAPPDATA"] ?? "", "Claude", "Logs", `mcp-server-${SERVER_NAME}.log`),
        engineLogDir: entry.logDir,
        outDir: OUT_DIR,
        stamp,
        home: os.homedir(),
        serverName: SERVER_NAME,
        prefix: "shoot",
        checkName: "shoot:check",
      });
      const chat = evaluateShootChat(logs.engine_log.records);
      say(`Tool log: ${logs.engine_log.found ? `${logs.engine_log.records.length} calls since ${since.toISOString()}` : `NOT found in ${entry.logDir}`}.`);
      r["prompts_menu"] = await ask("Did the + menu list the lrc-avg-cull, lrc-avg-keyword and lrc-avg-batch prompts?");
      const answers = {} as Answers;
      for (const [k, q] of Object.entries(QUESTIONS) as Array<[keyof Answers, string]>) answers[k] = await ask(q);
      const v = verdict(chat, answers);
      Object.assign(r, { logs: { desktop_log: logs.desktop_log, engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as, records: logs.engine_log.records.length } }, chat, answers, lines: v.lines });
      say("");
      for (const line of v.lines) say(`  ${line}`);
      worked = v.worked;
      putBack = v.put_back;
    } else r["errors"] = ["input ended before the chat was done"];
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  r["put_back"] = putBack === null ? "NOT CHECKED" : putBack ? "YES" : "NO";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `shoot_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(r, null, 2)) + "\n");
  say("");
  say(`Shoot check: ${worked ? "WORKED" : "FAILED"}`);
  say(`put back: ${String(r["put_back"])}`);
  if (putBack === false) say("  To put the photos back: in the same Claude Desktop chat type: Put back every flag, keyword and caption you changed. Claude Code lists the photos still changed, with their before values, from the results file.");
  say(`Results saved automatically: ${file}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows [handle: stall-check-cli.ts end].
main().then((code) => {
  process.exitCode = code;
});
