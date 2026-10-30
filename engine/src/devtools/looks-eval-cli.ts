// `npm run looks:eval` (Phase 10 row 6; vault PHASE10_PLAN.md "Third re-plan", R2 and R6): the blind evaluation of two
// editing arms on 4-24 photos selected in Lightroom (16 for a conclusive run). Run from the repo root with Lightroom
// open, the plugin enabled, and Claude Desktop and every other LrC-AVG client quit (one engine at a time, issue #211).
//   npm run looks:eval -- --b-intent <id> [--b-tone <m>] [--a-intent <id>] [--a-tone <m>] [--timeout-min 20]
//   npm run looks:eval -- --resume <run or "last">   continue the edits after a stop, then judge
//   npm run looks:eval -- --judge <run>      judge (again after a stop) and reveal
//   npm run looks:eval -- --cleanup <run>    remove the run's virtual copies (never a master)
//   npm run looks:eval -- --look-from <uuid or "selected"> --look-id <id>   save that photo's whole global edit as a v3 user intent
// Everything is saved under %TEMP%\LrC-AVG\looks-eval\<run>\ (run.json, the client outputs, logs\, pair-NN.jpg,
// looks_eval_<time>.json). Pure parts: looks-eval.ts; Lightroom: looks-eval-run.ts, looks-eval-judge.ts.
// Report: docs\reports\phase10\LOOKS-EVAL.md.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { defaultHudEndpointPath, hudEndpointSchema } from "../hud/index.js";
import { IntentLibrary } from "../intents/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION, Tools } from "../mcp/index.js";
import { DECISIONS_PLUGIN } from "../mcp/tools-develop.js";
import { loadDefaultParamMap } from "../params/index.js";
import { PreviewService } from "../preview/index.js";
import { findClient } from "./clients-launch.js";
import type { Run } from "./clients-run.js";
import { newState } from "./clients-state.js";
import { ensureMode } from "./clients-t6t7.js";
import { lookFrom } from "./looks-eval-look.js";
import { headlines, LAST_RUN, lastRun, newRun, parseCli, runId, runSchema, type Choice, type Cli, type EvalRun } from "./looks-eval.js";
import { judgeAll, reveal } from "./looks-eval-judge.js";
import { cleanup, editAll, makeCopies, readMasters, selectedMasters, type EvalCtx, type EvalDeps } from "./looks-eval-run.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { jsonStateStore } from "./phase5-state.js";

const ROOT = path.join(os.tmpdir(), "LrC-AVG", "looks-eval");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());
const say = (line: string): void => console.log(redact(line));

