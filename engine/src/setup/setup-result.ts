// What `lrc-avg-setup --installer` leaves for the Windows setup (PHASE9_PLAN row 2, decision D4), in the
// product's data folder %LOCALAPPDATA%\LrC-AVG\ (the folder of logs\ and intents\):
//   setup-result.json  the record {time, version, action, outcome, config_path, message}
//   setup-result.txt   the same message as one plain line, for an NSIS MessageBox
// The command exits 0 whatever happened, so the setup reads these files, not the exit code. Both are
// deleted before a run starts, so a file that is there belongs to that run.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import { SetupError, type ApplyResult } from "./apply-config.js";

export const RESULT_JSON = "setup-result.json";
export const RESULT_TXT = "setup-result.txt";

const actionSchema = z.enum(["add", "remove"]);
const outcomeSchema = z.enum(["added", "unchanged", "removed", "absent", "not_found", "ambiguous", "error"]);

export const setupResultSchema = z.strictObject({
  time: z.iso.datetime(),
  version: z.string(),
  action: actionSchema,
  outcome: outcomeSchema,
  /** The config file the run worked on; null when there is none (Claude Desktop not found, or a failure before one was chosen). */
  config_path: z.string().nullable(),
  message: z.string(),
});
export type SetupResult = z.infer<typeof setupResultSchema>;
export type SetupAction = z.infer<typeof actionSchema>;
export type SetupOutcome = z.infer<typeof outcomeSchema>;

/**
 * %LOCALAPPDATA%\LrC-AVG, as the log module's defaultLogDir has it without "\logs" (a module that
 * `setup` may not import, so the three lines are repeated here).
 */
export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const localAppData = env["LOCALAPPDATA"];
  return localAppData ? path.join(localAppData, "LrC-AVG") : path.join(os.homedir(), ".lrc-avg");
}

/** The user-facing sentence for an outcome; `detail` is the failure's own message (error, ambiguous). */
function messageFor(action: SetupAction, outcome: SetupOutcome, detail: string): string {
  const verb = action === "add" ? "update" : "clean up";
  switch (outcome) {
    case "added":
      return "LrC-AVG was added to Claude Desktop's config. Quit Claude Desktop (right-click its icon in the Windows system tray, then Quit) and start it again.";
    case "unchanged":
      return "LrC-AVG was already set up in Claude Desktop's config, so nothing was changed.";
    case "removed":
      return "LrC-AVG was removed from Claude Desktop's config.";
    case "absent":
      return "LrC-AVG was not in Claude Desktop's config, so nothing was removed.";
    case "not_found":
      return action === "add"
        ? "Claude Desktop was not found in this Windows account, so its config was not changed. Install Claude Desktop, start it once, then run the LrC-AVG setup again."
        : "Claude Desktop was not found in this Windows account, so there was no config to clean up.";
    case "ambiguous": {
      const paths = detail.split("\n").slice(1).map((p) => p.trim()).filter(Boolean);
      return `LrC-AVG did not change Claude Desktop's config because it could not tell which of these Claude Desktop uses: ${paths.join("; ")}`;
    }
    case "error":
      return `LrC-AVG could not ${verb} Claude Desktop's config. ${detail}`;
  }
}

/** The finished run's result: "added" also covers an entry that was updated. */
export function resultOf(action: SetupAction, r: ApplyResult, version: string, now: Date, configExists: boolean): SetupResult {
  const outcome: SetupOutcome = action === "add" ? (r.entryChanged ? "added" : "unchanged") : r.entryChanged ? "removed" : "absent";
  return { time: now.toISOString(), version, action, outcome, config_path: configExists ? r.configPath : null, message: messageFor(action, outcome, "") };
}

/** The result of a run that stopped: a SetupError names its kind; anything else is "error". */
export function failureOf(action: SetupAction, err: unknown, version: string, now: Date): SetupResult {
  const outcome: SetupOutcome = err instanceof SetupError ? err.kind : "error";
  const detail = err instanceof Error ? err.message : String(err);
  return { time: now.toISOString(), version, action, outcome, config_path: null, message: messageFor(action, outcome, detail) };
}

/** One line of plain ASCII for an NSIS MessageBox: line breaks become spaces, anything else outside ASCII a "?" [unverified: how NSIS FileRead treats UTF-8]. */
export function plainLine(message: string): string {
  return message.replace(/\s+/g, " ").trim().replace(/[^\x20-\x7e]/g, "?");
}

/** Deletes the previous run's files. Never throws: a file that cannot be deleted is overwritten by the write. */
export function clearSetupResult(dir: string): void {
  for (const name of [RESULT_JSON, RESULT_TXT]) {
    try {
      rmSync(path.join(dir, name), { force: true });
    } catch {
      // see above
    }
  }
}

/** Writes both files (the folder is made when it is missing); the record is checked against its schema first. */
export function writeSetupResult(dir: string, result: SetupResult): void {
  const checked = setupResultSchema.parse(result);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, RESULT_JSON), JSON.stringify(checked, null, 2) + "\n");
  writeFileSync(path.join(dir, RESULT_TXT), plainLine(checked.message));
}
