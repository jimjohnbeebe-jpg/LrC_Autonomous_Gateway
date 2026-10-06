// The Deck shell probe (Phase 7 row 4b; spec docs\hud\lrc-avg-hud-spec-v2.md 2.7, acceptance lines A1,
// A5, A7, A9, A12 as amended there). Run by Jim as `npm run deck:probe`, with Lightroom open in Develop
// and Claude Desktop quit. Steps for Jim: docs\reports\phase7\deck-shell.md.
// A stand-in engine (the engine's own HudChannel and HudLauncher) sends made-up states: no photo is
// edited and nothing is written to the catalog [stated: Jim, 2026-10-05, "Go with recommendations", to
// plan decision 1]. Jim answers y/n here in PowerShell (decision 2). What the Deck logs is checked too.
// Results: %TEMP%\LrC-AVG\deck-probe\probe_<run>.json, with a copy of the Deck's log. It installs the
// Deck at the start and uninstalls it at the end (kit.ts `uninstall` says why).
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { HudLauncher, findHudExe } from "../../engine/dist/hud/launch.js";
import {
  StandIn, WINDOW_JSON, closeInput, deckLog, enter, events, install, installer, lightroomRunning, liveEngine, stopDeck, uninstall, waitEvent, yes,
  type DeckEvent,
} from "./kit.ts";