/** Questions in this window from one line iterator (clients-check-cli.ts terminal(); a CLI module cannot be imported). */
function terminal(): { prompt: (t: string) => Promise<string | null>; ask: (q: string) => Promise<Answer>; choose: (q: string) => Promise<Choice | null>; close: () => void } {
  const rl = createInterface({ input: process.stdin, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  const prompt = async (text: string): Promise<string | null> => {
    process.stdout.write(`${text} `);
    const next = await lines.next();
    return next.done ? null : String(next.value).trim();
  };
  const pick = async <T extends string>(question: string, allowed: readonly T[]): Promise<T | null> => {
    for (;;) {
      const a = await prompt(`${question} Type ${allowed.join(" or ")}, then Enter:`);
      if (a === null) return null;
      const up = a.toUpperCase();
      const hit = allowed.find((x) => x.toUpperCase() === up);
      if (hit) return hit;
    }
  };
  return {
    prompt,
    ask: async (q) => (await pick(q, ["y", "n"] as const)) ?? "no answer",
    choose: (q) => pick(q, ["L", "R", "T"] as const),
    close: () => rl.close(),
  };
}

/** Windows' default viewer for the file (`cmd /c start "" <file>`), detached [unverified: not yet run on Jim's PC]. */
function open(file: string): void {
  spawn("cmd", ["/c", "start", "", file], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

/** The pid of an LrC-AVG engine still running (its HUD endpoint file names it; clients-check-cli.ts liveEngine), or null. */
function liveEngine(): number | null {
  try {
    const ep = hudEndpointSchema.parse(JSON.parse(readFileSync(defaultHudEndpointPath(), "utf8")));
    process.kill(ep.pid, 0);
    return ep.pid;
  } catch {
    return null;
  }
}

/** Lightroom connected with a plugin that has remove_photos; the reason when not. */
async function preflight(deps: EvalDeps): Promise<string | null> {
  const pid = liveEngine();
  if (pid !== null) return `another LrC-AVG engine is running (pid ${pid}). Quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit) and every AI client that uses LrC-AVG, then run the command again.`;
  if (!(await deps.gate.start())) return "another LrC-AVG engine holds the Lightroom bridge. Quit Claude Desktop and every AI client, then run the command again.";
  try {
    const hello = await deps.client.waitConnected(20_000);
    if (!pluginVersionAtLeast(hello.plugin_version, DECISIONS_PLUGIN)) return `Lightroom runs LrC-AVG plugin ${String(hello.plugin_version)}, not ${DECISIONS_PLUGIN} or later: reload it in File > Plug-in Manager.`;
    say(`Connected to Lightroom (plugin ${String(hello.plugin_version)}).`);
  } catch (err) {
    return `could not connect to Lightroom (${describeError(err)}). Check that Lightroom is open and File > Plug-in Manager lists LrC-AVG as Enabled.`;
  }
  return null;
}

/** A new run from the selection, saved before anything is written. */
async function begin(deps: EvalDeps, intents: IntentLibrary, cli: Extract<Cli, { mode: "new" }>): Promise<EvalRun> {
  // The headless engines read the settings page's intents folder; this checks the default one [inference: the same unless the page names another].
  for (const a of [cli.armA, cli.armB]) if (a.intent) intents.get(a.intent); // throws when the intent is not found
  const photos = await selectedMasters(deps);
  const id = runId(new Date());
  const dir = path.join(ROOT, id);
  return newRun({ run: id, createdAt: new Date().toISOString(), arms: { A: cli.armA, B: cli.armB }, timeoutMin: cli.timeoutMin, logDir: path.join(dir, "logs"), photos });
}

/** Copies, edits, masters, judging and the reveal, as far as the mode goes; the exit code. */
async function evaluate(ctx: EvalCtx, cli: Cli): Promise<number> {
  const { deps } = ctx;
  if (cli.mode === "cleanup") {
    say(`Removed ${await cleanup(ctx)} virtual copies of run ${ctx.ev.run}.`);
    const untouched = await readMasters(ctx);
    const lines = headlines(ctx.ev).slice(-1);
    say(lines[0] ?? "");
    return finish(ctx, lines, untouched && ctx.clients.errors.length === 0 ? 0 : 1);
  }
  if (cli.mode !== "judge") {
    const exe = findClient("claude-code");
    if (!exe) return stop(ctx, "Claude Code (claude.exe) is not installed for this user; the edits need it.");
    if (!(await ensureMode(deps, ctx.clients, "autonomous"))) return stop(ctx, 'the settings page\'s Mode must be "Autonomous" for unattended edits.');
    await makeCopies(ctx);
    if (!(await editAll(ctx, { id: "claude-code", exe, name: "Claude Code" }))) return stop(ctx, `the edits stopped. Run npm run looks:eval -- --resume last`);
  }
  await readMasters(ctx);
  const judged = await judgeAll(ctx);
  await readMasters(ctx);
  if (!judged) {
    say("Judging not finished. Run npm run looks:eval -- --judge last to continue.");
    return finish(ctx, ["Judging not finished."], 2);
  }
  say("");
  return finish(ctx, reveal(ctx).lines);
}

function stop(ctx: EvalCtx, message: string): number {
  ctx.fail(message);
  return finish(ctx, headlines(ctx.ev), 1);
}

/** The results file; 0 when WORKED. */
function finish(ctx: EvalCtx, lines: string[], code?: number): number {
  const file = path.join(ctx.deps.runDir, `looks_eval_${stamp}.json`);
  const errors = ctx.clients.errors;
  writeFileSync(file, redact(JSON.stringify({ check: "looks-eval", run: ctx.ev.run, lines, errors, node: process.version, engine_version: ENGINE_VERSION, state: ctx.ev }, null, 2)) + "\n");
  say(`Results saved automatically: ${file}`);
  say('Nothing to copy. Tell Claude Code "done".');
  return code ?? (lines[0]?.includes("WORKED") && errors.length === 0 ? 0 : 1);
}

async function main(): Promise<number> {
  let cli: Cli;
  try {
    cli = parseCli(process.argv.slice(2));
  } catch (err) {
    say(`Stopped: ${describeError(err)}. Nothing was written. See the top of engine\\src\\devtools\\looks-eval-cli.ts for the arguments.`);
    return 1;
  }
  const io = terminal();
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const map = loadDefaultParamMap();
  const previews = new PreviewService(client);
  const intents = new IntentLibrary({ map });
  const tools = new Tools({ client, map, previews, intents, sessionLogDir: mkdtempSync(path.join(os.tmpdir(), "lrc-avg-looks-eval-")), engineVersion: ENGINE_VERSION, ensureBridge: (w) => gate.ready(w), hud: false });
  const base = { client, gate, map, tools, previews, ask: io.ask, prompt: io.prompt, choose: io.choose, say, open, redact, stamp, store: { load: () => null, save: () => undefined } };
  const pre: EvalDeps = { ...base, runDir: ROOT, outDir: ROOT };
  try {
    say("LrC-AVG looks evaluation");
    const why = await preflight(pre);
    if (why) {
      say(`Stopped: ${why} Nothing was written.`);
      return 1;
    }
    if (cli.mode === "look") return await lookFrom(pre, cli.uuid, cli.id);
    const run = cli.mode === "new" ? null : cli.run === LAST_RUN ? lastRun(existsSync(ROOT) ? readdirSync(ROOT) : []) : cli.run;
    const ev = cli.mode === "new" ? await begin(pre, intents, cli).catch((err: unknown) => describeError(err)) : run === null ? null : jsonStateStore(path.join(ROOT, run, "run.json"), runSchema).load();
    if (typeof ev === "string" || ev === null) {
      say(`Stopped: ${ev ?? `there is no run ${run ?? LAST_RUN} under ${ROOT}`}`);
      return 1;
    }
    const runDir = path.join(ROOT, ev.run);
    mkdirSync(ev.log_dir, { recursive: true });
    if (cli.mode !== "new" && cli.timeoutMin !== null) ev.timeout_min = cli.timeoutMin;
    const runStore = jsonStateStore(path.join(runDir, "run.json"), runSchema);
    const deps: EvalDeps = { ...base, runDir, outDir: runDir, timeoutMs: ev.timeout_min * 60_000 };
    const errors: string[] = [];
    const save = (): void => runStore.save(ev);
    const fail = (m: string): void => {
      errors.push(m);
      say(`FAILED: ${m}`);
    };
    const clients: Run = { results: {}, errors, fail, state: newState(ev.created_at, ev.log_dir), save };
    save();
    if (cli.mode === "new") say(`Run ${ev.run}: ${ev.photos.length} photos, two copies each. After a stop: npm run looks:eval -- --resume last`);
    const ctx: EvalCtx = { deps, ev, save, fail, clients };
    return await evaluate(ctx, cli).catch((err: unknown) => stop(ctx, `the run stopped: ${describeError(err)}. To continue: npm run looks:eval -- --${cli.mode === "new" ? "resume" : cli.mode} last`));
  } finally {
    await gate.release();
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
    say(`FAILED: ${describeError(err)}`);
    process.exitCode = 1;
  },
);
