// One CLI client's run in the clients check (issue #155 R6), and the edit run that gives T2, T3 and T4:
//   1. the check holds the photo back with its own snapshot (saved in the state; phase8-config.ts
//      holdBack, ported for this state) and gives the Lightroom bridge up;
//   2. it registers the engine in the client (clients-config.ts register: a per-run config, or Jim's
//      config edited after a backup), with LRC_AVG_LOG_DIR set to the run's log folder;
//   3. it starts the client itself with the prompt (clients-launch.ts launchFor), its output to files,
//      never this window, and waits for it to exit; the registration is restored in any case;
//   4. it takes the bridge back (the client's engine exits when its stdin ends [handle:
//      engine\src\mcp\main.ts, `process.stdin.once("end", ...)`]) and reads the run's tool and session logs
//      (clients-judge.ts);
//   5. Jim answers y/n here, and the photo is put back with the check's snapshot.

import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import path from "node:path";
import type { BridgeClient } from "../bridge/index.js";
import type { BridgeGate } from "../mcp/index.js";
import { differingSettings, type CanonicalSettings, type ParamMap } from "../params/index.js";
import { register, restore, type Registration } from "./clients-config.js";
import { clientEntry, launchFor, type Launch } from "./clients-launch.js";
import { editDone, identityLogged, judgeRun, parseSessionLog, sessionFacts, type RunJudgement, type SessionFacts } from "./clients-judge.js";
import { rowOf, testOf, type CheckClient, type ClientsState, type Pending } from "./clients-state.js";
import { describeError, type Answer } from "./phase1-check.js";
import { daysBetween } from "./phase2-collect.js";
import type { Json } from "./phase3-config.js";
import { settingsOf } from "./phase4-config.js";
import type { StateStore } from "./phase5-state.js";
import { sleep, waitFor } from "./phase5-config.js";
import { SELECT_SETTLE_MS } from "./phase8-config.js";

export type ClientsDeps = {
  client: BridgeClient;
  gate: BridgeGate;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  store: StateStore<ClientsState>;
  /** %TEMP%\LrC-AVG\clients (LRC_AVG_CLIENTS_OUT). */
  outDir: string;
  stamp: string;
  redact: (text: string) => string;
  /** A client run not exited after this long is ended (default RUN_TIMEOUT_MS; looks:eval --timeout-min). */
  timeoutMs?: number;
};
export type Run = { results: Json; errors: string[]; fail: (message: string) => void; state: ClientsState; save: () => void };
/** An installed client: its id, executable and name in this window. */
export type Installed = { id: CheckClient; exe: string; name: string };
export type Started = { child: ChildProcess; shell: boolean };
export type ClientRun = { since: number; exit: number | null; timed_out: boolean; error: string | null; stdout: string; judged: RunJudgement; facts: SessionFacts; back: boolean };

/** A client run that has not exited after this long is ended [inference: an edit of 1-6 passes took minutes in Phases 3-8]. */
export const RUN_TIMEOUT_MS = 20 * 60_000;
/** After a client exits, its engine frees the bridge lock within this [inference: the engine exits at stdin end]. */
const BRIDGE_BACK_MS = 90_000;
const SNAPSHOT = (stamp: string): string => `AVG clients check before ${stamp}`;

/** The prompt rule every run shares: the model names itself in `model` (R1), and nothing waits on Jim. */
export const MODEL_LINE = 'In lr_begin_session, set the "model" argument to your own model\'s name.';
export const NO_QUESTIONS = "If a tool says Lightroom is still working, call it again as it says. Do not ask me anything: nobody can answer.";
export const EDIT_PROMPT =
  'Use the lrc-avg MCP tools to edit the photo selected in Lightroom. Call lr_begin_session with intent_id "neutral_technical_correction". ' +
  `${MODEL_LINE} Look at the preview image it returns. Make one pass with lr_step, then call lr_end_session with outcome "accept". ${NO_QUESTIONS} ` +
  "Finally, reply with one sentence that describes what the photo shows.";

