// The Phase 9 local-install check (`npm run phase9:local`, entry phase9-local-cli.ts; plan: vault
// PHASE9_PLAN.md "Jim run 1"; report: docs\reports\phase9\local-install.md). It runs nine steps in this
// Windows account, one after another, each printing what Jim does and checking what it can itself:
//   build (phase9-local-steps.ts), park, install (the 0.99.0 wizard), lightroom, chat,
//   upgrade (the 1.0.0 wizard over a running 0.99.0), uninstall_keep, reinstall_clear, restore
//   (phase9-local-upgrade.ts). Jim's development setup is parked by the clean room (cleanroom-park.ts) in
//   step 2 and put back in step 9. Jim answers y/n in this window, as in Phases 1-8.
// The run resumes (phase9-local-state.ts). A step that cannot go on (stop) ends the run, and the next run
// begins at that step; a step with a failed check goes on, so one run finds everything it can.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { describeError, type Answer } from "./phase1-check.js";
import type { Run as CleanRun } from "./cleanroom-run.js";
import { pathsOf, type Sys } from "./cleanroom-sys.js";
import { headlineOf, nextStep, recordStep, stateToContinue, STEP_IDS, type LocalState, type StepId, type StepRecord } from "./phase9-local-state.js";

export type CleanroomCommand = "--park" | "--verify-gone" | "--restore" | "--status";

/** What a step may use. Everything outside this process (the windows, the clean room, npm) is behind it, so the steps can be run against fakes. */
export type Ctx = {
  sys: Sys;
  repo: string;
  /** The product's version (engine\package.json), and the test build's. */
  version: string;
  testVersion: string;
  /** When the step began: files written before it do not count. */
  since: Date;
  say(line: string): void;
  prompt(text: string): Promise<string | null>;
  cleanroom(command: CleanroomCommand, expectDataGone?: boolean): Promise<CleanRun>;
  /** A shell command (npm run ...) with its output in this window; its exit code. */
  exec(command: string): number;
  /** Starts a program detached (the Deck). */
  startDetached(exe: string): void;
  /** A check; false when it failed. */
  check(name: string, ok: boolean, detail: string): boolean;
  /** A y/n question; with `expected`, the answer is also a check. */
  yn(question: string, expected?: "y" | "n"): Promise<Answer>;
  /** Waits for Enter. */
  pause(text: string): Promise<void>;
  note(text: string): void;
};

export type Step = { id: StepId; title: string; run(ctx: Ctx): Promise<{ stop?: boolean } | void> };

export type LocalDeps = {
  sys: Sys;
  repo: string;
  version: string;
  testVersion: string;
  say(line: string): void;
  prompt(text: string): Promise<string | null>;
  ask(question: string): Promise<Answer>;
  cleanroom(command: CleanroomCommand, expectDataGone?: boolean): Promise<CleanRun>;
  exec(command: string): number;
  startDetached(exe: string): void;
  load(): LocalState | null;
  save(state: LocalState): void;
  stamp: string;
  now?: () => Date;
};

export type LocalOutcome = { headline: "WORKED" | "FAILED" | "NOT FINISHED"; putBack: boolean; finished: boolean; results: Record<string, unknown> };

/** How to give up from any point: everything the check did is undone by these two steps. */
export const GIVE_UP = [
  "To give up at any point and get your development setup back:",
  "  1. If LrC-AVG is listed in Settings > Apps > Installed apps, uninstall it there.",
  "  2. In PowerShell, in D:\\Developer\\LrC_Autonomous_Gateway, run: npm run cleanroom -- --restore",
  "To go on instead, run the same command again: it continues at the step that stopped.",
].join("\n");

