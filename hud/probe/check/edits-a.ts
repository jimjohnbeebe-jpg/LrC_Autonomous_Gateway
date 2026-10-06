// Edits 1 and 2 of the Phase 7 check (row 6): real edits by the check's engine on Jim's photo, the Deck
// installed (hud 0.3.1), Claude Desktop quit. Spec docs\hud\lrc-avg-hud-spec-v2.md 11.1 as 2.7 amends it.
//   E1: the Deck opens by itself (A1, cold start), the keyboard stays with Lightroom (A2), your turn on a
//       converged edit (A4), the changes rows (A19), the look (A22, A23), Accept and the hide 10 s later
//       (A12); memory and CPU shown and hidden (spec 9).
//   E2: Lightroom moved, resized, minimised (A7), its screen modes and F (A9), the Deck dragged and
//       widened (A5, checked at E3's start), and Abort while Claude works (A13, A16).
import { enter, stopDeck } from "../kit.ts";
import { differing } from "../menu-kit.ts";
import { createdMs, monitorCount, sampleTree, ui } from "./budgets.ts";
import { Ctx } from "./ctx.ts";

const SECOND = 1000;
/** The slower answers: Jim reads and clicks (the menu probe's MENU_MS). */
const CLICK_MS = 180 * SECOND;
const PASS_1 = { exposure: 0.15, contrast: 5, highlights: -10, shadows: 10, vibrance: 5 };

/**
 * Jim gives Lightroom the keyboard before the Deck appears or changes (A2, A4): Jim's last click is in
 * this window otherwise. The check waits 5 s after Jim's Enter.
 */
async function handToLightroom(then: string): Promise<void> {
  await enter(`After you press Enter here, click Lightroom's title bar (the top edge of its window) within 5 seconds, and then keep your hands off the mouse. ${then}`);
  await new Promise((r) => setTimeout(r, 5 * SECOND));
}

export async function e1(ctx: Ctx): Promise<void> {
  ctx.say("Edit 1. The check stops the Deck, then starts an edit on your photo: the Deck starts and appears by itself.");
  stopDeck();
  await handToLightroom("When the Deck has appeared, press \\ (backslash) once: the photo should switch to Before. Press \\ again to switch back. Then come back here.");
  ctx.plog.step();
  const b = await ctx.begin({});
  const shown = await ctx.deck(b.t0, (e) => e.ev === "show", 10 * SECOND);
  const created = shown ? createdMs(shown.pid) : null;
  if (shown && created !== null && created >= b.t0 - 2 * SECOND) ctx.state.cold.push({ pid: shown.pid, created });
  ctx.record("A1.e1.shown", shown !== null && shown.t - b.t0 <= 2 * SECOND, { ms: shown ? shown.t - b.t0 : null });
  await ctx.step(b.sid, PASS_1);
  ctx.record("A1.e1.classic", ctx.plog.count("hud: shown") === 0);
  await ctx.jim("A1.e1.jim", "The Deck appeared by itself, opened at full height: where you last left it (the first time: at the bottom centre of Lightroom's monitor). No window titled \"LrC-AVG - Vision Gateway\" opened.");
  await ctx.jim("A2.jim", "Without a click, \\ switched the photo to Before and back: the keyboard stayed with Lightroom.");
  await handToLightroom("When the Deck says \"Your turn\", press \\ twice (Before, then back). Then come back here.");

  let converged = false;
  let passes = 1;
  for (let i = 0; i < 4 && !converged; i++) {
    const json = await ctx.step(b.sid, { vibrance: i % 2 === 0 ? 1 : -1 });
    passes += 1;
    converged = json["converged"] === true || json["converged_by_metrics"] === true;
  }
  ctx.record("A4.log", converged, { passes });
  await ctx.jim("A4.jim", "The Deck says \"Your turn: Claude thinks the edit is done.\" with an amber dot, and \\ switched Before and back without a click.");
  const pid = shown?.pid ?? null;
  const fg = ctx.deckBetween(b.t0, Date.now()).filter((e) => e.ev === "foreground" && e["fg_pid"] === pid);
  ctx.record("A2.log", pid !== null && fg.length === 0, { deck_foreground: fg.length });

  if (pid !== null) {
    ctx.say("Keep your hands off the mouse and keyboard for one minute while the check measures the Deck (shown).");
    ctx.state.samples.visible = await sampleTree(pid, 60 * SECOND);
    ctx.save();
  }
  await ctx.jim("A19.jim", "Look at the rows in the Deck's middle. They use Lightroom's slider names (Exposure, Contrast, Highlights, Shadows, Vibrance) in the Basic panel's order, and each row's mark sits where that slider sits in Lightroom's Basic panel (right side of Develop).");
  await ctx.jim("A22.jim", "The Deck's text is readable at a glance, nothing in it is smaller than the key hints, and nothing depends on colour alone (each state also has words or a shape).");
  await ctx.jim("A23.jim", "The Deck looks at home next to Lightroom's panels.");

  const tc = Date.now();
  ctx.say("Note whether Accept is the only filled button. Then click Accept in the Deck, and watch the Deck for about 10 seconds.");
  const done = await ctx.ended(CLICK_MS);
  const log = ctx.sessionLog(b.sid);
  ctx.record("A12.ended", done && log?.outcome === "accept" && log.ended_by?.source === "hud", { outcome: log?.outcome ?? null, source: log?.ended_by?.source ?? null });
  const end = await ctx.deck(tc, (e) => ui(e, "session") === b.sid && ui(e, "stage") === "accepted", 5 * SECOND);
  const endAt = end ? Number(ui(end, "at")) : null;
  const hid = endAt === null ? null : await ctx.deck(endAt, (e) => e.ev === "hide", 20 * SECOND);
  const hideMs = hid && endAt !== null ? hid.t - endAt : null;
  ctx.record("A12.hid", hideMs !== null && Math.abs(hideMs - 10 * SECOND) <= 3 * SECOND, { ms: hideMs });
  await ctx.jim("A12.jim", "Before your click, Accept was the only filled button; after it, the Deck showed \"Done: the edit is kept.\"");
  await ctx.jim("A12.hid.jim", "About 10 seconds after \"Done\", the Deck hid itself.");

  if (pid !== null) {
    ctx.say("Keep your hands off the mouse and keyboard for one more minute while the check measures the Deck (hidden).");
    ctx.state.samples.hidden = await sampleTree(pid, 60 * SECOND);
    ctx.save();
  }
}

