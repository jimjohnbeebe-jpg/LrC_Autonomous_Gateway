// `npm run ai:probe`: the AI mask probe from the command line (the runs are in ai-probe.ts; issue #123). Run from
// the repo root with Lightroom in Develop on one photo with trees or shrubs (that photo alone selected), the
// LrC-AVG plugin loaded, and Claude Desktop quit (this takes the engine's instance lock). Jim answers y/n
// questions in this window, not in Lightroom dialogs, since a hung Lightroom shows none [stated: Jim,
// 2026-10-11, "go" to the plan's decision 4]. A snapshot "AVG ai-probe before" is taken first and applied after
// each run. When Lightroom must be restarted, the command says so and stops; run it again after the restart
// and it goes on where it stopped (`-- --new` starts over). Under %TEMP%\LrC-AVG\ai-probe\ (Claude Code collects them):
//   state.json                       the runs so far (what a second start goes on from)
//   ai_probe_<time>.json             the results, saved at every stop
//   ai_probe_bridge_log_<time>.txt   a copy of the plugin's log, user folder redacted
//   shot_<run>_<what>_<time>.png     screenshots of the whole screen, taken by the probe

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { BridgeClient, pluginVersionAtLeast } from "../bridge/index.js";
import { acquireInstanceLock, BridgeGate, devOverrides, ENGINE_VERSION } from "../mcp/index.js";
import { differingSettings, loadDefaultParamMap, type SdkSettings } from "../params/index.js";
import { RUNS, runOne, type RunResult } from "./ai-probe.js";
import { describeError, type Answer } from "./phase1-check.js";
import { redactHome } from "./phase2-check.js";

const OUT_DIR = path.join(os.tmpdir(), "LrC-AVG", "ai-probe");
const STATE = path.join(OUT_DIR, "state.json");
const PLUGIN_LOG = path.join(os.tmpdir(), "LrC-AVG", "bridge.log");
/** update_ai_settings' `watch` and the plugin's guard (Pending.lua). */
const MIN_PLUGIN = "0.16.0";
const stamp = (): string => new Date().toISOString().replace(/[:.]/g, "-");
const started = stamp();
const redact = (text: string): string => redactHome(text, os.homedir());

type Answers = { dialog_open: Answer; dialog_seen: Answer; responds: Answer; screenshot?: string };
type Run = RunResult & { answers: Answers; put_back: { ok: boolean; why: string } | null };
/** `running`: the run whose mask went out and has no saved result yet (the command stopped during it): put back, then run again. */
type State = { started: string; photo: { uuid: string; filename: string }; snapshot_id: string; process: string | null; restarts: number; before_sdk: SdkSettings; runs: Run[]; running: string | null; done: boolean };

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

/**
 * The whole screen as a PNG (every monitor), by PowerShell and .NET: the dialog's text, without asking Jim for a
 * screenshot (rule 04). DPI-aware first, so a scaled screen is not cut off [inference]. Blocks for about a second.
 */
function shot(label: string): string {
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `shot_${label}_${stamp()}.png`);
  const ps = [
    `Add-Type -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -Name Dpi -Namespace AvgProbe`,
    "[void][AvgProbe.Dpi]::SetProcessDPIAware()",
    "Add-Type -AssemblyName System.Windows.Forms, System.Drawing",
    "$b = [System.Windows.Forms.SystemInformation]::VirtualScreen",
    "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
    "$g = [System.Drawing.Graphics]::FromImage($bmp)",
    "$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)",
    `$bmp.Save('${file}', [System.Drawing.Imaging.ImageFormat]::Png)`,
  ].join("; ");
  try {
    execFileSync("powershell", ["-NoProfile", "-Command", ps], { timeout: 20_000, stdio: "ignore" });
    return path.basename(file);
  } catch (err) {
    return `no screenshot: ${describeError(err)}`;
  }
}