/** The folder register() and launchFor() use: one for every run, so the next run's restoreLeftovers finds what a stopped run left. */
export const runDirOf = (outDir: string): string => path.join(outDir, "run");

// --- The photo ----------------------------------------------------------------------------------------------
/** The check's own snapshot of the photo before a client writes to it, saved in the state at once (phase8-config.ts holdBack). */
export async function holdBack(deps: ClientsDeps, run: Run): Promise<Pending> {
  const photo = run.state.photo;
  if (!photo) throw new Error("the check has no photo");
  // Selected again: the prompts name "the photo selected in Lightroom", and Develop loads it first
  // (phase8-config.ts SELECT_SETTLE_MS).
  await deps.client.request("select_photo", { uuid: photo.uuid });
  await sleep(SELECT_SETTLE_MS);
  const held = run.state.pending.find((p) => p.uuid === photo.uuid);
  if (held) return held;
  const start = (await settingsOf(deps, photo.uuid)).settings;
  const snap = await deps.client.request("create_snapshot", { photo_uuid: photo.uuid, name: SNAPSHOT(deps.stamp) });
  const p: Pending = { uuid: photo.uuid, label: photo.filename, snapshot_id: snap.snapshot_id, snapshot_name: SNAPSHOT(deps.stamp), start };
  run.state.pending.push(p);
  run.save();
  return p;
}

/** Puts the photo back with the check's snapshot (phase8-config.ts putBack); the settings that still differ. */
export async function putBack(deps: ClientsDeps, run: Run, p: Pending): Promise<string[]> {
  const res = await deps.client.request("apply_snapshot", { photo_uuid: p.uuid, snapshot_id: p.snapshot_id }, { timeoutMs: 30_000 });
  const differing = differingSettings(deps.map.fromSdk(res.read_back).settings, p.start as CanonicalSettings);
  if (differing.length === 0) {
    run.state.pending = run.state.pending.filter((x) => x.snapshot_id !== p.snapshot_id);
    run.save();
  }
  deps.say(`  ${p.label} put back as before: ${differing.length === 0 ? "YES" : `NO (${differing.join(", ")} differ)`}.`);
  if (differing.length > 0) run.fail(`${p.label} is not back as before: in the Snapshots panel, click "${p.snapshot_name}"`);
  return differing;
}

export async function putBackAll(deps: ClientsDeps, run: Run): Promise<boolean> {
  let all = true;
  for (const p of [...run.state.pending]) {
    try {
      all = (await putBack(deps, run, p)).length === 0 && all;
    } catch (err) {
      all = false;
      run.fail(`${p.label} could not be put back (${describeError(err)}): in the Snapshots panel, click "${p.snapshot_name}"`);
    }
  }
  return all;
}

/** The bridge back once the client's engine has exited; false, with the reason, when it is not. */
export async function takeBridge(deps: ClientsDeps, run: Run, after: string): Promise<boolean> {
  let held = await waitFor(() => deps.gate.start(), BRIDGE_BACK_MS, 500);
  if (held) {
    try {
      await deps.client.waitConnected(20_000);
    } catch (err) {
      held = false;
      run.fail(`after ${after}, Lightroom did not connect again (${describeError(err)})`);
    }
  } else {
    run.fail(`after ${after}, its engine still holds the Lightroom bridge after ${BRIDGE_BACK_MS / 1000} s`);
  }
  return held;
}

// --- The logs -----------------------------------------------------------------------------------------------
/** The tool-log records in `dir` (engine-<yyyymmdd>.jsonl, log\tool-log.ts) of every day from `sinceMs` to now; unreadable lines are skipped. */
export function readToolLog(dir: string, sinceMs: number): unknown[] {
  const out: unknown[] = [];
  for (const day of daysBetween(new Date(sinceMs), new Date())) {
    const file = path.join(dir, `engine-${day}.jsonl`);
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      try {
        if (line.trim()) out.push(JSON.parse(line));
      } catch {
        // a line the engine is still writing
      }
    }
  }
  return out;
}