export async function e2(ctx: Ctx): Promise<void> {
  ctx.say("Edit 2. The check starts another edit; the Deck comes back by itself.");
  const b = await ctx.begin({ max_passes: 8 });
  await ctx.step(b.sid, { exposure: 0.1 });

  await enter("If Lightroom fills the screen (maximised), click its Restore button first (the middle one of the three at its top right). Then drag Lightroom's title bar to move it, and drag its bottom-right corner to resize it. If you restored it, maximise it again (the same middle button).");
  await ctx.jim("A7.move.jim", "While Lightroom moved and changed size, the Deck stayed where it was.");
  const tm = Date.now();
  await enter("Minimise Lightroom (the _ button at its top right) and look for the Deck. Then click Lightroom's icon in the Windows taskbar to bring it back.");
  const hidden = await ctx.deck(tm, (e) => e.ev === "hide", 1);
  const back = hidden ? await ctx.deck(hidden.t, (e) => e.ev === "show", 5 * SECOND) : null;
  ctx.record("A7.min.log", hidden !== null && back !== null, { hide: hidden?.["reason"] ?? null, show: back?.["reason"] ?? null });
  await ctx.jim("A7.min.jim", "While Lightroom was minimised the Deck was hidden, and when Lightroom came back the Deck came back too.");

  // The words of row 4b's probe, which Jim followed (hud\probe\probe.ts A9b; docs\reports\phase7\deck-shell.md).
  await enter("Click Lightroom's title bar and press Shift+F three times, looking at the Deck after each press.");
  await ctx.jim("A9.modes.jim", "In each screen mode, the Deck stayed visible over Lightroom.");
  await enter("Click Lightroom's title bar and press F: the photo shows full screen. Look at the Deck. Then press F again to come back.");
  await ctx.jim("A9.f.jim", "In the full-screen preview, the Deck was not over the image.");
  if (monitorCount() >= 2) {
    await enter("Drag the Deck (by the words on its bar) onto your other monitor. Click Lightroom's title bar and press F, look at the Deck, then press F again.");
    await ctx.jim("A9.f2.jim", "With the full-screen preview on Lightroom's monitor, the Deck stayed visible on the other monitor.");
  } else ctx.skip("A9.f2.jim", "one monitor connected");

  const td = Date.now();
  await enter("Drag the Deck by the words on its bar to a new spot where you like it, and drag its right edge to make it wider. Leave it there for the rest of the check.");
  const saved = await ctx.deck(td, (e) => e.ev === "saved", 5 * SECOND);
  ctx.record("A5.drag.log", saved !== null && saved["error"] == null, saved ? { left: saved["left"], bottom: saved["bottom"], width: saved["width"] } : undefined);

  await enter("Next: Abort while Claude is working. When you press Enter here, the check keeps working on the photo; click Abort in the Deck at once, while it says \"Claude is working\".");
  const ta = Date.now();
  const working = (async () => {
    for (let i = 0; i < 7 && ctx.engine().tools.sessionManager()?.current(); i++) await ctx.step(b.sid, { exposure: i % 2 === 0 ? 0.05 : -0.05 });
  })().catch(() => undefined); // SESSION_ENDED once the Abort lands
  const done = await ctx.ended(CLICK_MS);
  await working;
  const click = await ctx.deck(ta, (e) => ui(e, "click") === "hud_abort", 1);
  const answer = click ? await ctx.deck(click.t, (e) => ui(e, "answer") === ui(click, "click_id"), 5 * SECOND) : null;
  ctx.record("A16.log", answer !== null, { click_to_answer_ms: click && answer ? answer.t - click.t : null });
  const log = ctx.sessionLog(b.sid);
  const diff = differing(await ctx.settings(ctx.photo().uuid), ctx.photo().start);
  ctx.record("A13.back", done && log?.outcome === "aborted" && log.ended_by?.source === "hud" && diff.length === 0, { outcome: log?.outcome ?? null, differing: diff });
  await ctx.jim("A16.jim", "Right after your click, the Deck's buttons went quiet (grey) and its line said \"Abort sent; waiting for Claude.\" until the outcome showed.");
  await ctx.jim("A13.jim", "One click was enough: the Deck shows \"Done: the photo is back as it was.\"");
  await ctx.jim("A13.snapshot.jim", `In Lightroom's Develop module, the Snapshots panel (left side) lists a snapshot named "${b.snapshot}".`);
}
