// The menu probe (Phase 7 row 5; spec docs\hud\lrc-avg-hud-spec-v2.md D1, "Known conflict"; Q4, Q17; plan
// decisions D1 A and D2 A [stated: Jim, 2026-10-05, "Go with recommendations"]). Run by Jim as
// `npm run deck:menu`, with Lightroom open in Develop on one selected photo, plugin 0.18.0 loaded, and
// Claude Desktop quit. Steps for Jim: docs\reports\phase7\plugin-menu.md.
// Unlike rows 4b-4c, this runs the real engine (engine\dist) against Lightroom, because the plugin's menu
// items are what is checked: two real edits on the selected photo, each ended with "revert", and the photo
// compared with its settings before the probe (and put back with the first edit's snapshot if anything
// differs). Jim answers y/n here in PowerShell. The plugin's own log says whether the classic window
// opened ("hud: shown", plugin\LrC-AVG.lrplugin\Hud.lua) and what each menu item did.
// The Deck (hud 0.3.0) stays installed when every line is YES, as in row 4c; otherwise it is uninstalled.
// Results: %TEMP%\LrC-AVG\deck-probe\menu_<run>.json, with the Deck's log, the plugin's log lines and the
// session logs.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pluginVersionAtLeast } from "../../engine/dist/bridge/index.js";
import { findHudExe } from "../../engine/dist/hud/launch.js";
import { acquireInstanceLock, devOverrides } from "../../engine/dist/mcp/index.js";
import { closeInput, deckLog, enter, install, installer, lightroomRunning, liveEngine, stopDeck, uninstall, waitEvent, yes } from "./kit.ts";
import { PluginLog, putBack, settingsOf, startEngine, until, type Engine } from "./menu-kit.ts";

