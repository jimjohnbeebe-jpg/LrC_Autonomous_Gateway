// `npm run clients:check` (issue #155 R6; vault ISSUE155_PLAN.md): every installed AI client edits the
// photo selected in Lightroom through the built engine, started by this check, and Jim answers y/n in
// this window (his choice since Phase 1, docs\reports\phase1\PHASE1.md:17). Run from the repo root with
// Lightroom open in Develop on one photo, plugin 0.23.0 or later enabled, Claude Desktop and every other
// AI client quit. The root script builds the Deck first (`npm run deck:build`); this installs it.
//   T2-T4 one edit per client (clients-run.ts); T6 Approve on the Deck, T7 an edit left open
//   (clients-t6t7.ts); then one Claude Desktop chat (clients-desktop.ts). Codex is not run (D4).
// Run again after a stop, it restores any client config a stopped run left edited, puts the photo back,
// sets the Mode back, and continues; `-- --new` starts over. Results, under %TEMP%\LrC-AVG\clients\
// (LRC_AVG_CLIENTS_OUT), user folder redacted:
//   clients_state.json                 what is done so far (the next run continues from it)
//   clients_check_<time>.json          each run's results
//   <client>_<test>_<time>_stdout.txt  each client run's output (and _stderr.txt)
//   logs_<time>\                       the engine's tool and session logs of every client run
//   run\                               the per-run client configs and the backups of Jim's (clients-config.ts)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { defaultHudEndpointPath, hudEndpointSchema } from "../hud/index.js";
import { AI_NAME_PLUGIN } from "../hud/publisher.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { loadDefaultParamMap } from "../params/index.js";
import { restoreLeftovers } from "./clients-config.js";
import { installDeck } from "./clients-deck.js";
import { desktopChat } from "./clients-desktop.js";
import { findClient } from "./clients-launch.js";
import { editRun, putBackAll, runDirOf, type ClientsDeps, type Installed, type Run } from "./clients-run.js";
import { CHECK_CLIENTS, clientsStateSchema, done, rowOf, stateToContinue, TESTS, type CheckClient, type ClientsState } from "./clients-state.js";
import { ensureMode, t6, t7 } from "./clients-t6t7.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";
import { jsonStateStore } from "./phase5-state.js";

const OUT_DIR = process.env["LRC_AVG_CLIENTS_OUT"] || path.join(os.tmpdir(), "LrC-AVG", "clients");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const redact = (text: string): string => redactHome(text, os.homedir());
const NAMES: Record<CheckClient, string> = { "claude-code": "Claude Code", opencode: "OpenCode", hermes: "Hermes", antigravity: "Antigravity" };

function save(results: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `clients_check_${stamp}.json`);
  writeFileSync(file, redact(JSON.stringify({ ...results, node: process.version, engine_version: ENGINE_VERSION }, null, 2)) + "\n");
  return file;
}

/** Questions in this window, from a buffered line iterator (phase8-check-cli.ts terminal(); a CLI module cannot be imported). */
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

/** The pid of an engine that is still running (its HUD endpoint file names it; kit.ts liveEngine), or null. */
function liveEngine(): number | null {
  try {
    const ep = hudEndpointSchema.parse(JSON.parse(readFileSync(defaultHudEndpointPath(), "utf8")));
    process.kill(ep.pid, 0);
    return ep.pid;
  } catch {
    return null;
  }
}

