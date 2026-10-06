// The Deck's states probe (Phase 7 row 4c; spec docs\hud\lrc-avg-hud-spec-v2.md 5.2, 6, 4.6, acceptance
// lines A1, A6, A11, A13-A18 as amended in 2.7). Run by Jim as `npm run deck:states`, with Lightroom open
// in Develop and Claude Desktop quit. Steps for Jim: docs\reports\phase7\deck-ui.md.
// As row 4b's probe: a stand-in engine (the engine's own HudChannel and HudLauncher) sends made-up
// states, so no photo is edited and nothing is written to the catalog; Jim answers y/n here in
// PowerShell [stated: Jim, 2026-10-05, "Go with recommendation", plan decision 5]. This time Jim clicks
// and types in the Deck, and the probe checks what the Deck sends.
// The Deck stays installed when every line is YES [stated: Jim, 2026-10-05, decision 4 "Yes"]; otherwise
// it is uninstalled again, so a Deck that failed here never replaces the classic HUD in a real edit.
// Results: %TEMP%\LrC-AVG\deck-probe\states_<run>.json, with a copy of the Deck's log.
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { HudLauncher, findHudExe } from "../../engine/dist/hud/launch.js";
import {
  REPO, StandIn, closeInput, deckLog, events, install, installer, lightroomRunning, liveEngine, stopDeck, uninstall, waitEvent, yes, type DeckSent,
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
  console.log(`\nDeck states probe: FAILED before it started. ${why}`);
  process.exit(1);
};
const say = (text: string): void => console.log(`\n${text}`);
const CLICK_MS = 180_000;

if (!lightroomRunning()) stop("Lightroom is not running: open Lightroom in Develop, then run this again.");
if (liveEngine() !== null) stop("Claude Desktop's engine is running: quit Claude Desktop (File > Exit), then run this again.");
const setup = installer() ?? stop("The Deck's installer is not built yet: Claude Code runs `npm run deck:build` first.");

console.log("Deck states probe. Installing the Deck (per user, no admin rights needed)...");
stopDeck();
install(setup);
const exe = findHudExe() ?? stop("The Deck is not where the engine looks for it.");
let engine: StandIn | null = null;
let kept: boolean | null = null;
/** Stops the Deck; keeps it installed only when every line is YES (see the header). */
const finish = (): boolean => {
  if (kept === null) {
    engine?.channel.close();
    stopDeck();
    kept = results.length > 0 && results.every((l) => l.ok === true);
    if (!kept) uninstall(exe);
  }
  return kept;
};
process.once("exit", () => {
  if (kept === null) console.log(`The Deck was ${finish() ? "kept" : "uninstalled"}.`);
});
process.once("SIGINT", () => process.exit(130));

// Made-up thumbnails and slider rows, as the engine sends them (channel-protocol.ts).
const sharp = createRequire(path.join(REPO, "package.json"))("sharp") as (o: unknown) => { jpeg(): { toBuffer(): Promise<Buffer> } };
engine = new StandIn();
for (const [k, c] of [["A", "#6a7a5a"], ["B", "#8a5a3a"], ["C", "#7a8aa8"]] as const) {
  engine.thumbs[`deck-probe-${k}`] = (await sharp({ create: { width: 480, height: 320, channels: 3, background: c } }).jpeg().toBuffer()).toString("base64");
}
const row = (name: string, label: string, before: number, after: number) => ({ name, label, group: "Basic", before, after, delta: after - before, min: -100, max: 100, weight: 0.3 });
const rows = [row("contrast", "Contrast", 0, 12), row("highlights", "Highlights", -21, -41), row("shadows", "Shadows", 10, 20), row("clarity", "Clarity", 2, 6)];
const copies = (["A", "B", "C"] as const).map((letter, i) => ({
  letter, label: ["natural", "dramatic", "soft"][i], copy_name: `AVG deck_probe ${letter}`, uuid: `DECK-PROBE-${letter}`, pass: 1, thumb: `deck-probe-${letter}`, guardrail: { status: "green" },
}));

