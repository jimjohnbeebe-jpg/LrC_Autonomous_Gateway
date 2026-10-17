// The hidden-Deck input probe (Phase 8.5, fix/deck-relaunch): `npm run deck:idle-probe`, Lightroom open,
// Claude Desktop quit. On 2026-10-10 a Deck shown after 383 s hidden took no hover and no click, while
// after 33 s and 55 s it did [handle: docs\reports\phase8.5\deck-relaunch.md "Pre-run findings"]. While
// hidden, the Deck sets WebView2 IsVisible false and its memory target Low (src-tauri\src\webview.rs).
// This probe measures which of the two stops the input: per run it starts the Deck with
// LRC_AVG_DECK_IDLE (both, no_memory, no_visible), shows it for an edit, ends the edit, closes the channel
// as the engine's idle release does, waits, opens the channel again and launches the Deck a second time,
// as the engine does at the next begin (the launch wakes the running Deck, wake.rs; the time to connect
// is measured too). Then it moves the mouse onto the Deck's Accept and clicks, and reads the Deck's log
// for the pointer and the click. No photo is edited: the edits are the stand-in engine's (kit.ts).
// `-- --timer` runs one more case instead: the path of 2026-10-10 itself, with no second launch: the next edit
// starts while the Deck is still disconnected, and the Deck finds the engine through its page's 2 s timer and
// joins mid-edit, as at 19:57:44Z.
// `-- --front` runs both paths with another app in front at the show, not Lightroom: both shows on 2026-10-10
// that took no input came while VS Code was in front, the three that worked while Claude Desktop was [handle:
// docs\reports\phase8.5\deck-relaunch.md "Pre-run findings" 5]. While
// the Deck is hidden, the probe clicks the middle of the window that was in front when it started (the
// terminal it runs in), as Jim did, since the Deck's Accept hands the foreground to Lightroom.
// `-- --classic` runs those two with Lightroom's classic HUD open as well, as on 2026-10-10: the edit begins, the
// classic window opens through the bridge's hud_update (as engine\src\hud\publisher.ts sends it) and 3 s later
// the terminal's app comes in front; then the Deck connects and shows. The classic window closes itself after.
// Results: %TEMP%\LrC-AVG\deck-idle\idle_<stamp>.json and a copy of the Deck's log.
import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { BridgeClient } from "../../engine/dist/bridge/index.js";
import { findHudExe } from "../../engine/dist/hud/launch.js";
import { StandIn, closeInput, deckLog, install, installer, lightroomRunning, liveEngine, stopDeck, waitEvent, type DeckEvent } from "./kit.ts";
import { centreOf, cursor, foreground, moveTo, physicalPixels, pidAt, pressLeft, type Front, type Point } from "./input.ts";

const OUT = path.join(tmpdir(), "LrC-AVG", "deck-idle");
const SHORT_S = 30;
/** Past the 383 s of 2026-10-10. */
const LONG_S = 420;
type Case = { mode: string; hidden_s: number; wake: boolean; classic?: boolean };
const WAKE_RUNS: Case[] = [
  { mode: "both", hidden_s: SHORT_S, wake: true },
  { mode: "both", hidden_s: LONG_S, wake: true },
  { mode: "no_memory", hidden_s: LONG_S, wake: true },
  { mode: "no_visible", hidden_s: LONG_S, wake: true },
];
const TIMER_RUNS: Case[] = [{ mode: "both", hidden_s: LONG_S, wake: false }];
const FRONT_RUNS: Case[] = [
  { mode: "both", hidden_s: SHORT_S, wake: true },
  { mode: "both", hidden_s: LONG_S, wake: false },
];
const CLASSIC = process.argv.includes("--classic");
const FRONT = CLASSIC || process.argv.includes("--front");
const RUNS = CLASSIC ? FRONT_RUNS.map((r) => ({ ...r, classic: true })) : FRONT ? FRONT_RUNS : process.argv.includes("--timer") ? TIMER_RUNS : WAKE_RUNS;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const line = (e: DeckEvent): Record<string, unknown> => (e["line"] ?? {}) as Record<string, unknown>;
const ui = (key: string) => (e: DeckEvent) => e.ev === "ui" && key in line(e);