/** Lightroom, the plugin version, the photo, the clients and the Deck; false, with the reason said, when one is missing. */
async function preflight(deps: ClientsDeps, run: Run): Promise<Installed[] | null> {
  const pid = liveEngine();
  if (pid !== null) return stop(run, `another LrC-AVG engine is running (pid ${pid}). Quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit) and every AI client that uses LrC-AVG, then run the command again.`);
  if (!(await deps.gate.start())) return stop(run, "another LrC-AVG engine holds the Lightroom bridge. Quit Claude Desktop and every AI client, then run the command again.");
  try {
    run.results["hello"] = await deps.client.waitConnected(20_000);
  } catch (err) {
    return stop(run, `could not connect to Lightroom (${describeError(err)}). Check that Lightroom is open in Develop and File > Plug-in Manager lists LrC-AVG as Enabled.`);
  }
  const version = (run.results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (!pluginVersionAtLeast(version, AI_NAME_PLUGIN)) return stop(run, `Lightroom runs LrC-AVG plugin ${String(version)}, not ${AI_NAME_PLUGIN} or later: reload it in File > Plug-in Manager.`);
  if (!run.state.photo) {
    const ctx = await deps.client.request("get_context", {});
    run.state.photo = { uuid: ctx.uuid, filename: String(ctx["filename"] ?? ctx.uuid) };
    run.save();
  }
  deps.say(`Connected (plugin ${String(version)}). Every client edits ${run.state.photo.filename}; the check puts it back after each.`);
  const installed: Installed[] = [];
  for (const id of CHECK_CLIENTS) {
    const exe = findClient(id);
    rowOf(run.state, id).not_run = exe ? null : "not installed";
    if (exe) installed.push({ id, exe, name: NAMES[id] });
    deps.say(`  ${NAMES[id]}: ${exe ? "found" : "not installed (not run)"}`);
  }
  run.save();
  const deck = installDeck();
  run.results["deck"] = deck;
  if (!deck.ok) return stop(run, `the Deck: ${String(deck.error)}`);
  deps.say(`  Deck ${String(deck.version)} installed.`);
  return installed;
}

function stop(run: Run, message: string): null {
  run.fail(message);
  return null;
}

/** The tests in order, each client skipping what it has recorded; false when the run stopped first. */
async function tests(deps: ClientsDeps, run: Run, installed: Installed[]): Promise<boolean> {
  const todo = (t: (typeof TESTS)[number]): Installed[] => installed.filter((c) => !done(rowOf(run.state, c.id), t));
  if (run.state.pending.length > 0 && !(await putBackAll(deps, run))) return false;
  if (!(await ensureMode(deps, run, "autonomous"))) return false;
  for (const c of todo("T4")) if (!(await editRun(deps, run, c))) return false;
  if (todo("T6").length > 0) {
    if (!(await ensureMode(deps, run, "approve_each_pass"))) return false;
    for (const c of todo("T6")) await t6(deps, run, c);
    if (!(await ensureMode(deps, run, "autonomous"))) return false;
  }
  for (const c of todo("T7")) if (!(await t7(deps, run, c))) return false;
  if (!run.state.desktop && !(await desktopChat(deps, run))) return false;
  run.state.finished = true;
  run.save();
  return true;
}

/** Every client's tests and the chat, in this window and the results; accepted when every one ran is YES. */
function summary(deps: ClientsDeps, s: ClientsState, results: Record<string, unknown>): boolean {
  const table: Record<string, Record<string, string>> = {};
  let all = s.finished && s.desktop?.ok === true;
  for (const id of CHECK_CLIENTS) {
    const row = rowOf(s, id);
    table[id] = Object.fromEntries(TESTS.map((t) => [t, row.not_run ? "not run" : row[t] ? (row[t].ok ? "YES" : "NO") : "to do"]));
    if (!row.not_run) all = all && TESTS.every((t) => row[t]?.ok === true);
  }
  results["summary"] = { suggestion: s.finished ? (all ? "WORKED" : "FAILED") : "NOT FINISHED", clients: table, desktop: s.desktop ? s.desktop.ok : "to do", pending: s.pending.map((p) => p.label) };
  deps.say("");
  deps.say(`Clients check: ${s.finished ? (all ? "WORKED" : "FAILED") : "NOT FINISHED (run the command again to continue)"}`);
  for (const id of CHECK_CLIENTS) deps.say(`  ${NAMES[id]}: ${Object.entries(table[id] ?? {}).map(([t, v]) => `${t} ${v}`).join(", ")}`);
  deps.say(`  Claude Desktop chat: ${s.desktop ? (s.desktop.ok ? "YES" : "NO") : "to do"}`);
  if (s.pending.length > 0) deps.say(`  NOT put back: ${s.pending.map((p) => `${p.label} (snapshot "${p.snapshot_name}")`).join(", ")}`);
  return all;
}

async function main(): Promise<number> {
  const restored = restoreLeftovers(runDirOf(OUT_DIR)); // first thing: a stopped run's edit of a client config
  const store = jsonStateStore(path.join(OUT_DIR, "clients_state.json"), clientsStateSchema);
  const { state, resumed } = stateToContinue(store.load(), new Date().toISOString(), path.join(OUT_DIR, `logs_${stamp}`), process.argv.includes("--new"));
  state.registrations = []; // restoreLeftovers put back every one listed (clients-config.ts registry)
  state.runs.push(stamp);
  const errors: string[] = [];
  const results: Record<string, unknown> = { check: "clients", started_at: new Date().toISOString(), resumed, state_started_at: state.started_at, restored_configs: restored.map((r) => r.file), errors };
  const io = terminal();
  const say = (line: string): void => console.log(line);
  const run: Run = { results, errors, state, save: () => store.save(state), fail: (m) => (errors.push(m), say(`FAILED: ${m}`)) };
  run.save();
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  const deps: ClientsDeps = { client, gate, map: loadDefaultParamMap(), ask: io.ask, prompt: io.prompt, say, store, outDir: OUT_DIR, stamp, redact };
  say("LrC-AVG clients check");
  if (restored.length > 0) say(`Restored ${restored.length} client config(s) a stopped run had left edited.`);
  if (resumed) say(`Continuing the check begun ${state.started_at}.`);
  try {
    const installed = await preflight(deps, run);
    if (installed) await tests(deps, run, installed);
  } catch (err) {
    run.fail(`the check stopped: ${describeError(err)}`);
    await putBackAll(deps, run).catch(() => false);
  }
  await gate.release();
  io.close();
  results["state"] = state;
  const accepted = summary(deps, state, results);
  console.log(`Results saved automatically: ${save(results)}`);
  console.log(state.finished ? 'Nothing to copy. Tell Claude Code "done".' : "Nothing to copy. Run the same command again to continue, or tell Claude Code what happened.");
  return accepted ? 0 : state.finished ? 1 : 2;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${save({ check: "clients", errors: [describeError(err)] })}`);
    process.exitCode = 1;
  },
);
