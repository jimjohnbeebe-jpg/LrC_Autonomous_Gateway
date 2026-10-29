// `npm run presets:msix` (issue #182): does a preset that Claude Desktop (Microsoft Store, MSIX) saves with
// lr_create_preset_from_active land in Lightroom's preset folder, or in the Claude package's private copy? Run it in
// PowerShell from the repo root, with Lightroom open and ONE photo selected. It checks that Claude Desktop's "lrc-avg" entry runs this folder's engine, prints a preset name
// and the sentence to paste into a new Claude Desktop chat, waits for Jim's y, then looks for the preset file in
// %APPDATA%\Adobe\CameraRaw\Settings and in each %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Adobe\CameraRaw\
// Settings. It prints REDIRECTED / NOT REDIRECTED, asks whether Lightroom's Presets panel lists the preset after a
// Lightroom restart (Lightroom lists a new preset file only after it restarts [handle: docs\reports\phase4\S7.md
// Verdict 1; engine\src\mcp\defs-propagation.ts lr_create_preset_from_active description]), offers to delete the
// file(s) it found. It never changes Claude Desktop's config: when the "lrc-avg" entry runs another engine it stops and
// says to run `npm run desktop:install` and restart Claude Desktop. Nothing is sent to Lightroom. Results under %TEMP%\LrC-AVG\presets-msix\. Report: docs\reports\phase11\PRESET-MSIX.md.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findPresetFiles } from "../presets/folder.js";
import { SERVER_NAME, findDesktopConfigs } from "../setup/desktop-config.js";
import { runs, serversOf } from "./intents-restore.js";
import { ask } from "./mask-carry-probe.js";
import { chatPrompt, judge, presetFolders, presetName, type Place } from "./presets-msix.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "presets-msix");
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const mainJs = path.join(repoRoot, "engine", "dist", "mcp", "main.js");
const redact = (text: string): string => redactHome(text, os.homedir());
const say = (line: string): void => console.log(redact(line));

/** Whether Claude Desktop's "lrc-avg" entry runs this folder's engine: "yes", "no", or why it is not known. */
function desktopEntry(): string {
  const files = findDesktopConfigs(process.env);
  if (files.length !== 1) return `unknown: ${files.length} Claude Desktop config files were found`;
  const entry = serversOf(readFileSync(files[0] as string, "utf8"))?.[SERVER_NAME];
  return runs(entry, mainJs) ? "yes" : "no";
}

function scan(name: string): Place[] {
  return presetFolders(process.env).map(({ kind, dir }) => {
    try {
      return { kind, dir, exists: true, files: findPresetFiles(dir, name).map((f) => f.file) };
    } catch {
      return { kind, dir, exists: false, files: [] };
    }
  });
}

async function main(): Promise<number> {
  const name = presetName();
  const r: Record<string, unknown> = { check: "presets-msix", issue: 182, started_at: new Date().toISOString(), node: process.version, preset_name: name };
  const entry = desktopEntry();
  r["desktop_entry_runs_this_engine"] = entry;
  let worked = false;
  if (entry === "no") {
    say(`Stopped: Claude Desktop's "${SERVER_NAME}" entry does not run ${mainJs}.`);
    say("Run npm run desktop:install, quit Claude Desktop from the tray icon, start it again, then run this again. Nothing was written.");
  } else {
    if (entry !== "yes") say(`Note: whether Claude Desktop runs this folder's engine is ${entry}; the check goes on.`);
    say(`\nThe test preset is "${name}". In Lightroom, ONE photo must be selected.`);
    say("Paste this into a NEW Claude Desktop chat, and click Allow when it asks to use lr_create_preset_from_active:\n");
    say(`  ${chatPrompt(name)}\n`);
    r["saved_answer"] = await ask("Has Claude answered that it saved the preset (y), or did it fail (n)?");
    const places = scan(name);
    const verdict = judge(places, name);
    Object.assign(r, { places, ...verdict });
    say("");
    for (const p of places) say(`  ${p.kind === "real" ? "Lightroom's folder" : "Claude package  "}  ${p.exists ? `${p.files.length} file(s)` : "folder missing"}  ${p.dir}`);
    say(`\n${verdict.where}: ${verdict.detail}\n`);
    if (verdict.found) {
      say("Now quit Lightroom (File > Exit) and start it again: Lightroom lists a new preset only after a restart.");
      say(`Then press D for Develop, and in the Presets panel (left) type "AVG msix" into the panel's search box (or open the group LrC-AVG).`);
      r["listed_in_lightroom"] = await ask(`Does the Presets panel list "${name}"?`);
      const del = await ask("Delete the test preset file(s) listed above?");
      r["delete_answer"] = del;
      const deleted: string[] = [];
      if (del === "y") for (const p of places) for (const f of p.files) {
        rmSync(path.join(p.dir, f), { force: true });
        deleted.push(path.join(p.dir, f));
      }
      r["deleted"] = deleted;
      say(deleted.length > 0 ? `Deleted: ${deleted.join("; ")}` : "Nothing deleted.");
      if (deleted.length > 0 && r["listed_in_lightroom"] === "y") say("Lightroom keeps listing the preset until its next restart; that is expected.");
      worked = r["listed_in_lightroom"] === "y" || r["listed_in_lightroom"] === "n";
    }
  }
  r["headline"] = worked ? "WORKED" : "FAILED";
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `presets_msix_${String(r["started_at"]).replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, redact(JSON.stringify(r, null, 2)) + "\n");
  say("");
  say(`Preset MSIX check: ${worked ? "WORKED" : "FAILED"}${r["where"] ? `, ${String(r["where"])}` : ""}`);
  say(`Results saved automatically: ${file}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return worked ? 0 : 1;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows [handle: stall-check-cli.ts end].
main().then((code) => {
  process.exitCode = code;
});
