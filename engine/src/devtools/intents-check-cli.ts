// `npm run intents:check` (issue #180): is an intent that Claude Desktop (MSIX) saved in the Documents
// folder, where File Explorer sees it? Run it in PowerShell, not in Claude Desktop, after asking Claude
// Desktop to save the test intent (the prompt is printed when the file is not found). It looks at the
// new folder (<Documents>\LrC-AVG\intents, or LRC_AVG_INTENTS_DIR when your PowerShell sets it) and at
// the two old ones, prints what is in each, and ends with WORKED or FAILED. It then deletes the test
// file, wherever it is. Results, under %TEMP%\LrC-AVG\intents-check\ (Claude Code collects them):
//   intents_check_<time>.json   the three places and their intents, the marker, the verdict

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MIGRATION_MARKER, defaultUserIntentsDir, oldIntentFolders } from "../intents/index.js";
import { CHAT_PROMPT, TEST_ID, describeFindings, judge, type Place } from "./intents-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "intents-check");
const redact = (text: string): string => redactHome(text, os.homedir());

function scan(kind: Place["kind"], dir: string): Place {
  try {
    const ids = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
      .map((e) => e.name.slice(0, -".json".length))
      .sort();
    return { kind, dir, exists: true, ids };
  } catch {
    return { kind, dir, exists: false, ids: [] };
  }
}

const target = scan("new", defaultUserIntentsDir());
const old = oldIntentFolders(process.env).map((o) => scan(o.kind, o.dir));
const markerFile = path.join(target.dir, MIGRATION_MARKER);
const findings = { target, old, marker: existsSync(markerFile) ? readFileSync(markerFile, "utf8") : null };
const verdict = judge(findings);

for (const line of describeFindings(findings)) console.log(line);
if (process.env["LRC_AVG_INTENTS_DIR"]) console.log(`Note: LRC_AVG_INTENTS_DIR is set in this PowerShell, so the new folder above is that one.`);
if (!verdict.worked && ![target, ...old].some((p) => p.ids.includes(TEST_ID))) console.log(`\nAsk Claude Desktop (a new chat):\n${CHAT_PROMPT}`);

const found = [target, ...old].filter((p) => p.ids.includes(TEST_ID));
for (const p of found) rmSync(path.join(p.dir, `${TEST_ID}.json`), { force: true });
console.log(found.length > 0 ? `\nDeleted ${TEST_ID}.json from: ${found.map((p) => p.dir).join("; ")}` : `\nNo ${TEST_ID}.json to delete.`);

mkdirSync(OUT_DIR, { recursive: true });
const file = path.join(OUT_DIR, `intents_check_${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
writeFileSync(file, redact(JSON.stringify({ check: "intents", issue: 180, started_at: new Date().toISOString(), node: process.version, ...findings, deleted_test_file_from: found.map((p) => p.dir), ...verdict }, null, 2)) + "\n");
console.log(`Results saved automatically: ${redact(file)}`);
console.log(`\n${verdict.headline}`);
if (verdict.worked) console.log('Nothing to copy. Tell Claude Code "done".');
else console.log("Tell Claude Code what this says.");
// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows [handle: stall-check-cli.ts end].
process.exitCode = verdict.worked ? 0 : 1;
