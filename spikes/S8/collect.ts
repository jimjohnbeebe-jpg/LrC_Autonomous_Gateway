// AVG-S8: collect what plugin/spikes/S8.lrplugin saved in %TEMP%\LrC-AVG\S8\ into
// docs\reports\phase5\S8\ and summarise it, so every number in docs\reports\phase5\S8.md comes from
// one command. Claude Code runs it after Jim says "S8 done"; Jim runs nothing here.
//
// Run (PowerShell, from the repo root):
//   node spikes\S8\collect.ts [srcDir] [destDir]
//     srcDir  default: $env:TEMP\LrC-AVG\S8   (LrPathUtils "temp" is %TEMP% [handle: LR_SDK_NOTES "Recorded in Phase 1"])
//     destDir default: docs\reports\phase5\S8
//
// - Reads the newest s8_hud_*.json (S8Hud.lua) and s8_settings_{before,after}_restart_*.json
//   (S8Settings.lua), with the loop-view copy each settings file names.
// - Copies every s8_*.json and s8_*.txt with the user folder written as %USERPROFILE%.
// - Writes s8_summary.json to destDir and prints it.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const srcDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "LrC-AVG", "S8"));
const destDir = path.resolve(process.argv[3] ?? path.join(repoRoot, "docs", "reports", "phase5", "S8"));

const Answer = z.looseObject({ statement: z.string(), answer: z.boolean() });
const Answers = z.record(z.string(), Answer);
const Click = z.looseObject({
  button: z.string(),
  at: z.string(),
  can_yield_in_action: z.boolean().optional(),
  picks_enabled_at_click: z.boolean().optional(),
  task_started_ms: z.number().optional(),
  task_read_ok: z.boolean().optional(),
  task_error: z.string().optional(),
});
const Hud = z.looseObject({
  run_at: z.string(),
  lr_version: z.string().optional(),
  answered: z.boolean(),
  observations: Answers.optional(),
  findings: z.looseObject({
    clicks: z.number(),
    clicks_on_greyed_picks: z.number(),
    closed_by_code: z.string(),
    selection_changes_seen: z.number(),
    appeared_after_request_s: z.number().optional(),
  }),
  run: z.looseObject({
    clicks: z.array(Click).optional(),
    close: z.looseObject({ exists: z.boolean(), tries: z.array(z.looseObject({ argument: z.string(), ok: z.boolean(), error: z.string().optional() })).optional() }).optional(),
    present_error: z.string().optional(),
    present_returned_after_s: z.number().optional(),
    open_when_present_returned: z.boolean().optional(),
    ticks: z.number().optional(),
  }),
});
// SpikeJson writes an empty Lua table as [] (plugin\spikes\S8.lrplugin\SpikeJson.lua header), so no
// prefs yet arrives as [].
const Prefs = z.preprocess((v) => (Array.isArray(v) && v.length === 0 ? {} : v), z.record(z.string(), z.unknown()));
const Settings = z.looseObject({
  step: z.string(),
  run_at: z.string(),
  prefs_in_menu_item: Prefs,
  marks: z.record(z.string(), z.unknown()),
  loop_view_copy: z.string(),
  answered: z.boolean(),
  observations: Answers.optional(),
});
const LoopView = z.looseObject({ prefs_history: z.array(z.looseObject({ seen_at: z.string(), prefs: Prefs })).optional() });

const SETTING_KEYS = ["mode", "maxPasses", "clipHighPct", "logFolder"] as const;

const newest = (prefix: string): string | null => readdirSync(srcDir).filter((f) => f.startsWith(prefix) && f.endsWith(".json")).sort().at(-1) ?? null;
const readJson = (file: string): unknown => JSON.parse(readFileSync(path.join(srcDir, file), "utf8"));

function answers(o: z.infer<typeof Answers> | undefined): Record<string, boolean> | null {
  if (!o) return null;
  return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v.answer]));
}

function hudSummary() {
  const file = newest("s8_hud_");
  if (!file) return { file: null, status: "NOT RUN" };
  const h = Hud.parse(readJson(file));
  return {
    file,
    run_at: h.run_at,
    lr_version: h.lr_version ?? null,
    answered: h.answered,
    jim: answers(h.observations),
    findings: h.findings,
    clicks: (h.run.clicks ?? []).map((c) => ({
      button: c.button,
      at: c.at,
      can_yield_in_action: c.can_yield_in_action ?? null,
      picks_enabled_at_click: c.picks_enabled_at_click ?? null,
      task_started_ms: c.task_started_ms ?? null,
      task_read_ok: c.task_read_ok ?? null,
      task_error: c.task_error ?? null,
    })),
    close_call: h.run.close ?? null,
    present: { error: h.run.present_error ?? null, returned_after_s: h.run.present_returned_after_s ?? null, open_when_returned: h.run.open_when_present_returned ?? null },
    ticks: h.run.ticks ?? null,
  };
}

