// Edits 3 to 5 of the Phase 7 check (row 6), as edits-a.ts runs edits 1 and 2.
//   E3: the spot from E2 (A5), Approve each pass with Enter (A11), Ctrl+Backspace and Esc (A14, A15).
//   E4: Variants: no Accept before a pick (A18), the copy cards (A17), another photo selected (A21), a
//       card click shows that copy (A17, E12), 3 then Enter picks (A17); Jim removes the copies.
//   E5: a remembered spot on no monitor falls back to the bottom centre (A5); window.json put back after.
// A pointer action hands the keyboard back to Lightroom with a `focus_lightroom` line "pointer_<action>"
// (hud\ui\deck.ts act); a key does not, so its absence tells Enter from a click. A click on the Deck's
// sentence gives it the keyboard [handle: docs\reports\phase7\deck-ui.md "Observed", row 4c probe].
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WINDOW_JSON, enter, stopDeck } from "../kit.ts";
import { createdMs, ui } from "./budgets.ts";
import { Ctx } from "./ctx.ts";

const SECOND = 1000;
const CLICK_MS = 180 * SECOND;
type Variant = { id: string; uuid: string; copy_name: string };

/** Lightroom's selected photo (the active one), or null. */
async function selected(ctx: Ctx): Promise<string | null> {
  const sel = await ctx.engine().client.request("get_selection", { max: 1 }).catch(() => null);
  return sel?.photos?.[0]?.uuid ?? null;
}

/** Waits up to `ms` for Lightroom's selection to be `uuid`. */
async function selects(ctx: Ctx, uuid: string | undefined, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await selected(ctx)) === uuid) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

export async function e3(ctx: Ctx): Promise<void> {
  ctx.say("Edit 3: Approve each pass. The check asks you to set the Mode, then sets nothing else.");
  const spot = existsSync(WINDOW_JSON) ? (JSON.parse(readFileSync(WINDOW_JSON, "utf8")) as { left?: number; bottom?: number; width?: number }) : null;
  // Saved before Jim changes it: a stopped run, or the next start, asks for Autonomous back (ctx.ts ensureMode).
  ctx.state.mode_changed = true;
  ctx.save();
  const b = await ctx.begin({}, "approve_each_pass");
  const place = await ctx.deck(b.t0, (e) => e.ev === "place" && e["why"] === "remembered", 10 * SECOND);
  const got = (place?.["got"] as number[] | undefined) ?? [];
  const near = (a: number | undefined, x: number | undefined): boolean => a !== undefined && x !== undefined && Math.abs(a - x) <= 2;
  const [left, top, width, height] = got;
  ctx.record("A5.there.log", near(left, spot?.left) && near(width, spot?.width) && near(top !== undefined && height !== undefined ? top + height : undefined, spot?.bottom), { saved: spot, got });
  await ctx.jim("A5.there.jim", "The Deck opened at the spot where you left it in edit 2, at the width you gave it.");

  await ctx.step(b.sid, { exposure: 0.1 });
  await ctx.jim("A11.jim", "The Deck says \"Your turn: approve pass 1 so Claude can go on.\", \"Approve pass 1\" is its only filled button, and the line under it says \"Lets Claude write pass 2.\"");
  const ta = Date.now();
  ctx.say("Click the words at the Deck's left (its sentence) to give the Deck the keyboard, then press Enter on your keyboard. (The check sees it; nothing to type here.)");
  const approve = await ctx.deck(ta, (e) => ui(e, "click") === "hud_approve_pass", CLICK_MS);
  const pointer = approve ? ctx.deckBetween(ta, approve.t + SECOND).some((e) => e.ev === "focus_lightroom" && e["why"] === "pointer_approve") : true;
  ctx.record("A11.enter.log", approve !== null && !pointer && ui(approve, "pass") === 1, { pointer });

  await ctx.step(b.sid, { exposure: -0.05 });
  await enter("Click the Deck's sentence again. Press Ctrl+Backspace once and look at the Abort button. Then press Esc and look at it again.");
  await ctx.jim("A14.arm.jim", "After Ctrl+Backspace the Abort button read \"Press again to abort\"; after Esc it read \"Abort\" again, and nothing was aborted.");
  await enter("Click the Deck's sentence once more, then press Esc. Then, in Lightroom, press \\ twice.");
  ctx.record("A15.open.log", ctx.engine().tools.sessionManager()?.current()?.id === b.sid);
  await ctx.jim("A15.jim", "Esc did not abort the edit (the Deck still says \"Your turn\"), and the keyboard went back to Lightroom: \\ switched Before and After.");

  const tk = Date.now();
  ctx.say("Click the Deck's sentence once more, then press Ctrl+Backspace twice. (The check sees it; nothing to type here.)");
  const done = await ctx.ended(CLICK_MS);
  const log = ctx.sessionLog(b.sid);
  const key = ctx.deckBetween(tk, Date.now()).find((e) => ui(e, "click") === "hud_abort");
  ctx.record("A14.abort.log", done && key !== undefined && log?.outcome === "aborted" && log.ended_by?.source === "hud", { outcome: log?.outcome ?? null });
  await ctx.jim("A14.abort.jim", "The second Ctrl+Backspace aborted the edit: the Deck shows \"Done: the photo is back as it was.\"");
  ctx.say("Now set the Mode back to Autonomous.");
  await ctx.ensureMode("autonomous");
}