/** The session log's facts; empty facts when there is none. */
export function factsOf(logPath: string | null): SessionFacts {
  if (!logPath || !existsSync(logPath)) return sessionFacts(null);
  return sessionFacts(parseSessionLog(readFileSync(logPath, "utf8")).log);
}

const TEXT_KEYS = new Set(["result", "text", "response"]);

/** The last non-empty string under a text key, anywhere in a JSON value. */
export function lastText(v: unknown): string | null {
  let found: string | null = null;
  if (Array.isArray(v)) for (const x of v) found = lastText(x) ?? found;
  else if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v)) found = (typeof x === "string" && TEXT_KEYS.has(k) && x.trim() ? x : lastText(x)) ?? found;
  }
  return found;
}

/**
 * A client's last words, for Jim to read here (he opens no files; rule 04): the last text in its JSON
 * output (Claude Code's stream-json "result", OpenCode's text parts [inference: from the --format json
 * flags in clients-launch.ts]), else its last plain lines (Hermes -z).
 */
export function lastWords(file: string, redact: (t: string) => string, n = 12): string[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim());
  let text: string | null = null;
  for (const l of lines) {
    try {
      text = lastText(JSON.parse(l)) ?? text;
    } catch {
      // a plain line
    }
  }
  const shown = text ? text.split(/\r?\n/).filter((l) => l.trim()) : lines;
  return shown.slice(-n).map((l) => redact(l.length > 200 ? `${l.slice(0, 200)}...` : l));
}

// --- The client process -------------------------------------------------------------------------------------
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } catch {
    // gone already
  }
}

/** Starts the launch, its output to files; resolves at its exit, ending it after timeoutMs. */
function spawnAndWait(l: Launch, stdout: string, stderr: string, onStart: (s: Started) => void, timeoutMs = RUN_TIMEOUT_MS): Promise<{ exit: number | null; timed_out: boolean; error: string | null }> {
  const fds = [openSync(stdout, "w"), openSync(stderr, "w")] as const;
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    const finish = (exit: number | null, error: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fds.forEach((fd) => closeSync(fd));
      resolve({ exit, timed_out: timedOut, error });
    };
    const child = spawn(l.file, l.args, { cwd: l.cwd, env: l.env, shell: l.shell, windowsHide: true, stdio: [l.stdin !== undefined ? "pipe" : "ignore", fds[0], fds[1]] });
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, timeoutMs);
    child.on("error", (err) => finish(null, err.message));
    child.on("exit", (code) => finish(code, null));
    if (l.stdin !== undefined) child.stdin?.end(l.stdin);
    onStart({ child, shell: l.shell });
  });
}

/**
 * One run of client `c` with `prompt`: registered, started, waited for, its registration restored, the
 * bridge taken back and its logs read. `during` runs beside it (T7 ends the client from there).
 */
export async function runClient(deps: ClientsDeps, run: Run, c: Installed, prompt: string, tag: string, during?: (s: Started, since: number) => Promise<void>): Promise<ClientRun> {
  const runDir = runDirOf(deps.outDir);
  mkdirSync(runDir, { recursive: true });
  const entry = clientEntry({ LRC_AVG_LOG_DIR: run.state.log_dir });
  const base = path.join(deps.outDir, `${c.id}_${tag}_${deps.stamp}`);
  const since = Date.now();
  let outcome: { exit: number | null; timed_out: boolean; error: string | null } = { exit: null, timed_out: false, error: null };
  let reg: Registration | null = null;
  try {
    reg = register(c.id, entry, runDir);
    if (reg) {
      run.state.registrations.push(reg);
      run.save();
    }
    const l = launchFor(c.id, { exe: c.exe, prompt, entry, runDir });
    let beside: Promise<void> = Promise.resolve();
    outcome = await spawnAndWait(l, `${base}_stdout.txt`, `${base}_stderr.txt`, (s) => {
      beside = during ? during(s, since).catch((err: unknown) => run.fail(`${c.name} (${tag}): ${describeError(err)}`)) : beside;
    }, deps.timeoutMs);
    await beside;
  } catch (err) {
    outcome = { ...outcome, error: describeError(err) };
  } finally {
    if (reg) {
      const file = reg.file;
      restore(reg);
      run.state.registrations = run.state.registrations.filter((r) => r.file !== file);
      run.save();
    }
  }
  const back = await takeBridge(deps, run, `${c.name} (${tag})`);
  const judged = judgeRun(readToolLog(run.state.log_dir, since), since);
  return { since, ...outcome, stdout: `${base}_stdout.txt`, judged, facts: factsOf(judged.log_path), back };
}