type Run = Case & {
  classic_opened: boolean | null;
  verdict: "INPUT OK" | "NO INPUT" | "COVERED" | "FAILED";
  problem: string | null;
  wake_ms: number | null;
  point: Point | null;
  under_point: string | null;
  /** The app in front when the Deck showed. */
  in_front: string | null;
  pointer_in: boolean;
  deck_click: boolean;
  engine_got_click: boolean;
};

function imageOf(pid: number): string {
  const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], { encoding: "utf8" });
  return out.split(",")[0]?.replace(/"/g, "").trim() || `pid ${pid}`;
}

function launch(exe: string, mode: string): void {
  spawn(exe, [], { detached: true, stdio: "ignore", env: { ...process.env, LRC_AVG_DECK_IDLE: mode } }).unref();
}

/** Click the middle of `home` so its app is in front; true when it is. */
async function putInFront(home: Front): Promise<boolean> {
  const before = cursor();
  moveTo(centreOf(home.hwnd));
  await sleep(200);
  pressLeft();
  await sleep(500);
  moveTo(before);
  return foreground().pid === home.pid;
}

/** The classic HUD's update for the stand-in's edit: `open` opens its window; an end closes it 10 s later (plugin 0.15.0). */
async function classic(bridge: BridgeClient, engine: StandIn, seq: number, stage: "awaiting_claude" | "accepted"): Promise<boolean> {
  const end = stage === "accepted";
  const result = await bridge.request("hud_update", {
    session_id: engine.edit?.id ?? "deck-probe", seq, stage, mode: "converge", pass: 1, max_passes: 6,
    target: { uuid: "DECK-PROBE-PHOTO", filename: "deck-probe.NEF" }, snapshot: "AVG pre-session (Deck probe: nothing was edited)",
    ...(end ? { close_after: 10 } : { open: true }),
  });
  return result.opened === true;
}

async function oneRun(exe: string, engine: StandIn, r: Case, logs: string[], home: Front | null, bridge: BridgeClient | null): Promise<Run> {
  const run: Run = { ...r, classic_opened: null, verdict: "FAILED", problem: null, wake_ms: null, point: null, under_point: null, in_front: null, pointer_in: false, deck_click: false, engine_got_click: false };
  const fail = (problem: string): Run => ({ ...run, problem });
  stopDeck();
  await sleep(1000);
  const t0 = Date.now();
  await engine.channel.open();
  launch(exe, r.mode);
  if (!(await engine.waitClient(20000))) return fail("the Deck did not connect at its start");
  const log = deckLog(t0);
  if (!log) return fail("no Deck log");
  logs.push(log);
  const file = () => log;
  engine.begin(1);
  if (!(await waitEvent(file, t0, (e) => e.ev === "show", 10000))) return fail("the Deck did not show for edit 1");
  await sleep(2000);
  const ended = Date.now();
  engine.state("accepted");
  if (!(await waitEvent(file, ended, (e) => e.ev === "hide", 20000))) return fail("the Deck did not hide after edit 1");
  engine.channel.close(); // as the engine's idle release (engine\src\mcp\main.ts onIdleRelease)
  console.log(`  ${r.mode}: the Deck is hidden; waiting ${r.hidden_s} s.`);
  await sleep(r.hidden_s * 1000);

  if (r.classic && bridge) {
    engine.begin(2); // the Deck is not connected yet: the stand-in sends it this state when it connects
    run.classic_opened = await classic(bridge, engine, 1, "awaiting_claude");
    await sleep(3000); // the engine's wait for a Deck before it opens the classic window (sinks.ts WAIT_MS)
  }
  if (home && !(await putInFront(home))) return fail(`could not put ${imageOf(home.pid)} in front`);
  const t1 = Date.now();
  await engine.channel.open();
  // The next begin's start: a second launch, which wakes the running Deck. Without it (--timer), the edit is
  // already open when the Deck finds the engine by itself.
  if (r.wake) launch(exe, r.mode);
  else if (!r.classic) engine.begin(2);
  if (!(await engine.waitClient(r.wake ? 60000 : 180000))) return fail("the Deck did not connect again");
  run.wake_ms = Date.now() - t1;
  if (r.wake && !r.classic) engine.begin(2);
  const place = await waitEvent(file, t1, (e) => e.ev === "place", 10000);
  const at = await waitEvent(file, t1, ui("accept_at"), 10000);
  const shown = await waitEvent(file, t1, (e) => e.ev === "show", 10000);
  run.in_front = shown ? imageOf(Number(shown["fg_pid"])) : null;
  const got = place?.["got"] as number[] | undefined;
  const accept = line(at ?? { ev: "", t: 0 })["accept_at"] as number[] | null | undefined;
  const dpr = Number(line(at ?? { ev: "", t: 0 })["dpr"] ?? 1);
  if (!got || !accept) return fail("no place or accept_at line after the show");
  const point = { x: Math.round((got[0] ?? 0) + (accept[0] ?? 0) * dpr), y: Math.round((got[1] ?? 0) + (accept[1] ?? 0) * dpr) };
  run.point = point;
  await sleep(1000);
  const before = cursor();
  run.under_point = imageOf(pidAt(point));
  const moved = Date.now();
  moveTo(point);
  await sleep(200);
  moveTo({ x: point.x + 4, y: point.y });
  run.pointer_in = (await waitEvent(file, moved, ui("pointer_in"), 1500)) !== null;
  const clicked = Date.now();
  pressLeft();
  run.deck_click = (await waitEvent(file, clicked, ui("click"), 2000)) !== null;
  run.engine_got_click = (await engine.waitMessage(clicked, (m) => m.type === "event" && m["name"] === "hud_accept", 2000)) !== null;
  moveTo(before);
  engine.state("accepted");
  if (r.classic && bridge) await classic(bridge, engine, 2, "accepted");
  await waitEvent(file, Date.now(), (e) => e.ev === "hide", 20000);
  engine.channel.close();
  const ours = ["LrC-AVG Deck.exe", "msedgewebview2.exe"].includes(run.under_point);
  run.verdict = run.pointer_in && run.deck_click && run.engine_got_click ? "INPUT OK" : ours ? "NO INPUT" : "COVERED";
  return run;
}