type Line = { id: string; what: string; ok: boolean | null; detail?: unknown };
const run = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(tmpdir(), "LrC-AVG", "deck-probe");
const results: Line[] = [];
const record = (id: string, what: string, ok: boolean | null, detail?: unknown): void => {
  results.push({ id, what, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`  ${ok === null ? "NOT RUN" : ok ? "YES" : "NO "}  ${id} ${what}`);
};
const stop = (why: string): never => {
  console.log(`\nDeck shell probe: FAILED before it started. ${why}`);
  process.exit(1);
};

if (!lightroomRunning()) stop("Lightroom is not running: open Lightroom in Develop, then run this again.");
if (liveEngine() !== null) stop("Claude Desktop's engine is running: quit Claude Desktop (File > Exit), then run this again.");
const setup = installer() ?? stop("The Deck's installer is not built yet: Claude Code runs `npm run deck:build` first.");

console.log("Deck shell probe. Installing the Deck (per user, no admin rights needed)...");
stopDeck();
install(setup);
const found = findHudExe();
record("C1", "the installer put the Deck where the engine looks for it", found !== null, found);
const exe = found ?? stop("The Deck is not where the engine looks for it.");
// The Deck is removed however the probe ends: a stop, an error, or Ctrl+C (Greptile, PR #87). An exit
// handler runs only synchronous code, which closing the channel and uninstalling are (kit.ts).
let engine: StandIn | null = null;
let removed: boolean | null = null;
const removeDeck = (): boolean => {
  if (removed === null) {
    engine?.channel.close();
    stopDeck();
    removed = uninstall(exe);
  }
  return removed;
};
process.once("exit", () => {
  if (removed === null) console.log(`The Deck was ${removeDeck() ? "" : "NOT "}uninstalled.`);
});
process.once("SIGINT", () => process.exit(130));
rmSync(WINDOW_JSON, { force: true }); // the first-run position is checked first

engine = new StandIn();
await engine.channel.open();
const launcher = new HudLauncher();
const started = Date.now();
const log = (): string | null => deckLog(started);
const after = (t: number, ev: string, reason?: string) => waitEvent(log, t, (e: DeckEvent) => e.ev === ev && (reason === undefined || e["reason"] === reason), 15_000);

// Edit 1: A1.
launcher.start("deck-probe");
const connected = await engine.waitClient(3000);
record("A1a", "the Deck connected within 3 s of its start", connected, engine.clientAt === null ? null : engine.clientAt - started);
engine.begin(1);
const shown = await after(started, "show", "edit_start");
const pid = events(log()).find((e) => e.ev === "start")?.["pid"];
record("A1b", "the Deck showed within 2 s of its start", shown !== null && shown.t - started <= 2000, shown ? Math.round(shown.t - started) : null);
record("A1c", "it showed without taking the focus", shown !== null && shown["fg_pid"] !== pid, shown?.["fg_pid"]);
const spot1 = events(log()).find((e) => e.ev === "spot");
record("A1d", "the first time, it took the default spot", spot1?.["remembered"] === false, spot1);
record("A1e", "Jim: bottom centre of Lightroom's monitor", await yes("The Deck appeared at the bottom centre of the monitor Lightroom is on, and Lightroom kept the keyboard (its title bar did not turn grey)."));
record("D1", "Jim: Open grows upward, Close shrinks back", await yes("Click Open on the Deck: it grows upward and its bottom edge stays put. Click Close: it shrinks back to the bar."));

// A5: the spot and width are remembered.
const dragFrom = Date.now();
await enter("Drag the Deck by its bar to another spot on any monitor, then widen it by dragging its right edge.");
await new Promise((r) => setTimeout(r, 600)); // the Deck saves at its next 250 ms tick
const saved = existsSync(WINDOW_JSON) && statSync(WINDOW_JSON).mtimeMs >= dragFrom ? JSON.parse(readFileSync(WINDOW_JSON, "utf8")) : null;
record("A5a", "the Deck saved its spot and width", saved !== null, saved);
const end1 = Date.now();
engine.state("accepted");
const hid1 = await after(end1, "hide", "edit_end");
record("A12a", "the Deck hid about 10 s after the edit ended", hid1 !== null && Math.abs(hid1.t - end1 - 10_000) <= 1500, hid1 ? Math.round(hid1.t - end1) : null);
const begin2 = Date.now();
engine.begin(2);
const spot2 = await after(begin2, "spot");
record("A5b", "at the next edit it took the remembered spot", spot2?.["remembered"] === true, spot2);
record("A5c", "Jim: it opened where you left it, at that width", await yes("A new edit started: the Deck opened where you left it, at the width you gave it."));

// A5: a remembered spot on no connected monitor falls back.
writeFileSync(WINDOW_JSON, JSON.stringify({ left: -100000, bottom: -100000, width: 900 }));
const begin3 = Date.now();
engine.begin(3);
const spot3 = await after(begin3, "spot");
record("A5d", "a spot on no monitor falls back to the default", spot3?.["remembered"] === false, spot3);
record("A5e", "Jim: it moved to the bottom centre of Lightroom's monitor", await yes("Another edit started, with a remembered spot on no monitor: the Deck is now at the bottom centre of Lightroom's monitor."));

// A7: Lightroom moves and minimises.
record("A7a", "Jim: moving and resizing Lightroom leaves the Deck in place", await yes("If Lightroom fills the screen, click its Restore Down button first. Move Lightroom's window and change its size: the Deck stays where it is."));
const min = Date.now();
const minimised = await yes("Minimise Lightroom: the Deck is gone too. Click Lightroom on the taskbar to bring it back: the Deck is back.");
const hidMin = events(log()).find((e) => e.t >= min && e.ev === "hide" && e["reason"] === "lightroom_minimised");
const showMin = events(log()).find((e) => e.t >= min && e.ev === "show" && e["reason"] === "lightroom_restored");
record("A7b", "Jim: hidden while Lightroom is minimised, back after", minimised);
record("A7c", "the Deck logged the hide and the show", hidMin !== undefined && showMin !== undefined, { hide: hidMin?.t ?? null, show: showMin?.t ?? null });

// Rule 1 and A9: topmost only with Lightroom's main window or the Deck in front.
record("R1", "Jim: another window in front covers the Deck", await yes("Click Lightroom. Then click this PowerShell window and drag it over the Deck: PowerShell covers the Deck."));
const fFrom = Date.now();
record("A9a", "Jim: in F's full-screen preview the Deck is not over the image", await yes("Click Lightroom and press F (full-screen preview): the Deck is not over the image. Press F again to leave it."));
const fTo = Date.now();
record("A9b", "Jim: visible over Lightroom in each screen mode", await yes("Click Lightroom and press Shift+F three times, looking at the Deck after each press: it stays visible over Lightroom in every screen mode."));
const lists = events(log()).filter((e) => e.ev === "windows" && e.t >= fFrom && e.t <= fTo);
record("W1", "Lightroom's window list was logged while F was on", lists.length > 0, lists.length);

// The end.
const end3 = Date.now();
engine.state("accepted");
const hid3 = await after(end3, "hide", "edit_end");
record("A12b", "the Deck hid about 10 s after the last edit ended", hid3 !== null && Math.abs(hid3.t - end3 - 10_000) <= 1500, hid3 ? Math.round(hid3.t - end3) : null);
closeInput();
record("C2", "the Deck was uninstalled again (real edits keep the classic HUD until row 4c)", removeDeck());

mkdirSync(out, { recursive: true });
const deckFile = log();
if (deckFile) copyFileSync(deckFile, path.join(out, `probe_${run}_${path.basename(deckFile)}`));
const failed = results.filter((l) => l.ok === false).map((l) => l.id);
writeFileSync(path.join(out, `probe_${run}.json`), JSON.stringify({ run, worked: failed.length === 0, failed, results, deck_log: deckFile && path.basename(deckFile) }, null, 2));
console.log(`\nDeck shell probe: ${failed.length === 0 ? "WORKED" : `FAILED (${failed.join(", ")})`}. Results saved; tell Claude Code "probe done".`);