await engine.channel.open();
const started = Date.now();
const log = (): string | null => deckLog(started);
new HudLauncher().start("deck-probe");
const connected = await engine.waitClient(3000);
record("C1", "the Deck connected within 3 s of its start", connected);

const event = (name: string) => (m: DeckSent): boolean => m.type === "event" && m["name"] === name;
/** Waits for the Deck's click `name`; answers it as the engine does (an `answer`, then a state naming it). */
async function clickOf(name: string, since: number): Promise<DeckSent | null> {
  const msg = await engine!.waitMessage(since, event(name), CLICK_MS);
  const payload = (msg?.["payload"] ?? {}) as Record<string, unknown>;
  if (msg) engine!.channel.send({ type: "answer", click_id: String(payload["click_id"]), note: `${name} received (Deck probe).` });
  return msg;
}
const focusBack = async (since: number) => (await waitEvent(log, since, (e) => e.ev === "focus_lightroom", 3000))?.["ok"] === true;

// 1. Opened by default (decision 1), shown without the keyboard (A1-A3).
engine.begin(1, { rows, pass: 1, guardrail: { status: "green" } });
const shown = await waitEvent(log, started, (e) => e.ev === "show" && e["reason"] === "edit_start", 5000);
record("S1a", "the Deck showed at the edit's start", shown !== null);
record("S1b", "Jim: opened, working, slider rows, Lightroom kept the keyboard", await yes(
  "The Deck appeared at its full height (not just the thin bar). It says \"Claude is working. Nothing needed from you.\", shows slider rows (Contrast, Highlights, ...) in the middle, and Lightroom kept the keyboard (its title bar did not turn grey)."));

// 2. Approve with the pointer (A11, A16); the keyboard goes back to Lightroom.
engine.state("awaiting_approval", { rows, pass: 1, approve_pass: 1, guardrail: { status: "green" } });
let t = Date.now();
say("Click \"Approve pass 1\" on the Deck once (the orange button).");
const approve = await clickOf("hud_approve_pass", t);
record("S2a", "the Deck sent Approve pass 1", approve !== null && (approve["payload"] as { pass?: number }).pass === 1, approve);
record("S2b", "the keyboard went back to Lightroom after the click", await focusBack(t));
record("S2c", "Jim: the click line, grey buttons, Lightroom active", await yes(
  "Right after your click the Deck said \"Approve pass 1 sent; waiting for Claude.\" with its buttons grey, then went back to normal. Lightroom's title bar is active (not grey)."));

// 3. The keyboard: arming Abort, Esc, Enter (A14, A15, A11).
engine.state("converged", { rows, pass: 2, guardrail: { status: "green" } });
t = Date.now();
record("S3a", "Jim: Ctrl+Backspace arms Abort, Esc disarms", await yes(
  "Click once on the Deck's sentence \"Your turn: Claude thinks the edit is done.\" (that gives the Deck the keyboard; nothing is sent). Press Ctrl+Backspace once: the Abort button reads \"Press again to abort\". Press Esc: it reads \"Abort\" again."));
record("S3b", "nothing was aborted by Ctrl+Backspace then Esc", !engine.messages.some((m) => m.t >= t && event("hud_abort")(m.msg)));
t = Date.now();
say("Click the Deck's sentence again, then press Enter.");
const accept = await clickOf("hud_accept", t);
record("S3c", "Enter sent Accept", accept !== null, accept);
engine.state("accepted", { rows, pass: 2 });
record("S3d", "Jim: Done, the edit is kept", await yes("The Deck shows \"Done: the edit is kept.\" with a green check."));

