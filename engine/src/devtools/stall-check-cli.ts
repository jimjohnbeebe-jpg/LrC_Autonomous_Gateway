// `npm run stall:check` (issue #174): does the bridge's idle rebind make Lightroom stutter? Run from the repo root
// with Lightroom open, the LrC-AVG (dev) plugin disabled and Claude Desktop quit (no engine, as when Jim saw it).
// Jim enables the plugin, uses Lightroom for 2 minutes with the idle rebind on and 2 minutes with it off (the flag
// file of plugin\LrC-AVG.lrplugin\Stall.lua), answers y/n after each, then disables the plugin. The plugin's
// "stall-diag:" lines are summed per phase (stall-check.ts). Results, under %TEMP%\LrC-AVG\stall\ (Claude Code collects them):
//   stall_check_<time>.json   answers, the per-phase sums and the stall-diag and bridge lines of the run, user folder redacted

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { describeError } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { describePhase, parseLog, summarize, type StallEvent } from "./stall-check.js";

const LRC_DIR = path.join(os.tmpdir(), "LrC-AVG");
const PLUGIN_LOG = path.join(LRC_DIR, "bridge.log");
const STATUS_FILE = path.join(LRC_DIR, "bridge_status.json");
const FLAG = path.join(LRC_DIR, "no-idle-rebind"); // Stall.FLAG_FILE
const OUT_DIR = path.join(LRC_DIR, "stall");
const PHASE_SECONDS = 120;
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());

function terminal(): { prompt: (text: string) => Promise<string | null>; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (text: string): Promise<string | null> => {
    process.stdout.write(`${text} `);
    const next = await lines.next();
    return next.done ? null : String(next.value).trim();
  };
  return { prompt, close: () => rl.close() };
}

const readLog = (): string => (existsSync(PLUGIN_LOG) ? readFileSync(PLUGIN_LOG, "utf8") : "");

/** bridge.log lines from `since` (epoch ms) on; they start with local time, as Log.timestamp writes it. */
function linesSince(log: string, since: number): string[] {
  return log.split(/\r?\n/).filter((line) => {
    const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)/.exec(line);
    if (!m) return false;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number) as [number, number, number, number, number, number];
    return new Date(y, mo - 1, d, h, mi, s).getTime() >= since;
  });
}

async function waitFor(kind: StallEvent["kind"], since: number, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds; i++) {
    if (parseLog(readLog()).some((e) => e.kind === kind && e.at >= since)) return true;
    await sleep(1000);
  }
  return false;
}

async function yesNo(prompt: (t: string) => Promise<string | null>, text: string): Promise<boolean | null> {
  for (;;) {
    const a = (await prompt(`${text} (y/n)`))?.toLowerCase();
    if (a === null || a === undefined) return null;
    if (a === "y" || a === "n") return a === "y";
  }
}

async function usePhase(name: string): Promise<{ from: number; to: number }> {
  console.log(`\n${name}: use Lightroom for 2 minutes as you normally would: scroll the Library grid, open photos in Develop, move a few sliders.`);
  const from = Date.now();
  for (let left = PHASE_SECONDS; left > 0; left -= 30) {
    console.log(`  ${left} s left`);
    await sleep(Math.min(30, left) * 1000);
  }
  return { from, to: Date.now() };
}

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `stall_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

async function main(): Promise<number> {
  const io = terminal();
  const started = Date.now();
  const results: Record<string, unknown> = { check: "stall", issue: 174, started_at: new Date(started).toISOString(), node: process.version };
  rmSync(FLAG, { force: true });

  console.log("Step 1. In Lightroom: File > Plug-in Manager, select LrC-AVG (dev) on the left, click Enable, then Done.");
  console.log("        If the button already says Disable, click Reload Plug-in instead.");
  console.log("Waiting for the plugin to start (up to 3 minutes) ...");
  if (!(await waitFor("on", started, 180))) {
    console.log("FAILED: the plugin did not start its stall diagnosis. Nothing was measured.");
    results["worked"] = false;
    results["errors"] = ["no 'stall-diag: on' line in bridge.log within 3 minutes"];
    io.close();
    console.log(`Results saved automatically: ${redact(save(results))}`);
    return 1;
  }
  const status: unknown = existsSync(STATUS_FILE) ? JSON.parse(readFileSync(STATUS_FILE, "utf8")) : null;
  results["engine_connected_at_start"] = (status as { engine_connected?: unknown } | null)?.engine_connected ?? null;
  console.log("Plugin started.");

  const a = await usePhase("Step 2 (idle rebind ON)");
  const stutterA = await yesNo(io.prompt, "Did Lightroom stutter or freeze in these 2 minutes?");

  writeFileSync(FLAG, "issue #174 stall:check\n");
  const flagged = Date.now();
  const offSeen = await waitFor("off", flagged, 15);
  if (!offSeen) console.log("NOTE: the plugin did not report the idle rebind off within 15 s; phase 3 is measured anyway.");
  const b = await usePhase("Step 3 (idle rebind OFF)");
  const stutterB = await yesNo(io.prompt, "Did Lightroom stutter or freeze in these 2 minutes?");
  rmSync(FLAG, { force: true });

  console.log("\nStep 4. In Lightroom: File > Plug-in Manager, select LrC-AVG (dev), click Disable, then Done.");
  await io.prompt("Press Enter when done.");
  io.close();

  const log = readLog();
  const events = parseLog(log);
  const on = summarize(events, a.from, a.to);
  const off = summarize(events, b.from, b.to);
  console.log("\n" + describePhase("Idle rebind ON ", on, stutterA));
  console.log(describePhase("Idle rebind OFF", off, stutterB));
  console.log(`Suggestion (Jim decides): ${on.stalls > off.stalls || on.stall_max_ms > off.stall_max_ms
    ? "the freezes go with the idle rebind" : "the freezes do not go with the idle rebind; look elsewhere"}.`);
  Object.assign(results, {
    worked: true,
    idle_rebind_off_seen: offSeen,
    answers: { stutter_rebind_on: stutterA, stutter_rebind_off: stutterB },
    phases: { rebind_on: { ...on, from: new Date(a.from).toISOString() }, rebind_off: { ...off, from: new Date(b.from).toISOString() } },
    bridge_log_lines: linesSince(log, started - 1000),
  });
  console.log(`Results saved automatically: ${redact(save(results))}`);
  console.log('Nothing to copy. Tell Claude Code "done".');
  return 0;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    rmSync(FLAG, { force: true });
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${redact(save({ check: "stall", errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