type Line = { id: string; what: string; ok: boolean | null; detail?: unknown };
const run = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(tmpdir(), "LrC-AVG", "deck-probe");
const runDir = path.join(out, `menu_${run}`);
const results: Line[] = [];
const record = (id: string, what: string, ok: boolean | null, detail?: unknown): void => {
  results.push({ id, what, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`  ${ok === null ? "NOT RUN" : ok ? "YES" : "NO "}  ${id} ${what}`);
};
const say = (text: string): void => console.log(`\n${text}`);
const quiet = (): void => {};
const stop = (why: string): never => {
  console.log(`\nMenu probe: FAILED before it started. ${why}`);
  process.exit(1);
};
const MENU_MS = 180_000;
const MENU = "File > Plug-in Extras >";

if (!lightroomRunning()) stop("Lightroom is not running: open Lightroom in Develop, then run this again.");
if (liveEngine() !== null) stop("Claude Desktop's engine is running: quit Claude Desktop (File > Exit), then run this again.");
const setup = installer() ?? stop("The Deck's installer is not built yet: Claude Code runs `npm run deck:build` first.");
const lock = await acquireInstanceLock(devOverrides().lockPort);
if (!lock.ok) stop(`Another engine (pid ${lock.pid}) holds the Lightroom bridge: quit Claude Desktop, wait a minute, then run this again.`);

console.log("Menu probe. Installing the Deck 0.3.0 (per user, no admin rights needed)...");
stopDeck();
install(setup);
const exe = findHudExe() ?? stop("The Deck is not where the engine looks for it.");
mkdirSync(runDir, { recursive: true });

let deckOn = true;
let engine: Engine | null = null;
let uuid: string | null = null;
let start: Record<string, unknown> | null = null;
let snapshotId: string | null = null;
let putBackDiff: string[] | null = null;
let error: string | null = null;
const plog = new PluginLog();
const started = Date.now();
const log = (): string | null => deckLog(started);

type Outcome = "kept" | "uninstalled" | "STILL INSTALLED";
let outcome: Outcome | null = null;
/** Keeps the Deck installed only when every line is YES (row 4c's rule); a failed uninstall says so. */
const finishDeck = (): Outcome => {
  if (outcome === null) {
    const keep = results.length > 0 && results.every((l) => l.ok === true);
    if (!keep) stopDeck();
    outcome = keep ? "kept" : uninstall(exe) ? "uninstalled" : "STILL INSTALLED";
  }
  return outcome;
};
process.once("SIGINT", () => process.exit(130));

try {
  engine = await startEngine(runDir, () => deckOn, quiet);
  const e = engine;
  const hello = e.client.hello();
  if (!pluginVersionAtLeast(hello?.plugin_version, "0.18.0")) {
    throw new Error(`Lightroom runs plugin ${hello?.plugin_version ?? "unknown"}, not 0.18.0: File > Plug-in Manager > LrC-AVG > Reload Plug-in, then run this again.`);
  }
  const sel = await e.client.request("get_selection", { max: 2 });
  uuid = sel.count === 1 ? (sel.photos[0]?.uuid ?? null) : null;
  if (!uuid) throw new Error(`select exactly one photo in Lightroom (${sel.count} selected), then run this again.`);
  start = await settingsOf(e, uuid);

  // 1. A real edit: the Deck opens by itself and the plugin hears it is connected; no classic window.
  say("1. Starting an edit on the selected photo (one small exposure change; everything is put back at the end)...");
  plog.step();
  const begun = await e.tools.beginSession({ intent_id: "neutral_technical_correction", max_passes: 6, return_image: "none" });
  const sid = String(begun.json["session_id"]);
  snapshotId = (begun.json["snapshot"] as { id?: string } | undefined)?.id ?? null;
  await e.tools.step({ session_id: sid, settings: { exposure: 0.1 }, rationale: "menu probe: pass 1", return_image: "none" });
  record("M1a", "the Deck connected and the plugin heard it (hud: Deck connected)", (await until(() => e.tools.deck()?.connected() === true, 5000)) && (await plog.wait("hud: Deck connected", 5000)));
  record("M1b", "the classic window did not open at the edit's start", plog.count("hud: shown") === 0);
  record("M1c", "Jim: the Deck opened by itself, no classic window", await yes(
    "The Deck appeared at its full height, and no window titled \"LrC-AVG - Vision Gateway\" opened."));

  // 2. Q4: Show brings the Deck back, opened, and Lightroom keeps the keyboard.
  say(`2. Click the x at the Deck's right end to hide it. Then, in Lightroom, choose ${MENU} LrC-AVG - Show Vision Gateway HUD.`);
  plog.step();
  const t2 = Date.now();
  const asked = await plog.wait("hud: menu show: the Deck asked", MENU_MS);
  const reveal = await waitEvent(log, t2, (ev) => ev.ev === "show" && ev["reason"] === "menu", 5000);
  record("M2a", "the menu asked the engine for the Deck, and the Deck showed itself", asked && reveal !== null);
  record("M2b", "the classic window did not open", plog.count("hud: shown") === 0);
  record("M2c", "Jim: the Deck came back opened; Lightroom kept the keyboard", await yes(
    "The Deck came back at its full height, no \"LrC-AVG - Vision Gateway\" window opened, and pressing \\ in Lightroom switches the photo to Before and back (press \\ twice)."));

  // 3. Decision D1 A: a refused item still opens the classic window, which says why.
  say(`3. Choose ${MENU} LrC-AVG - Pick A. (This edit has no copies, so it is refused.)`);
  plog.step();
  const picked = await plog.wait("hud: menu hud_pick", MENU_MS);
  record("M3a", "the refused Pick A opened the classic window", picked && (await plog.wait("hud: shown", 5000)));
  record("M3b", "Jim: the classic window says why; you closed it", await yes(
    "A window \"LrC-AVG - Vision Gateway\" opened and says Pick A was not sent, with the reason. Close that window now (its x), then answer."));

  // 4. A sent item (Abort) leaves the classic window closed; the Deck shows the outcome.
  say(`4. Choose ${MENU} LrC-AVG - Abort Edit.`);
  plog.step();
  const aborted = await plog.wait("hud: menu hud_abort", MENU_MS);
  await until(() => e.tools.sessionManager()?.current() === null, 30_000);
  const outcomeLine = plog.since().find((l) => l.includes("hud: menu hud_abort:"));
  record("M4a", "the menu's Abort was sent and the Deck took the outcome", aborted && plog.count("hud: menu hud_abort: the Deck shows the outcome") === 1, outcomeLine);
  record("M4b", "the edit ended as aborted", e.tools.sessionManager()?.current() === null);
  record("M4c", "the classic window did not open", plog.count("hud: shown") === 0);
  record("M4d", "Jim: Done, the photo is back; no classic window", await yes(
    "The Deck shows \"Done: the photo is back as it was.\" and no \"LrC-AVG - Vision Gateway\" window opened."));

  // 5. With no Deck, as before: the classic window opens by itself, and Show opens it.
  say("5. The probe now stops the Deck and starts a second edit with no Deck to start...");
  deckOn = false;
  stopDeck();
  plog.step();
  record("M5a", "the plugin heard the Deck went away (hud: Deck not connected)", await plog.wait("hud: Deck not connected", 10_000));
  plog.step();
  await e.tools.beginSession({ intent_id: "neutral_technical_correction", max_passes: 6, return_image: "none" });
  record("M5b", "with no Deck the classic window opened by itself", await plog.wait("hud: shown", 10_000));
  await enter("The classic window \"LrC-AVG - Vision Gateway\" opened. Close it (its x).");
  say(`Now choose ${MENU} LrC-AVG - Show Vision Gateway HUD.`);
  plog.step();
  record("M5c", "with no Deck, Show opened the classic window", await plog.wait("hud: shown", MENU_MS));
  record("M5d", "Jim: the classic window opened from the menu", await yes("The \"LrC-AVG - Vision Gateway\" window opened again. Leave it open."));
} catch (err) {
  error = err instanceof Error ? err.message : String(err);
  say(`ERROR: ${error}`);
} finally {
  if (engine && uuid && start) {
    try {
      putBackDiff = await putBack(engine, uuid, start, snapshotId);
    } catch (err) {
      error ??= `put-back: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  record("P", "the photo is as it was before the probe (0 settings differ)", putBackDiff === null ? null : putBackDiff.length === 0, putBackDiff ?? undefined);
  engine?.tools.deck()?.close();
  engine?.client.stop();
  await lock.lock.release();
}

closeInput();
const end = finishDeck();
const failed = results.filter((l) => l.ok !== true).map((l) => l.id);
const deckFile = log();
if (deckFile) copyFileSync(deckFile, path.join(runDir, path.basename(deckFile)));
writeFileSync(path.join(runDir, "plugin-log.txt"), plog.text());
writeFileSync(path.join(out, `menu_${run}.json`), JSON.stringify({ run, worked: failed.length === 0 && error === null, failed, error, outcome: end, results, deck_log: deckFile && path.basename(deckFile) }, null, 2));
const told = end === "STILL INSTALLED" ? "The Deck is STILL INSTALLED: its uninstaller failed. Tell Claude Code before the next edit." : `The Deck was ${end}.`;
console.log(`\nMenu probe: ${failed.length === 0 && error === null ? "WORKED" : `FAILED (${[...failed, ...(error ? ["error"] : [])].join(", ")})`}. PUT BACK: ${putBackDiff?.length === 0 ? "YES" : "NO"}. ${told} Results saved; tell Claude Code "probe done".`);
process.exit(0);