/** What a run did, in one line, and the client's last lines of output. */
export function sayRun(deps: ClientsDeps, c: Installed, r: ClientRun): void {
  const j = r.judged;
  const exit = r.timed_out ? `ended after ${RUN_TIMEOUT_MS / 60_000} min` : r.error ? `did not start (${r.error})` : `exited with code ${String(r.exit)}`;
  deps.say(`  ${c.name} ${exit}. Logs: ${j.begun ? `a session began, ${j.passes} pass(es), ended ${j.ended ?? "NO"}` : "NO session began"}; client "${r.facts.client?.name ?? j.client_logged ?? "?"}", model "${r.facts.model ?? "?"}"; ${j.pending_lines} pending line(s).`);
  const lines = lastWords(r.stdout, deps.redact);
  if (lines.length > 0) {
    deps.say(`  ${c.name}'s last words:`);
    for (const l of lines) deps.say(`    | ${l}`);
  }
}

/** T2, T3 and T4 from one edit run; false when input ended (nothing recorded, the next run asks again). */
export async function editRun(deps: ClientsDeps, run: Run, c: Installed): Promise<boolean> {
  const photo = run.state.photo?.filename ?? "the photo";
  deps.say("");
  deps.say(`${c.name}: an edit of ${photo} (T2, T3, T4). ${c.name} starts by itself and shows nothing in this window.`);
  deps.say(`  While it works, watch the Deck's top line: it should show ${c.name}'s name and a model name.`);
  const held = await holdBack(deps, run);
  await deps.gate.release(); // leave the bridge to the client's engine
  const r = await runClient(deps, run, c, EDIT_PROMPT, "edit");
  sayRun(deps, c, r);
  const answers: Record<string, Answer> = {};
  if (r.judged.begun) {
    answers["T3"] = await deps.ask(`T3: ${c.name}'s description is in the last words above. Does it describe ${photo} correctly?`);
    answers["T4"] = await deps.ask(`T4: Are ${c.name}'s changes on the Develop sliders, and does the History panel list a step whose name starts with "AVG"?`);
    answers["T2"] = await deps.ask(`T2: While ${c.name} worked, did the Deck show "${r.facts.deck_line}"?`);
  }
  const differing = r.back ? await putBack(deps, run, held) : ["the bridge"];
  if (Object.values(answers).includes("no answer")) return false;
  const summary = { exit: r.exit, timed_out: r.timed_out, error: r.error, judged: r.judged, facts: r.facts, answers, put_back_differing: differing };
  const row = rowOf(run.state, c.id);
  row.T2 = testOf(answers["T2"] === "y" && identityLogged(r.facts), summary);
  row.T3 = testOf(answers["T3"] === "y" && r.judged.begun, summary);
  row.T4 = testOf(answers["T4"] === "y" && editDone(r.judged), summary);
  run.save();
  deps.say(`  ${c.name}: T2 ${yes(row.T2.ok)}, T3 ${yes(row.T3.ok)}, T4 ${yes(row.T4.ok)}.`);
  return true;
}

export const yes = (b: boolean): string => (b ? "YES" : "NO");
