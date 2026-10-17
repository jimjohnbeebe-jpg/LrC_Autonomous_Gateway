// `npm run phase9:local`: the Phase 9 local-install check from the command line (the steps are in
// phase9-local-steps.ts and phase9-local-upgrade.ts, the runner in phase9-local.ts; report
// docs\reports\phase9\local-install.md). Run from the repo root in PowerShell, with nothing else going on
// in Lightroom or Claude Desktop. It builds the two local setups when they are missing, moves the
// development setup aside (the clean room), installs and uninstalls LrC-AVG as a user would, and puts
// everything back; Jim does the clicking and answers y/n here. Run again after a stop, it continues at the
// step that stopped; `-- --new` starts over. Results, all under %TEMP%\LrC-AVG-phase9\ (LRC_AVG_P9_OUT),
// user folder redacted (Claude Code collects them; nothing to copy by hand):
//   local-state.json       what is done so far (the next run continues from it)
//   local_<time>.json      each run's results: the headline (WORKED/FAILED, put back YES/NO) and every check and answer
//   %TEMP%\LrC-AVG\cleanroom\*.json   the clean room's own runs (cleanroom-run.ts saveRun)

import { execSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { runCleanroom, saveRun } from "./cleanroom-run.js";
import { realSys } from "./cleanroom-sys.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { jsonStateStore } from "./phase5-state.js";
import { GIVE_UP, runLocal, saveResults, type LocalDeps, type Step } from "./phase9-local.js";
import { localStateSchema } from "./phase9-local-state.js";
import { chatStep, installStep, lightroomStep, buildStep, parkStep } from "./phase9-local-steps.js";
import { reinstallClearStep, restoreStep, uninstallKeepStep, upgradeStep } from "./phase9-local-upgrade.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// Beside %TEMP%\LrC-AVG, never in it: the clean room parks and scans that folder and a ticked uninstall deletes it.
const OUT_DIR = process.env["LRC_AVG_P9_OUT"] || path.join(os.tmpdir(), "LrC-AVG-phase9");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
/** The test build's number (npm run setup:build -- --version 0.99.0): below the product's, so the second setup is an upgrade. */
const TEST_VERSION = "0.99.0";
const STEPS = [buildStep, parkStep, installStep, lightroomStep, chatStep, upgradeStep, uninstallKeepStep, reinstallClearStep, restoreStep];
/** `-- --quick`: install, Lightroom, chat, one uninstall, restore; the upgrade and the second uninstall are skipped and say so. */
const QUICK_SKIP: ReadonlySet<string> = new Set(["upgrade", "reinstall_clear"]);
const skipped = (s: Step): Step => ({ id: s.id, title: `${s.title} (skipped: --quick)`, run: async (ctx) => ctx.note("Skipped by --quick.") });

/** Questions and prompts in this window, from a buffered line iterator (phase8-check-cli.ts terminal(); a CLI module cannot be imported). */
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

const redact = (text: string): string => redactHome(text, os.homedir());

/** A shell command with its output in this window; its exit code. stdin is not given to it: this window's answers are for the check. */
function exec(command: string): number {
  try {
    execSync(command, { cwd: REPO, stdio: ["ignore", "inherit", "inherit"] });
    return 0;
  } catch (err) {
    const status = (err as { status?: unknown }).status;
    return typeof status === "number" ? status : 1;
  }
}

async function main(): Promise<number> {
  const unknown = process.argv.slice(2).filter((a) => a !== "--new" && a !== "--quick");
  if (unknown.length > 0) {
    console.error(`unknown argument ${unknown.join(" ")}. Usage: npm run phase9:local [-- --new] [--quick]`);
    return 2;
  }
  const version = z.object({ version: z.string() }).parse(JSON.parse(readFileSync(path.join(REPO, "engine", "package.json"), "utf8"))).version;
  const sys = realSys();
  const io = terminal();
  const store = jsonStateStore(path.join(OUT_DIR, "local-state.json"), localStateSchema);
  const deps: LocalDeps = {
    sys,
    repo: REPO,
    version,
    testVersion: TEST_VERSION,
    say: (line) => console.log(line),
    prompt: io.prompt,
    ask: io.ask,
    cleanroom: async (command, expectDataGone = false) => {
      const run = await runCleanroom(sys, command, false, expectDataGone);
      saveRun(sys, run);
      return run;
    },
    exec,
    startDetached: (exe) => spawn(exe, [], { detached: true, stdio: "ignore" }).unref(),
    load: () => store.load(),
    save: (state) => store.save(state),
    stamp,
  };
  try {
    const steps = process.argv.includes("--quick") ? STEPS.map((s) => (QUICK_SKIP.has(s.id) ? skipped(s) : s)) : STEPS;
    const outcome = await runLocal(deps, steps, { fresh: process.argv.includes("--new") });
    console.log(`Results saved automatically: ${saveResults(OUT_DIR, stamp, JSON.parse(redact(JSON.stringify(outcome.results))) as Record<string, unknown>)}`);
    console.log(outcome.finished ? 'Nothing to copy. Tell Claude Code "done".' : "Nothing to copy. Run the same command again to continue, or tell Claude Code what happened.");
    return outcome.headline === "WORKED" ? 0 : outcome.headline === "FAILED" ? 1 : 2;
  } finally {
    io.close();
  }
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(GIVE_UP);
    console.log(`Results saved automatically: ${saveResults(OUT_DIR, stamp, { check: "phase9:local", errors: [redact(describeError(err))] })}`);
    process.exitCode = 1;
  },
);
