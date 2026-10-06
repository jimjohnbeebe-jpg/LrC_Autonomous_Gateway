// The last two steps of the Phase 7 check (row 6):
//   F1 (A24): the Deck's executable renamed (decision D3 A [stated: Jim, 2026-10-06, "go"]), so the
//       engine finds no Deck (engine\src\hud\launch.ts findHudExe) and the classic window opens by
//       itself; Jim aborts there. The name is put back at once, and by every way the check ends
//       (check.ts wrapUp), and at the next start if the check was killed (state `renamed`).
//   F2 (A10): Lightroom quits; the Deck must close within 5 s (it watches Lightroom's process,
//       hud\src-tauri\src\window.rs "lightroom_exited"). It runs last: nothing can be put back after it.
import { existsSync, renameSync } from "node:fs";
import path from "node:path";
import { HUD_EXE_NAME } from "../../../engine/dist/hud/launch.js";
import { DECK_IMAGE, lightroomRunning, running, stopDeck } from "../kit.ts";
import { createdMs } from "./budgets.ts";
import type { Ctx } from "./ctx.ts";
import { autonomous } from "./edits-a.ts";

const SECOND = 1000;
/** The executable the engine starts, as launch.ts findHudExe looks for it (LRC_AVG_HUD_EXE, else the per-user install). */
const EXE = process.env["LRC_AVG_HUD_EXE"] ?? path.join(process.env["LOCALAPPDATA"] ?? "", "LrC-AVG HUD", HUD_EXE_NAME);
const OFF = `${EXE}.p7check-off`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Gives the Deck's executable its name back; true when it is there. */
export function restoreExe(ctx: Ctx): boolean {
  if (existsSync(OFF) && !existsSync(EXE)) renameSync(OFF, EXE);
  ctx.state.renamed = !existsSync(EXE);
  ctx.save();
  return existsSync(EXE);
}

export async function f1(ctx: Ctx): Promise<void> {
  ctx.say("No Deck: the check stops the Deck and renames its program for a moment, so the next edit finds no Deck.");
  stopDeck();
  if (!existsSync(EXE)) throw new Error(`the Deck is not installed at ${EXE}`);
  ctx.state.renamed = true;
  ctx.save();
  renameSync(EXE, OFF);
  try {
    ctx.plog.step();
    const b = await ctx.begin({});
    autonomous(b.json);
    await ctx.step(b.sid, { exposure: 0.1 });
    ctx.record("A24.log", (await ctx.plog.wait("hud: shown", 10 * SECOND)) && !running(DECK_IMAGE));
    ctx.say("The classic window \"LrC-AVG - Vision Gateway\" opened by itself. Click its Abort button. (The check sees it; nothing to type here.)");
    const done = await ctx.ended(180 * SECOND);
    const log = ctx.sessionLog(b.sid);
    ctx.record("A24.abort.log", done && log?.outcome === "aborted" && log.ended_by?.source === "hud", { outcome: log?.outcome ?? null });
    await ctx.jim("A24.jim", "The classic window \"LrC-AVG - Vision Gateway\" opened by itself, and its Abort put the photo back. Close that window now (its x), then answer.");
  } finally {
    ctx.record("deck.restored", restoreExe(ctx));
  }
}

export async function f2(ctx: Ctx): Promise<void> {
  ctx.say("Last: Lightroom quits. The check starts a short edit so the Deck is running, puts the photo back, then you quit Lightroom.");
  stopDeck();
  const b = await ctx.begin({});
  autonomous(b.json);
  const shown = await ctx.deck(b.t0, (e) => e.ev === "show", 10 * SECOND);
  const created = shown ? createdMs(shown.pid) : null;
  if (shown && created !== null && created >= b.t0 - 2 * SECOND) ctx.state.cold.push({ pid: shown.pid, created });
  await ctx.step(b.sid, { exposure: 0.1 });
  await ctx.putBack("F2");
  await ctx.release();
  const deckBefore = running(DECK_IMAGE);
  ctx.say("Now quit Lightroom: File > Exit. If Lightroom asks to back up its catalog, answer as you usually do. Watch the Deck. (The check sees it; nothing to type here.)");
  const asked = Date.now();
  while (lightroomRunning() && Date.now() - asked < 10 * 60 * SECOND) await sleep(100);
  if (lightroomRunning()) throw new Error("Lightroom was still running 10 minutes later");
  const lrGone = Date.now();
  while (running(DECK_IMAGE) && Date.now() - lrGone < 15 * SECOND) await sleep(100);
  const deckMs = running(DECK_IMAGE) ? null : Date.now() - lrGone;
  ctx.record("A10.log", deckBefore && deckMs !== null && deckMs <= 5 * SECOND, { deck_running_before: deckBefore, deck_closed_ms: deckMs });
  await ctx.jim("A10.jim", "The Deck closed within about 5 seconds after Lightroom closed.");
}
