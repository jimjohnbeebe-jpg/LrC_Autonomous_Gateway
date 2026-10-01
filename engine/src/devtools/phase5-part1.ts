// Part 1 of the Phase 5 check (phase5-check.ts): scripted sessions on one photo with the HUD, the
// check holding the bridge and Jim clicking in the HUD and the menu.
//   0. Jim selects the photo; the settings page must read Autonomous, 4 passes (phase5-page.ts).
//   1. Session A: the HUD opens and tracks the stages, the Plug-in Manager visit (Jim sets "Approve
//      each pass"), AC-2 via the HUD's Abort (phase5-session-a.ts).
//   2. Session B: the page's mode reached the engine; Approve blocks the next pass; a wait in vain;
//      an Abort while a pass waits (phase5-session-b.ts).
//   3. Session C: AC-3 with the HUD's Pick, then the HUD's Accept (phase5-session-c.ts).
//   4. The menu items (phase5-menu.ts).
//   5. Jim removes session C's copies; the photo checked against its start.
// A session that needs an earlier one's page change is skipped when it failed. Every session is
// ended (with revert) if an error leaves it open, so the photo is put back.

import { differingSettings } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import { copyStates, type CopyState } from "./phase4-copies.js";
import { MASTER, settingsOf, select } from "./phase4-config.js";
import { PHOTO, ROUNDS, type Json, type Phase5Deps, type Photo, type Run } from "./phase5-config.js";
import { menuItems } from "./phase5-menu.js";
import { ensurePage } from "./phase5-page.js";
import { readBack } from "./phase5-readback.js";
import { sessionA } from "./phase5-session-a.js";
import { sessionB } from "./phase5-session-b.js";
import { sessionC } from "./phase5-session-c.js";

/** Part 1's acceptance lines (phase5-check.ts sums them up with Part 2's). */
export type Part1Lines = {
  page_setting_reaches_engine: boolean;
  session_rides_out_plugin_manager: boolean;
  hud_tracks_stages: boolean;
  ac2_hud_abort: boolean;
  approve_blocks_until_pressed: boolean;
  ac3_hud_pick: boolean;
  menu_items: boolean;
  photo_put_back: boolean;
};

export async function runPart1(deps: Phase5Deps, run: Run): Promise<{ ok: boolean; lines: Part1Lines }> {
  const lines: Part1Lines = { page_setting_reaches_engine: false, session_rides_out_plugin_manager: false, hud_tracks_stages: false, ac2_hud_abort: false, approve_blocks_until_pressed: false, ac3_hud_pick: false, menu_items: false, photo_put_back: false };
  deps.say("");
  deps.say("Part 1: scripted sessions with the HUD on one photo. You click in the HUD and the menu when asked.");
  const photo = await selectPhoto(deps, run, PHOTO);
  if (!photo || !(await ensurePage(deps, run, "page_at_start", "autonomous"))) return { ok: false, lines };
  try {
    await sessions(deps, run, photo, lines);
  } finally {
    // Session C's copies are offered for removal even when a later step threw.
    await removeCopies(deps, run).catch((err: unknown) => run.fail(`the copies could not be checked: ${describeError(err)}`));
  }
  lines.photo_put_back = await photoAsBefore(deps, run, photo);
  return { ok: Object.values(lines).every(Boolean) && run.errors.length === 0, lines };
}

/** Sessions A to E, each line set as its session ends. A session that needs session A's page change is skipped without it. */
async function sessions(deps: Phase5Deps, run: Run, photo: Photo, lines: Part1Lines): Promise<void> {
  const a = await sessionA(deps, run, photo);
  Object.assign(lines, { session_rides_out_plugin_manager: a.pause, hud_tracks_stages: a.stagesTracked, ac2_hud_abort: a.ac2 });
  if (a.pageChanged) {
    const b = await sessionB(deps, run, photo);
    lines.page_setting_reaches_engine = b.pageReached;
    lines.approve_blocks_until_pressed = b.blocks && b.waitInVain && b.abortWhileWaiting;
    lines.ac2_hud_abort &&= b.abortWhileWaiting;
  } else {
    deps.say("  Session B was skipped: the settings page was not set to Approve each pass during session A.");
  }
  await select(deps, photo.uuid, MASTER); // session B may have left the selection elsewhere after an error
  lines.ac3_hud_pick = (await sessionC(deps, run, photo)).ok;
  await select(deps, photo.uuid, MASTER);
  lines.menu_items = (await menuItems(deps, run, photo)).ok;
}