export async function e4(ctx: Ctx): Promise<void> {
  ctx.say("Edit 4: three copies, and your pick. The check makes virtual copies A, B and C of your photo.");
  // Copies left by an earlier try are removed first, so a retry never adds to them (Greptile, PR #91).
  if (ctx.state.copies.length > 0) await removeCopies(ctx);
  const b = await ctx.begin({ intent_id: "landscape_golden_hour", mode: "variants", variant_count: 3 }).catch((err: unknown) => {
    // A begin that made only some copies names them (engine\src\session\copies.ts VARIANTS_INCOMPLETE `details.copies`).
    const made = ((err as { details?: { copies?: { uuid?: string }[] } }).details?.copies ?? []).flatMap((x) => (x.uuid ? [x.uuid] : []));
    ctx.state.copies.push(...made);
    ctx.save();
    throw err;
  });
  const variants = (b.json["variants"] as Variant[] | undefined) ?? [];
  ctx.state.copies.push(...variants.map((v) => v.uuid));
  ctx.save();
  for (const v of variants) await ctx.step(b.sid, { exposure: 0.05 }, { target: v.id });
  const uuidOf = (id: string): string | undefined => variants.find((v) => v.id === id)?.uuid;

  await ctx.jim("A18.jim", "The Deck says \"Your turn: pick a copy, or tell Claude which one.\" and offers no Accept button.");
  await ctx.jim("A17.cards.jim", "The Deck shows three copy cards, A, B and C, each with its look (a small image) and its name.");

  const tc = Date.now();
  ctx.say("In Lightroom's Filmstrip (along the bottom), click a different photo: not yours and not one of its copies. Watch the Deck. (The check sees it; nothing to type here.)");
  // The Deck draws "Target changed" from the state's selection (hud\ui\view.ts bandOf), not from a stage: the stage
  // stays at the pick. hud 0.3.2 logs `in_edit` with each state (run 1 waited for a stage that never comes).
  const changed = await ctx.deck(tc, (e) => ui(e, "in_edit") === false, CLICK_MS);
  const sel = await selected(ctx);
  const inEdit = sel !== null && [ctx.photo().uuid, ...variants.map((v) => v.uuid)].includes(sel);
  ctx.record("A21.log", changed !== null, { deck_in_edit_false_ms: changed ? changed.t - tc : null, lightroom_selection_in_edit: inEdit });
  await ctx.jim("A21.jim", "Within about 2 seconds of your click, the Deck showed a line starting \"Target changed:\".");
  const tb = Date.now();
  await ctx.selectPhoto(); // the edit's photo again, so the Deck is back at the pick
  await ctx.deck(tb, (e) => ui(e, "in_edit") === true, 10 * SECOND);

  const tk = Date.now();
  ctx.say("Click copy B's card in the Deck. (The check sees it; nothing to type here.)");
  const chose = await ctx.deck(tk, (e) => ui(e, "choose") === "B", CLICK_MS);
  ctx.record("A17.click.log", chose !== null && (await selects(ctx, uuidOf("B"), 10 * SECOND)));
  await ctx.jim("A17.click.jim", "Lightroom now shows copy B: the photo shows copy B's look, and the selected Filmstrip thumbnail is copy B (with a turned-page corner).");

  const tp = Date.now();
  // After a pick Accept is the Deck's primary button, so a second Enter accepts copy C (run 1, 03:10:25 UTC).
  ctx.say("Click the Deck's sentence to give it the keyboard, then press 3, then Enter once. Do not press Enter again: after the pick, Enter would accept. (The check sees it; nothing to type here.)");
  const pick = await ctx.deck(tp, (e) => ui(e, "click") === "hud_pick", CLICK_MS);
  const pointer = pick ? ctx.deckBetween(tp, pick.t + SECOND).some((e) => e.ev === "focus_lightroom" && String(e["why"]).startsWith("pointer_")) : true;
  ctx.record("A17.keys.log", pick !== null && ui(pick, "variant") === "C" && !pointer, { variant: pick ? ui(pick, "variant") : null, pointer });
  ctx.record("A17.picked.log", await selects(ctx, uuidOf("C"), 10 * SECOND));
  await ctx.jim("A17.picked.jim", "The Deck marks copy C as Picked, and Lightroom shows copy C.");

  await ctx.engine().tools.endSession({ session_id: b.sid, outcome: "revert" }).catch(() => undefined);
  await removeCopies(ctx);
}

