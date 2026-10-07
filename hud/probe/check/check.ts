// The Phase 7 acceptance check (row 6; vault PHASE7_PLAN.md row 6, plan approved [stated: Jim,
// 2026-10-06, "go"]): `npm run phase7:check`, with Lightroom open in Develop on one selected photo
// (20260907-_OZ80093.NEF, the plan's), plugin 0.18.0 or later, and Claude Desktop quit. Steps for Jim:
// docs\reports\phase7\PHASE7.md. Spec docs\hud\lrc-avg-hud-spec-v2.md 11.1 as 2.7 amends it, and the
// section 9 budgets; summary.ts holds the lines and the verdict.
// It installs the Deck 0.3.2 (hud\ui\deck.ts logs `got` and `painted` for the budgets), then runs the
// steps of summary.ts STEPS in order: five scripted edits (edits-a.ts, edits-b.ts), two Claude Desktop
// chats (chats.ts), the classic fallback and Lightroom's quit (fallback.ts). After each step the photo
// is put back with the check's own snapshot, taken at the first run. It resumes where it stopped:
// finished steps are skipped (`-- --new` starts over; `-- --redo E1,E2,E3` marks those steps unfinished, then goes on with every unfinished step). Lightroom's
// quit (F2) runs only once every other step is finished.
// Results: %TEMP%\LrC-AVG\P7\p7_state.json and the run folder beside it (the Deck's logs, the plugin's
// log, the session logs, p7_summary.json).
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { closeInput, install, installer, lightroomRunning, liveEngine, onInputEnded, stopDeck } from "../kit.ts";
import { deckLogFiles, timings } from "./budgets.ts";
import { c1, c2 } from "./chats.ts";
import { Ctx, OUT, PLUGIN_MANAGER, loadState, saveState } from "./ctx.ts";
import { e1, e2 } from "./edits-a.ts";
import { e3, e4, e5, restoreSpot } from "./edits-b.ts";
import { f1, f2, restoreExe } from "./fallback.ts";
import { STEPS, acceptance, freshState, type StepId } from "./summary.ts";

const RUN: Record<StepId, (ctx: Ctx) => Promise<void>> = { E1: e1, E2: e2, E3: e3, E4: e4, E5: e5, C1: c1, C2: c2, F1: f1, F2: f2 };
const argv = process.argv.slice(2);
const redo = argv.includes("--redo") ? (argv[argv.indexOf("--redo") + 1] ?? "").split(",").filter(Boolean) : [];
const stop = (why: string): never => {
  console.log(`\nPhase 7 check: FAILED before it started. ${why}`);
  process.exit(1);
};
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

if (redo.some((id) => !STEPS.some((s) => s.id === id))) stop(`--redo takes steps, comma-separated: ${STEPS.map((s) => s.id).join(", ")}.`);
if (!lightroomRunning()) stop("Lightroom is not running: open Lightroom in Develop, then run this again.");
if (liveEngine() !== null) stop("Claude Desktop's engine is running: quit Claude Desktop (right-click the Claude icon in the Windows system tray > Quit), then run this again.");
const setup = installer() ?? stop("The Deck's installer 0.3.2 is not built: Claude Code runs `npm run deck:build` first.");

// The saved state is used as it is until everything it holds out is back: the Deck renamed, window.json
// replaced, the photo edited. Only then does `--new` replace it (ctx.reset), so a run stopped on the way
// keeps all of it for the next start (Greptile, PR #91, reviews 1 and 2).
const prior = loadState();
const run = new Date().toISOString().replace(/[:.]/g, "-");
const fresh = prior === null || argv.includes("--new");
const ctx = new Ctx(prior ?? freshState(run, Date.now()));
const state = ctx.state;
if (state.renamed) restoreExe(ctx);
restoreSpot(ctx);
// A step's error stays until that step finishes; the rest belong to the run that wrote them.
for (const k of Object.keys(state.errors)) if (!STEPS.some((s) => s.id === k)) delete state.errors[k];
saveState(state);
console.log("Phase 7 check. Installing the Deck 0.3.2 (per user, no admin rights needed)...");
stopDeck();
install(setup);

let wrapping: Promise<never> | null = null;
const wrapUp = (why: string | null): Promise<never> => (wrapping ??= finish(why));
process.on("SIGINT", () => void wrapUp("stopped with Ctrl+C"));
onInputEnded(() => void wrapUp("input ended"));

try {
  if (!(await ctx.start(0))) stop("Another engine holds the Lightroom bridge: quit Claude Desktop, wait a minute, then run this again.");
  await firstPhoto();
  if (state.mode_changed) await ctx.ensureMode("autonomous");
  // `--redo` steps count as unfinished from here on (run 1, 2026-10-07: E1-E3 asked again after the check's fixes).
  state.done = state.done.filter((d) => !redo.includes(d));
  const todo = STEPS.filter((s) => !state.done.includes(s.id));
  for (const step of todo) {
    if (step.id === "F2" && STEPS.some((s) => s.id !== "F2" && !state.done.includes(s.id))) {
      ctx.say("Lightroom's quit (the last step) waits until every other step has finished.");
      break;
    }
    ctx.say(`=== ${step.title} ===`);
    // A step counts as finished only when this run of it finishes (Greptile, PR #91: a failed --redo).
    state.done = state.done.filter((d) => d !== step.id);
    delete state.errors[step.id];
    ctx.save();
    try {
      await RUN[step.id](ctx);
      if (step.id !== "F2") await ctx.putBack(step.id);
      state.done = [...state.done.filter((d) => d !== step.id), step.id];
      ctx.save();
    } catch (err) {
      state.errors[step.id] = message(err);
      ctx.save();
      ctx.say(`ERROR in ${step.id}: ${message(err)}`);
      break;
    }
  }
} catch (err) {
  state.errors["start"] = message(err);
  ctx.say(`ERROR: ${message(err)}`);
}
await wrapUp(null);