function save(st: State | null, extra: Record<string, unknown>): string {
  mkdirSync(OUT_DIR, { recursive: true });
  if (st) writeFileSync(STATE, JSON.stringify(st, null, 2) + "\n");
  const results: Record<string, unknown> = { check: "ai-probe", ...extra, state: st, node: process.version, engine_version: ENGINE_VERSION };
  if (existsSync(PLUGIN_LOG)) {
    const copy = path.join(OUT_DIR, `ai_probe_bridge_log_${started}.txt`);
    writeFileSync(copy, redact(readFileSync(PLUGIN_LOG, "utf8")));
    results["plugin_log_copied"] = path.basename(copy);
  }
  const file = path.join(OUT_DIR, `ai_probe_${started}.json`);
  writeFileSync(file, redact(JSON.stringify(results, null, 2)) + "\n");
  return file;
}

const RESTART = (filename: string): string[] => [
  "Lightroom needs a restart before the next run:",
  "  1. In Lightroom: File > Exit. If it has not closed after 1 minute: press Ctrl+Shift+Esc, select Adobe Lightroom Classic, click End task.",
  `  2. Start Lightroom, open Develop, and select ${filename} (only that photo).`,
  "  3. Run the same command again: npm run ai:probe",
];

async function begin(client: BridgeClient, io: ReturnType<typeof terminal>): Promise<State> {
  const sel = await client.request("get_selection", { max: 2 });
  const photo = sel.photos[0];
  if (sel.count !== 1 || !photo?.uuid) throw new Error(`select one photo in Lightroom's Develop (${sel.count} selected), then run this again.`);
  const answer = await io.ask(`The probe runs on ${photo.filename ?? photo.uuid}. Does it show trees, shrubs or grass?`);
  if (answer !== "y") throw new Error("select a photo with trees, shrubs or grass in Develop, then run this again.");
  const before_sdk = (await client.request("get_settings", { photo_uuid: photo.uuid })).settings;
  const snap = await client.request("create_snapshot", { target_uuid: photo.uuid, name: "AVG ai-probe before" });
  return { started, photo: { uuid: photo.uuid, filename: photo.filename ?? photo.uuid }, snapshot_id: snap.snapshot_id, process: client.hello()?.process_started_at ?? null, restarts: 0, before_sdk, runs: [], running: null, done: false };
}

/** The photo back to the snapshot, checked as the engine's revert checks it (session\end.ts): settings and masks. */
async function putBack(client: BridgeClient, st: State): Promise<{ ok: boolean; why: string }> {
  try {
    await client.request("select_photo", { uuid: st.photo.uuid });
    const res = await client.request("apply_snapshot", { target_uuid: st.photo.uuid, snapshot_id: st.snapshot_id });
    const map = loadDefaultParamMap();
    const [before, after] = [map.fromSdk(st.before_sdk), map.fromSdk(res.read_back)];
    const differing = [...differingSettings(before.settings, after.settings), ...(before.masks.fingerprint !== after.masks.fingerprint ? ["masks"] : [])];
    return { ok: differing.length === 0, why: differing.length ? `differing: ${differing.join(", ")}` : "settings and masks as before" };
  } catch (err) {
    return { ok: false, why: describeError(err) };
  }
}

async function questions(io: ReturnType<typeof terminal>, run: string): Promise<Answers> {
  const open = await io.ask("Is a Lightroom error dialog open right now?");
  let screenshot: string | undefined;
  if (open === "y") {
    screenshot = shot(`${run}_dialog`);
    await io.prompt("Screenshot taken. Click OK in Lightroom's dialog, then press Enter here:");
  }
  const seen = open === "y" ? "y" : await io.ask("Did a Lightroom error dialog show at any time during this run?");
  const responds = await io.ask("Does Lightroom respond now? In Develop, click the Basic panel's header (click it again to put it back): did it fold and unfold?");
  return { dialog_open: open, dialog_seen: seen, responds, ...(screenshot ? { screenshot } : {}) };
}

function load(): State | null {
  if (process.argv.includes("--new") || !existsSync(STATE)) return null;
  return JSON.parse(readFileSync(STATE, "utf8")) as State;
}