function settingsFile(step: string) {
  const file = newest(`s8_settings_${step}_`);
  if (!file) return null;
  const s = Settings.parse(readJson(file));
  let history: z.infer<typeof LoopView>["prefs_history"] = [];
  let loopViewError: string | null = null;
  try {
    history = LoopView.parse(readJson(s.loop_view_copy)).prefs_history ?? [];
  } catch (err) {
    loopViewError = `${s.loop_view_copy}: ${err instanceof Error ? err.message : String(err)}`;
  }
  const settings = Object.fromEntries(SETTING_KEYS.map((k) => [k, s.prefs_in_menu_item[k] ?? null]));
  const loopLast = history.at(-1)?.prefs ?? null;
  const loopSawSame = loopLast !== null && SETTING_KEYS.every((k) => JSON.stringify(loopLast[k] ?? null) === JSON.stringify(settings[k]));
  return {
    file,
    run_at: s.run_at,
    settings,
    observed_log: s.prefs_in_menu_item["s8_observed"] ?? null,
    marks: s.marks,
    loop_saw_the_same_settings: loopViewError ? "unknown" : loopSawSame,
    loop_view_error: loopViewError,
    loop_prefs_changes: history.map((h) => ({ seen_at: h.seen_at, ...Object.fromEntries(SETTING_KEYS.map((k) => [k, h.prefs[k] ?? null])) })),
    answered: s.answered,
    jim: answers(s.observations),
  };
}

// The user folder, as written raw, JSON-escaped, and with forward slashes, becomes %USERPROFILE%
// (the S7 collector's rule, spikes\S7\summarize.ts redact()).
function redact(text: string): string {
  const home = os.homedir();
  const forms = [home, home.replaceAll("\\", "\\\\"), home.replaceAll("\\", "/")];
  let out = text;
  for (const form of forms) out = out.replace(new RegExp(form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "%USERPROFILE%");
  return out;
}

/** The loop rewrites this file every 2 s while Lightroom runs (S8Loop.lua writeView). */
const LIVE_FILE = "s8_loop_view.json";
const READ_TRIES = 5;
const RETRY_MS = 300;

/**
 * A JSON file's text once it parses. A file being rewritten can be read half-written (Greptile,
 * PR #40), so a failed parse is read again after RETRY_MS, READ_TRIES times. Returns null if it
 * never parses.
 */
function readSettled(file: string): string | null {
  for (let i = 0; i < READ_TRIES; i++) {
    const text = readFileSync(path.join(srcDir, file), "utf8");
    try {
      JSON.parse(text);
      return text;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RETRY_MS);
    }
  }
  return null;
}

/**
 * Copies the saved files. The live file is skipped, with a note, if it never parses: the settings
 * steps saved stable copies of it (s8_loop_view_<step>_<time>.json). Any other file is written once
 * by the plugin, so a file that does not parse stops the collection.
 */
function copyRedacted(): { copied: string[]; skipped: string[] } {
  mkdirSync(destDir, { recursive: true });
  const copied: string[] = [];
  const skipped: string[] = [];
  for (const f of readdirSync(srcDir)) {
    if (!/^s8_.*\.(json|txt)$/.test(f) || f === "s8_request.txt") continue;
    const raw = f.endsWith(".json") ? readSettled(f) : readFileSync(path.join(srcDir, f), "utf8");
    if (raw === null) {
      if (f !== LIVE_FILE) throw new Error(`${f}: not valid JSON after ${READ_TRIES} reads`);
      skipped.push(`${f}: not valid JSON after ${READ_TRIES} reads (the loop was rewriting it); the settings steps' copies stand for it`);
      continue;
    }
    const text = redact(raw);
    if (f.endsWith(".json")) JSON.parse(text); // still valid JSON after redaction
    if (text.toLowerCase().includes(os.homedir().toLowerCase())) throw new Error(`${f}: user folder still present after redaction`);
    writeFileSync(path.join(destDir, f), text);
    copied.push(f);
  }
  return { copied, skipped };
}

function main(): void {
  const before = settingsFile("before_restart");
  const after = settingsFile("after_restart");
  const kept = before && after ? Object.fromEntries(SETTING_KEYS.map((k) => [k, JSON.stringify(before.settings[k]) === JSON.stringify(after.settings[k])])) : null;
  const summary = {
    source: srcDir,
    hud: hudSummary(),
    settings: {
      before_restart: before ?? { status: "NOT RUN" },
      after_restart: after ?? { status: "NOT RUN" },
      kept_across_restart: kept,
    },
  };
  const { copied, skipped } = copyRedacted();
  const text = redact(JSON.stringify({ ...summary, copied, skipped }, null, 2));
  writeFileSync(path.join(destDir, "s8_summary.json"), text + "\n");
  console.log(text);
  console.log(`\nWrote ${path.join(destDir, "s8_summary.json")}; copied ${copied.length} files, skipped ${skipped.length}.`);
}

main();