/** The first run records the selected photo, its settings and the check's own snapshot; a later run puts it back first. */
async function firstPhoto(): Promise<void> {
  const e = ctx.engine();
  // `--new` after a stopped run: that run's photo goes back to its start before anything is recorded.
  if (state.photo) {
    await ctx.selectPhoto();
    if (!(await ctx.putBack(null))) throw new Error(`${state.photo.filename} could not be put back as it was before the check`);
  }
  // `--new`, now that the last run's photo is back: a new state, keeping what is still out in the catalog
  // and the settings page (copies to remove, the Mode to set back).
  if (fresh && prior) ctx.reset({ ...freshState(run, Date.now()), copies: [...state.copies], mode_changed: state.mode_changed });
  if (state.photo) return;
  const sel = await e.client.request("get_selection", { max: 2 });
  const p = sel.count === 1 ? sel.photos[0] : undefined;
  if (!p?.uuid) throw new Error(`select exactly one photo in Lightroom (${sel.count} selected), then run this again.`);
  const start = await ctx.settings(p.uuid);
  const snap = await e.client.request("create_snapshot", { photo_uuid: p.uuid, name: `AVG P7check start ${state.run}` });
  state.photo = { uuid: p.uuid, filename: p.filename ?? "the selected photo", snapshot_id: snap.snapshot_id, start };
  ctx.save();
  ctx.say(`The check's photo: ${state.photo.filename}. A snapshot "AVG P7check start ${state.run}" holds it as it is now.`);
}

async function finish(why: string | null): Promise<never> {
  if (why) {
    state.errors["stopped"] = why;
    ctx.say(`${why}: putting things back first...`);
  }
  // No new edit call starts; the one in flight finishes before the put-back (Greptile, PR #91).
  ctx.stopping = true;
  await ctx.settle(60_000);
  try {
    // Stopped during a chat: the bridge is Claude Desktop's until it lets go; take it back if it is free.
    if (!ctx.hasEngine() && state.photo && lightroomRunning()) await ctx.start(0);
    if (ctx.hasEngine() && state.photo && lightroomRunning()) await ctx.putBack(null);
    else if (state.photo && !state.done.includes("F2")) state.errors["put_back"] = "not tried: the bridge or Lightroom was not there; the next run puts the photo back first";
  } catch (err) {
    state.errors["put_back"] = message(err);
  }
  try {
    if (state.renamed) restoreExe(ctx);
    restoreSpot(ctx);
  } catch (err) {
    state.errors["restore"] = message(err);
  }
  await ctx.release().catch(() => undefined);
  closeInput();
  report();
  return process.exit(why ? 130 : 0);
}

function report(): void {
  ctx.save();
  const deckDir = path.join(ctx.dir, "deck");
  mkdirSync(deckDir, { recursive: true });
  for (const { file } of deckLogFiles(state.started)) copyFileSync(file, path.join(deckDir, path.basename(file)));
  writeFileSync(path.join(ctx.dir, `plugin-log_${run}.txt`), ctx.plog.text());
  const t = timings(state, path.join(ctx.dir, "sessions"));
  const a = acceptance(state, t);
  writeFileSync(path.join(ctx.dir, "p7_summary.json"), JSON.stringify({ at: new Date().toISOString(), ...a, timings: t, errors: state.errors, done: state.done }, null, 2));
  console.log("\nLines:");
  for (const l of a.lines) console.log(`  ${l.line.padEnd(8)} ${l.result}${l.failed.length ? ` (${l.failed.join(", ")})` : ""}`);
  console.log("Budgets (spec 9):");
  for (const b of a.budgets) console.log(`  ${b.id.padEnd(13)} ${b.value === null ? "not measured" : `${b.value.toFixed(b.unit === "ms" ? 0 : 2)} ${b.unit}`} (target ${b.target} ${b.unit}, n=${b.n})  ${b.ok === null ? "NOT MEASURED" : b.ok ? "YES" : "OVER"}`);
  for (const [k, v] of Object.entries(state.errors)) console.log(`  error in ${k}: ${v}`);
  if (state.mode_changed) console.log(`\nThe settings page's Mode may still be "Approve each pass". Set it back: ${PLUGIN_MANAGER} "Autonomous", then click Done. (The next run checks it.)`);
  const left = STEPS.filter((s) => !state.done.includes(s.id)).map((s) => s.id);
  console.log(`\n${a.headline}`);
  console.log(left.length ? `Steps left: ${left.join(", ")}. Run \`npm run phase7:check\` again to go on.` : "Every step has run.");
  console.log(`Results saved automatically in ${OUT}. Tell Claude Code "done".`);
}