async function main(say: (line: string) => void): Promise<number> {
  let st = load();
  if (st?.done) {
    say("The probe is finished already (all three runs). To run it again from the start: npm run ai:probe -- --new");
    return 0;
  }
  const io = terminal();
  const dev = devOverrides();
  const client = new BridgeClient({ engineVersion: ENGINE_VERSION, log: (m) => console.error(`  (${m})`), ...dev.bridge });
  const gate = new BridgeGate(client, () => acquireInstanceLock(dev.lockPort));
  try {
    await gate.ready();
    const version = client.hello()?.plugin_version;
    if (!pluginVersionAtLeast(version, MIN_PLUGIN)) throw new Error(`Lightroom runs plugin ${String(version)}, not ${MIN_PLUGIN} or later.`);
    if (!st) {
      st = await begin(client, io);
      save(st, {}); // the snapshot on disk before anything is written (Greptile, PR #132)
    } else {
      const now = client.hello()?.process_started_at ?? null;
      if (now !== st.process) [st.process, st.restarts] = [now, st.restarts + 1];
      say(`Going on with ${st.photo.filename}: ${st.runs.length} of ${RUNS.length} runs done${st.restarts ? `, Lightroom restarted ${st.restarts} time(s)` : ""}.`);
    }
    const last = st.runs.at(-1);
    if (st.running !== null || (last && !last.put_back?.ok)) {
      const pb = await putBack(client, st);
      if (last && st.running === null) last.put_back = pb;
      say(`Put back after ${st.running ?? last?.run}${st.running ? " (stopped before its result; it runs again)" : ""}: ${pb.ok ? "YES" : `NO (${pb.why})`}`);
      if (!pb.ok) return stop(st, say, "the photo could not be put back");
      st.running = null;
      save(st, {});
    }
    for (const spec of RUNS.slice(st.runs.length)) {
      say(`Run ${st.runs.length + 1} of ${RUNS.length}: ${spec.kind}, ${spec.reads ? "reading as the engine does" : "no reads while Lightroom computes"}. Up to 3 minutes; do not click in Lightroom.`);
      st.running = spec.id;
      save(st, {});
      const r = await runOne({ client, uuid: st.photo.uuid, shot, say }, spec);
      say(`  Outcome: ${r.outcome} (${Math.round(r.t_ms / 1000)} s)`);
      const run: Run = { ...r, answers: await questions(io, spec.id), put_back: null };
      st.runs.push(run);
      st.running = null;
      save(st, {});
      if (run.answers.responds !== "y" || !client.hello()) return stop(st, say, "Lightroom does not respond");
      run.put_back = await putBack(client, st);
      say(`  Put back: ${run.put_back.ok ? "YES" : `NO (${run.put_back.why})`}`);
      if (!run.put_back.ok) return stop(st, say, "the photo could not be put back");
    }
    st.done = true;
    say("");
    for (const r of st.runs) say(`  ${r.run}: ${r.outcome}; dialog ${r.answers.dialog_seen}; Lightroom responding ${r.answers.responds}; put back ${r.put_back?.ok ? "YES" : "NO"}`);
    say(`AI mask probe: DONE, ${st.runs.length} of ${RUNS.length} runs, photo put back: YES`);
    say(`Results saved automatically: ${redact(save(st, { suggestion: "DONE" }))}`);
    say('Nothing to copy. Tell Claude Code "done".');
    return 0;
  } finally {
    io.close();
    await gate.release();
  }
}

function stop(st: State, say: (line: string) => void, why: string): number {
  say(`AI mask probe: STOPPED after run ${st.runs.length} of ${RUNS.length} (${why}).`);
  for (const line of RESTART(st.photo.filename)) say(line);
  say(`Results so far saved automatically: ${redact(save(st, { suggestion: "STOPPED", why }))}`);
  return 2;
}

// exitCode, not process.exit(): exiting at once can cut off the last lines of output on Windows
// [inference from a Phase 1 dry run on 2026-09-26; phase1-check-cli.ts].
main((line) => console.log(line)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    console.error(`FAILED: ${describeError(err)}`);
    console.log(`Results saved automatically: ${redact(save(load(), { errors: [describeError(err)] }))}`);
    process.exitCode = 1;
  },
);