// 4. Abort is one click (A13, Q5).
engine.begin(2, { stage: "converged", rows, pass: 1 });
t = Date.now();
say("A new edit started. Click \"Abort\" on the Deck once.");
const abort = await clickOf("hud_abort", t);
record("S4a", "one click sent Abort", abort !== null, abort);
engine.state("aborted", { pass: 1 });
record("S4b", "Jim: Done, the photo is back", await yes("The Deck shows \"Done: the photo is back as it was.\" (nothing was really edited)."));

// 5. The pick (A17, A18; Q11 and E12): a card click chooses, 3 chooses C, Enter continues.
engine.begin(3, { stage: "awaiting_pick", mode: "variants", variants: ["A", "B", "C"], copies, session_photos: ["DECK-PROBE-PHOTO", ...copies.map((c) => c.uuid)] });
record("S5a", "Jim: three cards with pictures, no Accept", await yes(
  "A new edit started. The Deck shows three cards, \"A natural\", \"B dramatic\" and \"C soft\", each with a coloured picture, and there is no Accept button."));
t = Date.now();
say("Click card B.");
const showB = await engine.waitMessage(t, (m) => m.type === "show" && m["variant"] === "B", CLICK_MS);
record("S5b", "a click on card B asked Lightroom to show copy B", showB !== null);
record("S5c", "Jim: card B framed, Continue on copy B", await yes("Card B has an orange frame, and the button \"Continue on copy B\" appeared."));
t = Date.now();
say("Click the Deck's sentence, then press 3, then Enter.");
const showC = await engine.waitMessage(t, (m) => m.type === "show" && m["variant"] === "C", CLICK_MS);
const pick = await clickOf("hud_pick", t);
record("S5d", "3 chose copy C and Enter picked it", showC !== null && (pick?.["payload"] as { variant?: string } | undefined)?.variant === "C", pick);
engine.state("awaiting_claude", { mode: "variants", copies, picked: "C", note: "Picked C: Claude continues on copy C at its next call." });
record("S5e", "Jim: card C reads Picked", await yes("Card C reads \"Picked\", and the Deck's sentence says Claude continues on copy C."));

// 6. Closing and opening the deck.
record("S6", "Jim: the triangle closes and opens the deck", await yes(
  "Click the small triangle at the Deck's top left: the Deck shrinks to the thin bar, which still shows the sentence and Abort. Click the triangle again: it opens."));

// 7. Claude gone (A6, spec D5): the undo path and the way to Put back.
engine.channel.close();
await new Promise((r) => setTimeout(r, 2500));
record("S7", "Jim: not connected, undo path, Put back path, grey buttons", await yes(
  "The Deck says \"Claude is not connected. Your edit so far stays.\", shows the way to undo it and to put the photo back, and its buttons are grey."));
await engine.channel.open();
record("S7b", "the Deck reconnected by itself", await engine.waitClient(10_000));
engine.state("ended", { mode: "variants", copies, picked: "C" });

closeInput();
const failed = results.filter((l) => l.ok !== true).map((l) => l.id);
const keptNow = finish();
record("C2", keptNow ? "the Deck stays installed: real edits use it from now on" : "the Deck was uninstalled again (a line was not YES)", keptNow || failed.length > 0);
mkdirSync(out, { recursive: true });
const deckFile = log();
if (deckFile) copyFileSync(deckFile, path.join(out, `states_${run}_${path.basename(deckFile)}`));
const ui = events(deckFile).filter((e) => e.ev === "ui" || e.ev === "focus_lightroom");
writeFileSync(path.join(out, `states_${run}.json`), JSON.stringify({ run, worked: failed.length === 0, failed, kept: keptNow, results, deck_ui: ui, deck_log: deckFile && path.basename(deckFile) }, null, 2));
console.log(`\nDeck states probe: ${failed.length === 0 ? "WORKED" : `FAILED (${failed.join(", ")})`}. The Deck is ${keptNow ? "installed" : "uninstalled"}. Results saved; tell Claude Code "probe done".`);
