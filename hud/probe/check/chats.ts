// The Claude Desktop chats of the Phase 7 check (row 6, decision D1 A [stated: Jim, 2026-10-06, "go"]):
// the lines that name Claude Desktop, A1 (at Claude's own lr_begin_session), A3, A6 and A8. The check
// gives the bridge to Claude Desktop's engine, Jim holds the chat, and the check takes the bridge back
// (ctx.ts start) and puts the photo back with its own snapshot (check.ts, after each step), as the
// Phase 5 check did (engine\src\devtools\phase5-chat-flow.ts).
// When Claude began is read from Claude Desktop's engine's tool log (engine\src\log\tool-log.ts: `ts` is
// the call's start, engine\src\mcp\tools-shared.ts), in the repo's logs\ folder (the Desktop entry sets
// LRC_AVG_LOG_DIR there, engine\src\setup\desktop-config.ts) or %LOCALAPPDATA%\LrC-AVG\logs.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { defaultLogDir } from "../../../engine/dist/log/index.js";
import { processes } from "../../../spikes/S9/win32.ts";
import { DECK_IMAGE, REPO, enter, liveEngine, running } from "../kit.ts";
import type { Ctx } from "./ctx.ts";

const SECOND = 1000;
const PROMPT = "Tune the active photo for golden hour landscape.";
const toolRecord = z.looseObject({ ts: z.string(), tool: z.string(), ok: z.boolean() });

/** Claude Desktop's engine's first lr_begin_session that worked, started at or after `since` (epoch ms). */
function beganAt(since: number): number | null {
  const times: number[] = [];
  for (const dir of [path.join(REPO, "logs"), defaultLogDir({ LOCALAPPDATA: process.env["LOCALAPPDATA"] })]) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      const p = path.join(dir, f);
      if (!/^engine-\d{8}\.jsonl$/.test(f) || statSync(p).mtimeMs < since) continue;
      for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
        let rec;
        try {
          rec = toolRecord.safeParse(JSON.parse(line));
        } catch {
          continue;
        }
        if (rec.success && rec.data.tool === "lr_begin_session" && rec.data.ok && Date.parse(rec.data.ts) >= since) times.push(Date.parse(rec.data.ts));
      }
    }
  }
  return times.length ? Math.min(...times) : null;
}

/** Gives the bridge to Claude Desktop; the time from which the chat's logs count. */
async function giveBridge(ctx: Ctx): Promise<number> {
  await ctx.selectPhoto();
  ctx.plog.step();
  await ctx.release();
  return Date.now();
}

/** Takes the bridge back: Claude Desktop lets it go a minute after Claude's last call, else Jim quits it. */
async function takeBack(ctx: Ctx): Promise<void> {
  ctx.say("Waiting for Claude Desktop to give the Lightroom bridge back (about a minute after Claude's last call; at most 2½ minutes). Leave Claude Desktop open.");
  if (await ctx.start(150 * SECOND)) return;
  await enter("Claude Desktop still holds the bridge. Quit it: right-click the Claude icon in the Windows system tray > Quit.");
  if (!(await ctx.start(30 * SECOND))) throw new Error("the check could not take the Lightroom bridge back from Claude Desktop");
}

const exeOf = (pid: unknown): string => processes().get(Number(pid))?.exe ?? "?";

export async function c1(ctx: Ctx): Promise<void> {
  ctx.say("Chat 1. The check now lets Claude Desktop use Lightroom.");
  const since = await giveBridge(ctx);
  await enter([
    "  1. Start Claude Desktop (Start menu > Claude). Place its window so that you can see Lightroom's photo and the Deck's spot beside it.",
    `  2. Open a new chat, type \`${PROMPT}\` and press Enter.`,
    "  3. If Claude Desktop asks whether Claude may use an lrc-avg tool, choose Always allow.",
    "  4. While Claude works, keep your hands off Lightroom and the Deck, and watch the Deck.",
    "  5. When Claude says it has finished, come back to this window.",
  ].join("\n"));
  const end = Date.now();
  const began = beganAt(since);
  const shown = began === null ? null : await ctx.deck(began, (e) => e.ev === "show", 1);
  const classic = ctx.plog.count("hud: shown");
  ctx.record("A1.chat.log", shown !== null && began !== null && shown.t - began <= 2 * SECOND && classic === 0, { ms: shown && began !== null ? shown.t - began : null, began: began === null ? null : new Date(began).toISOString(), classic });
  const fg = shown ? ctx.deckBetween(since, end).filter((e) => e.ev === "foreground" && e["fg_pid"] === shown.pid) : [];
  ctx.record("A3.log", shown !== null && fg.length === 0, { deck_foreground: fg.length });
  await ctx.jim("A1.chat.jim", "When Claude began, the Deck appeared within about 2 seconds, and no window titled \"LrC-AVG - Vision Gateway\" opened.");
  await ctx.jim("A3.jim", "While Claude worked, the Deck never took the keyboard and never came in front of Claude Desktop.");

  const t8 = Date.now();
  await enter("Click Claude Desktop's window so it is in front, and drag it over the Deck. Look at the Deck. Then click Lightroom's window and look again.");
  const fgs = ctx.deckBetween(t8, Date.now()).filter((e) => e.ev === "foreground");
  const behind = fgs.findIndex((e) => e["front"] === false);
  const again = behind >= 0 && fgs.slice(behind + 1).some((e) => e["front"] === true);
  ctx.record("A8.log", again, { foreground: fgs.map((e) => ({ exe: exeOf(e["fg_pid"]), front: e["front"] })) });
  await ctx.jim("A8.jim", "With Claude Desktop in front, it covered the Deck (the Deck was not on top). After you clicked Lightroom, the Deck was on top again.");
  await takeBack(ctx);
}

export async function c2(ctx: Ctx): Promise<void> {
  ctx.say("Chat 2: Claude Desktop quits in the middle of an edit.");
  const since = await giveBridge(ctx);
  await enter([
    `  1. In Claude Desktop, open a new chat, type \`${PROMPT}\` and press Enter.`,
    "  2. As soon as the Deck appears, quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit.",
    "  3. Look at the Deck, then come back to this window.",
  ].join("\n"));
  const shown = await ctx.deck(since, (e) => e.ev === "show", 1);
  ctx.record("A6.log", shown !== null && liveEngine() === null && running(DECK_IMAGE), { deck_shown: shown !== null, desktop_engine: liveEngine() });
  await ctx.jim("A6.jim", "The Deck shows \"Claude is not connected. Your edit so far stays.\" and a line starting \"To undo it: Develop > Snapshots > AVG pre-session\".");
  if (!(await ctx.start(30 * SECOND))) await takeBack(ctx);
}
