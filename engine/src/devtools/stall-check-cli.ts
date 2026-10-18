// `npm run stall:check` (issue #174): does Lightroom stutter without LrC-AVG, with the fixed plugin, and does
// Disable stop the bridge? Run from the repo root with Claude Desktop quit (no engine, as when Jim saw it) and the
// LrC-AVG (dev) plugin disabled. Jim quits and restarts Lightroom (so no bridge is left running from before), uses it
// 2 minutes with the plugin disabled and 2 minutes enabled, answers y/n after each, then disables it; the harness
// waits for the bridge's "stopped (plugin disabled)" line and 30 s of silence. The plugin's lines are summed per
// phase (stall-check.ts). Results, under %TEMP%\LrC-AVG\stall\ (Claude Code collects them):
//   stall_check_<time>.json   answers, the per-phase sums and the bridge lines of the run, user folder redacted

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { describePhase, parseLog, suggest, summarize, type StallEvent } from "./stall-check.js";

const LRC_DIR = path.join(os.tmpdir(), "LrC-AVG");
const PLUGIN_LOG = path.join(LRC_DIR, "bridge.log");
const OUT_DIR = path.join(LRC_DIR, "stall");
const PHASE_SECONDS = 120;
const QUIET_SECONDS = 30;
const CLOSE_SECONDS = 15; // closing the sockets took up to ~12 s in run 1 (stall-174.md, run 1)
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());
type Prompt = (text: string) => Promise<string | null>;

function terminal(): { prompt: Prompt; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (text: string): Promise<string | null> => {
    process.stdout.write(`${text} `);
    const next = await lines.next();
    return next.done ? null : String(next.value).trim();
  };
  return { prompt, close: () => rl.close() };
}

const events = (): StallEvent[] => parseLog(existsSync(PLUGIN_LOG) ? readFileSync(PLUGIN_LOG, "utf8") : "");

function lightroomRunning(): boolean {
  const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq Lightroom.exe", "/NH"], { encoding: "utf8" });
  return /Lightroom\.exe/i.test(out);
}

async function until(test: () => boolean, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if (test()) return true;
    await sleep(1000);
  }
  return test();
}

const firstSince = (kind: StallEvent["kind"], since: number): StallEvent | undefined =>
  events().find((e) => e.kind === kind && e.at >= since);

async function yesNo(prompt: Prompt, text: string): Promise<boolean | null> {
  for (;;) {
    const a = (await prompt(`${text} (y/n)`))?.toLowerCase();
    if (a === null || a === undefined) return null;
    if (a === "y" || a === "n") return a === "y";
  }
}

async function usePhase(prompt: Prompt, name: string): Promise<{ from: number; to: number; stutter: boolean | null }> {
  console.log(`\n${name}: use Lightroom for 2 minutes as you normally would: scroll the Library grid, open photos in Develop, move a few sliders.`);
  const from = Date.now();
  for (let left = PHASE_SECONDS; left > 0; left -= 30) {
    console.log(`  ${left} s left`);
    await sleep(Math.min(30, left) * 1000);
  }
  const to = Date.now();
  return { from, to, stutter: await yesNo(prompt, "Did Lightroom stutter or freeze in these 2 minutes?") };
}

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `stall_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

function fail(results: Record<string, unknown>, why: string): number {
  console.log(`FAILED: ${why}. Nothing more was measured.`);
  Object.assign(results, { worked: false, errors: [why] });
  console.log(`Results saved automatically: ${redact(save(results))}`);
  return 1;
}

/** Steps 1-2: Lightroom quit and started again, then 2 minutes with the plugin disabled. */
async function restartAndBaseline(prompt: Prompt, results: Record<string, unknown>) {
  console.log("Step 1. Quit Lightroom: File > Exit. Waiting until it has fully closed (up to 5 minutes) ...");
  if (!(await until(() => !lightroomRunning(), 300))) return null;
  console.log("Lightroom is closed.\nStep 2. Start Lightroom. Leave LrC-AVG (dev) disabled.");
  if (!(await until(lightroomRunning, 300))) return null;
  await prompt("Press Enter when Lightroom shows your photos.");
  const off = await usePhase(prompt, "Step 3 (LrC-AVG disabled)");
  results["plugin_started_during_baseline"] = events().some((e) => e.kind === "start" && e.at >= off.from && e.at < off.to);
  return off;
}

async function main(prompt: Prompt): Promise<number> {
  const results: Record<string, unknown> = { check: "stall", issue: 174, run: 3, started_at: new Date().toISOString(), node: process.version };
  const off = await restartAndBaseline(prompt, results);
  if (!off) return fail(results, "Lightroom did not close, or did not start again, within 5 minutes");

  console.log("\nStep 4. In Lightroom: File > Plug-in Manager, select LrC-AVG (dev) on the left, click Enable, then Done.");
  const enabledAt = Date.now();
  if (!(await until(() => firstSince("on", enabledAt) !== undefined, 180))) return fail(results, "the plugin did not start within 3 minutes");
  const on = await usePhase(prompt, "Step 5 (LrC-AVG enabled)");

  console.log("\nStep 6. In Lightroom: File > Plug-in Manager, select LrC-AVG (dev), click Disable, then Done.");
  const disabledAt = Date.now();
  const stopped = await until(() => firstSince("stopped", disabledAt) !== undefined, 120);
  const stopAt = firstSince("stopped", disabledAt)?.at ?? Date.now();
  console.log(stopped ? `The bridge stopped. Checking that it stays quiet for ${QUIET_SECONDS} s ...` : "The bridge did NOT report a stop within 2 minutes.");
  if (stopped) await sleep(Math.max(0, stopAt + (CLOSE_SECONDS + QUIET_SECONDS) * 1000 - Date.now()));
  const after = summarize(events(), stopAt + CLOSE_SECONDS * 1000, Date.now());
  const quiet = stopped && after.bridge_lines === 0;

  const sums = { plugin_off: summarize(events(), off.from, off.to), plugin_on: summarize(events(), on.from, on.to), after_stop: after };
  console.log("\n" + describePhase("LrC-AVG disabled", sums.plugin_off, off.stutter));
  console.log(describePhase("LrC-AVG enabled ", sums.plugin_on, on.stutter));
  console.log(`Disable stopped the bridge: ${stopped ? "YES" : "NO"}; quiet afterwards: ${quiet ? "YES" : "NO"} (${after.bridge_lines} line(s))`);
  console.log(`Suggestion (Jim decides): ${suggest(off.stutter, on.stutter, stopped, quiet)}.`);
  if (!quiet) console.log("If Lightroom still stutters now: quit Lightroom and start it again.");
  const since = off.from - 60_000;
  Object.assign(results, {
    worked: true, answers: { stutter_plugin_off: off.stutter, stutter_plugin_on: on.stutter }, disable_stopped: stopped, quiet_after_stop: quiet, phases: sums,
    bridge_log_lines: (existsSync(PLUGIN_LOG) ? readFileSync(PLUGIN_LOG, "utf8") : "").split(/\r?\n/).filter((l) => (parseLog(l)[0]?.at ?? 0) >= since),
  });
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "done".');
  return 0;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
const io = terminal();
main(io.prompt).then(
  (code) => {
    io.close();
    process.exitCode = code;
  },
  (err: unknown) => {
    io.close();
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${redact(save({ check: "stall", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