async function main(): Promise<void> {
  if (!lightroomRunning()) throw new Error("Lightroom is not running: open it, then run this again.");
  if (liveEngine() !== null) throw new Error("Claude Desktop's engine is running: quit Claude Desktop (File > Exit), then run this again.");
  const setup = installer();
  if (!setup) throw new Error("No Deck installer for this hud version: Claude Code builds it (npm run deck:build).");
  physicalPixels();
  const home = FRONT ? foreground() : null;
  if (home && imageOf(home.pid) === "Lightroom.exe") throw new Error("Lightroom is in front: run this from the terminal, without clicking Lightroom.");
  stopDeck();
  install(setup);
  const exe = findHudExe();
  if (!exe) throw new Error("The Deck is not where the installer puts it.");
  const minutes = Math.ceil(RUNS.reduce((n, r) => n + r.hidden_s + 30, 0) / 60);
  console.log(`Deck idle probe: ${RUNS.length} runs, about ${minutes} minutes. Leave the mouse alone; the probe moves it onto the Deck once per run.`);
  const engine = new StandIn();
  const bridge = CLASSIC ? new BridgeClient({ engineVersion: "deck-idle-probe", log: () => {} }) : null;
  const logs: string[] = [];
  const runs: Run[] = [];
  // Released on every way out: a channel or a bridge client left open keeps Node running (Greptile, PR #122).
  try {
    if (bridge) {
      bridge.start();
      await bridge.waitConnected(30000).catch(() => {
        throw new Error("The probe could not reach the plugin's bridge in 30 s: check that the LrC-AVG plugin is enabled (File > Plug-in Manager).");
      });
    }
    for (const r of RUNS) {
      const run = await oneRun(exe, engine, r, logs, home, bridge);
      runs.push(run);
      console.log(`  ${r.mode}, hidden ${r.hidden_s} s: ${run.verdict}${run.problem ? ` (${run.problem})` : ""}; connected again after ${run.wake_ms ?? "-"} ms`);
    }
  } finally {
    bridge?.stop();
    engine.channel.close();
    stopDeck();
  }
  mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(OUT, `idle_${stamp}.json`);
  writeFileSync(file, `${JSON.stringify({ probe: "deck-idle", at: new Date().toISOString(), runs }, null, 2)}\n`);
  logs.forEach((l, i) => copyFileSync(l, path.join(OUT, `idle_${stamp}_deck_${i + 1}.jsonl`)));
  const failed = runs.some((r) => r.verdict === "FAILED" || r.verdict === "COVERED");
  closeInput();
  console.log(`\n${failed ? "INCOMPLETE" : "DONE"}: results in ${file}. Tell Claude Code "done".`);
}

main().catch((err: unknown) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
  closeInput();
});