/** Jim selects `name` (the original, not a copy); its settings now are its start. Null after ROUNDS tries. */
export async function selectPhoto(deps: Phase5Deps, run: Run, name: string): Promise<Photo | null> {
  let text = `  In Lightroom's Filmstrip, click ${name} (the original, not a virtual copy; stay in the Develop module). Then press Enter here.`;
  for (let attempt = 1; attempt <= ROUNDS; attempt++) {
    if ((await deps.prompt(text)) === null) break;
    const ctx = await deps.client.request("get_context", {});
    if (ctx["filename"] === name && ctx["is_virtual_copy"] !== true) {
      await readBack(deps, run, `your click on ${name}`);
      const view = await settingsOf(deps, ctx.uuid);
      run.known.set(ctx.uuid, name, view.settings);
      return { uuid: ctx.uuid, local_id: ctx.local_id, process_version: view.process_version, start: view.settings };
    }
    const which = ctx["is_virtual_copy"] === true ? `a virtual copy ("${String(ctx["copy_name"])}")` : String(ctx["filename"]);
    text = `  The selected photo is ${which}, not ${name}. Click ${name} (the original), then press Enter.`;
  }
  run.fail(`${name} was not selected`);
  return null;
}

/** Jim removes session C's copies (the SDK has no call that removes a photo [handle: docs\reports\phase4\S7.md Verdict 2]); each is looked up by uuid. */
async function removeCopies(deps: Phase5Deps, run: Run): Promise<void> {
  const out: Json = {};
  run.results["copies_cleanup"] = out;
  if (run.copies.length === 0) return;
  const { say } = deps;
  say("");
  say(`  Remove the ${run.copies.length} virtual copies of ${PHOTO} that session C made (their copy names start with "AVG"):`);
  say("  1. Press G for the Library module's Grid.");
  say(`  2. The copies sit next to ${PHOTO}; each has a turned-page corner at the bottom left of its thumbnail.`);
  say("  3. Click the first copy, then Ctrl-click each of the others. Do not select the photo without the corner (the original).");
  say("  4. Press Delete. Lightroom asks whether to remove the virtual copies: click Remove.");
  say('     If the dialog offers "Delete from Disk", click Cancel: the original is selected too. Then start again at step 3.');
  let states: CopyState[] = [];
  let text = "  5. Press D to go back to the Develop module, then press Enter here.";
  for (let round = 1; round <= ROUNDS; round++) {
    if ((await deps.prompt(text)) === null) break;
    states = await copyStates(deps, run);
    const left = states.filter((s) => s.state !== "gone");
    say(`  Copies removed: ${states.length - left.length} of ${states.length}.`);
    if (left.length === 0) break;
    text = `  Still in the catalog: ${left.map((s) => `"${s.copy_name}"`).join(", ")}. Remove them as above, press D, then press Enter.`;
  }
  for (const s of states) if (s.state === "gone") run.known.remove(s.uuid);
  out["copies"] = states;
  out["all_gone"] = states.length === run.copies.length && states.every((s) => s.state === "gone");
}

/** The photo against its settings before Part 1. */
async function photoAsBefore(deps: Phase5Deps, run: Run, photo: Photo): Promise<boolean> {
  try {
    const differing = differingSettings((await settingsOf(deps, photo.uuid)).settings, photo.start);
    run.results["photo_after_part1"] = { differing };
    deps.say(`  ${PHOTO} is as it was before Part 1: ${differing.length === 0 ? "YES" : `NO (${differing.join(", ")} differ)`}.`);
    if (differing.length > 0) run.fail(`${PHOTO} is not as it was before Part 1`);
    return differing.length === 0;
  } catch (err) {
    run.fail(`${PHOTO} could not be read after Part 1: ${describeError(err)}`);
    return false;
  }
}