/**
 * Jim removes the copies: the bridge has no command that deletes a photo (engine\src\bridge\protocol.ts
 * COMMANDS). The steps are Phase 5's, which Jim followed (docs\reports\phase5\PHASE5.md "Steps for Jim"
 * step 14); the check looks each copy up by uuid (the plugin answers unknown_photo, as Phase 5's
 * engine\src\devtools\phase5-readback.ts relies on).
 */
export async function removeCopies(ctx: Ctx): Promise<void> {
  const name = ctx.photo().filename;
  for (let round = 0; round < 3 && ctx.state.copies.length > 0; round++) {
    await enter([
      round === 0 ? `Remove the ${ctx.state.copies.length} copies of ${name}:` : `Lightroom still has ${ctx.state.copies.length} of the copies of ${name}. Do the steps again, and press Enter only after Remove:`,
      "  1. Press G for the Library Grid.",
      `  2. Click the first copy next to ${name} (each copy has a turned-page corner), then Ctrl-click the other copies. Do not select the original.`,
      "  3. Press Delete and click Remove.",
      "  4. Press D for Develop.",
    ].join("\n"));
    // Looked up for up to 10 s: run 1 found all three still there twice, 35 s apart, though Jim removed them
    // [handle: docs\reports\phase7\PHASE7.md "Observed", run 1, E4]; when they went is [unverified].
    for (let i = 0; i < 10; i++) {
      const left: string[] = [];
      for (const uuid of ctx.state.copies) {
        const gone = await ctx.engine().client.request("get_settings", { photo_uuid: uuid }).then(() => false, (err: { code?: string }) => err?.code === "unknown_photo");
        if (!gone) left.push(uuid);
      }
      ctx.state.copies = left;
      ctx.save();
      if (left.length === 0) break;
      await new Promise((r) => setTimeout(r, SECOND));
    }
  }
  ctx.record("copies.removed", ctx.state.copies.length === 0, ctx.state.copies.length ? { left: ctx.state.copies } : undefined);
  // E4 stays unfinished while copies remain: the next run asks for them again before anything else in E4.
  if (ctx.state.copies.length > 0) throw new Error(`${ctx.state.copies.length} copies of ${name} are still in the catalog`);
}

export async function e5(ctx: Ctx): Promise<void> {
  ctx.say("Edit 5: the Deck's remembered spot on no monitor. The check stops the Deck, writes a spot far off every monitor into its window.json, and starts an edit.");
  stopDeck();
  const before = existsSync(WINDOW_JSON) ? readFileSync(WINDOW_JSON, "utf8") : "";
  const width = (JSON.parse(before || "{}") as { width?: number }).width ?? 1200;
  ctx.state.spot_backup = before;
  ctx.save();
  mkdirSync(path.dirname(WINDOW_JSON), { recursive: true }); // a Deck that never saved a spot has no folder yet (dry run, 2026-10-06)
  writeFileSync(WINDOW_JSON, JSON.stringify({ left: -60000, bottom: -60000, width }));
  try {
    const b = await ctx.begin({});
    const spot = await ctx.deck(b.t0, (e) => e.ev === "spot", 10 * SECOND);
    const shown = await ctx.deck(b.t0, (e) => e.ev === "show", 10 * SECOND);
    const created = shown ? createdMs(shown.pid) : null;
    if (shown && created !== null && created >= b.t0 - 2 * SECOND) ctx.state.cold.push({ pid: shown.pid, created });
    ctx.record("A5.fallback.log", spot !== null && spot["remembered"] === false && Array.isArray(spot["saved"]), { saved: spot?.["saved"] ?? null });
    await ctx.jim("A5.fallback.jim", "The Deck opened at the bottom centre of the monitor Lightroom is on.");
    await ctx.engine().tools.endSession({ session_id: b.sid, outcome: "revert" }).catch(() => undefined);
  } finally {
    restoreSpot(ctx);
  }
}

/** Puts back the window.json E5 replaced (the Deck stopped first: it saves its spot after it is placed). */
export function restoreSpot(ctx: Ctx): void {
  const before = ctx.state.spot_backup;
  if (before === null) return;
  stopDeck();
  if (before === "") rmSync(WINDOW_JSON, { force: true });
  else writeFileSync(WINDOW_JSON, before);
  ctx.state.spot_backup = null;
  ctx.save();
}