function makeCtx(deps: LocalDeps, since: Date, rec: StepRecord): Ctx {
  const check = (name: string, ok: boolean, detail: string): boolean => {
    rec.checks.push({ check: name, ok, detail });
    deps.say(`  [${ok ? "ok" : "FAILED"}] ${name}${detail ? `: ${detail}` : ""}`);
    return ok;
  };
  return {
    sys: deps.sys,
    repo: deps.repo,
    version: deps.version,
    testVersion: deps.testVersion,
    since,
    say: deps.say,
    prompt: deps.prompt,
    cleanroom: deps.cleanroom,
    exec: deps.exec,
    startDetached: deps.startDetached,
    check,
    async yn(question, expected) {
      const answer = await deps.ask(question);
      if (answer === "no answer") throw new Error("the input closed, so the question could not be asked");
      rec.answers.push({ question, answer, expected: expected ?? null });
      if (expected) check(question, answer === expected, `you answered ${answer}, expected ${expected}`);
      return answer;
    },
    async pause(text) {
      if ((await deps.prompt(`${text} Press Enter when done:`)) === null) throw new Error("the input closed, so the step could not wait");
    },
    note: (text) => {
      rec.notes.push(text);
      deps.say(`  ${text}`);
    },
  };
}

/** Runs the next step; a step that throws stops the run with the error as a failed check. */
async function runStep(deps: LocalDeps, step: Step, n: number, state: LocalState): Promise<StepRecord> {
  const now = deps.now ?? (() => new Date());
  const rec: StepRecord = { id: step.id, at: now().toISOString(), ok: false, stopped: false, checks: [], answers: [], notes: [] };
  deps.say("");
  deps.say(`Step ${n} of ${STEP_IDS.length}: ${step.title}`);
  const ctx = makeCtx(deps, now(), rec);
  try {
    const out = await step.run(ctx);
    rec.stopped = out?.stop === true;
  } catch (err) {
    ctx.check("the step ran to the end", false, describeError(err));
    rec.stopped = true;
  }
  rec.ok = rec.checks.every((c) => c.ok) && !rec.stopped;
  recordStep(state, rec);
  deps.save(state);
  deps.say(`  Step ${n}: ${rec.ok ? "ok" : rec.stopped ? "STOPPED" : "FAILED"}`);
  return rec;
}

export async function runLocal(deps: LocalDeps, steps: readonly Step[], options: { fresh?: boolean } = {}): Promise<LocalOutcome> {
  const now = deps.now ?? (() => new Date());
  const { state, resumed } = stateToContinue(deps.load(), now().toISOString(), options.fresh === true);
  state.runs.push(deps.stamp);
  deps.save(state);
  deps.say("LrC-AVG Phase 9 local-install check");
  deps.say(resumed ? `Continuing the check begun ${state.started_at}.` : "This installs the local, unsigned setup on this PC, tries it, uninstalls it and puts your development setup back.");
  deps.say(GIVE_UP);
  const ran: string[] = [];
  for (let id = nextStep(state); id !== null; id = nextStep(state)) {
    const step = steps.find((s) => s.id === id);
    if (!step) throw new Error(`no step ${id}`);
    const rec = await runStep(deps, step, STEP_IDS.indexOf(id) + 1, state);
    ran.push(id);
    if (rec.stopped) break;
  }
  state.finished = nextStep(state) === null;
  deps.save(state);
  const parked = existsSync(pathsOf(deps.sys).parkFile);
  const { headline, putBack } = headlineOf(state, parked);
  const results = { check: "phase9:local", stamp: deps.stamp, resumed, headline, put_back: putBack, finished: state.finished, ran_this_run: ran, finished_at: now().toISOString(), state };
  deps.say("");
  deps.say(`Phase 9 local install: ${headline === "NOT FINISHED" ? "NOT FINISHED (run the command again to continue)" : headline}`);
  deps.say(`  put back: ${putBack ? "YES" : "NO"}${putBack ? "" : " (your development setup is still parked: see the steps above)"}`);
  for (const s of state.steps) deps.say(`  step ${STEP_IDS.indexOf(s.id) + 1} ${s.id}: ${s.ok ? "ok" : s.stopped ? "STOPPED" : "FAILED"}${s.checks.filter((c) => !c.ok).map((c) => `\n      FAILED: ${c.check}`).join("")}`);
  if (headline !== "WORKED") deps.say(GIVE_UP);
  return { headline, putBack, finished: state.finished, results };
}

/** Saves the run's results file; returns its path. */
export function saveResults(dir: string, stamp: string, results: Record<string, unknown>): string {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `local_${stamp}.json`);
  writeFileSync(file, JSON.stringify(results, null, 2) + "\n");
  return file;
}
