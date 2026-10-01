// The menu items in the Phase 5 check (phase5-part1.ts; PRD FR-1.1, PHASE5_PLAN decision 7): Accept
// Session, Show Vision Gateway HUD and Abort Session, under File > Plug-in Extras (Info.lua). A menu
// item waits up to 20 s for the engine and reports in the HUD [handle: vault PHASE5_PLAN.md row 4, fix
// PR #46], and its event carries source "menu" [handle: engine\src\bridge\hud-protocol.ts eventBase].
//   - Session D: begin, pass 1, Jim's Accept Session: the session ends with accept from the menu; the
//     check then puts the photo back with the session's snapshot and reads it back.
//   - Show HUD: once the HUD has closed itself after session D, Jim's Show Vision Gateway HUD opens it
//     again (the plugin's "hud: shown" line).
//   - Session E: begin, pass 1, Jim's Abort Session: aborted from the menu, the photo back exactly.
//     Its time is recorded; AC-2's second is the HUD button's (phase5-session-a.ts).

import { yn } from "./phase3-config.js";
import { closeOpenSession, errorBody, failLine, type Photo } from "./phase4-config.js";
import { INTENT, MENU, STEPS, clickWait, pollOf, waitFor, waitSessionEnded, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { userEndOf } from "./phase5-ended.js";
import { readBack, sync } from "./phase5-readback.js";
import { judgeAbort } from "./phase5-session-a.js";

/** The HUD closes itself 5 s after an end (PHASE5_PLAN row 4 decision 1); 15 s is [inference]. */
const CLOSE_WAIT_MS = 15000;

export type MenuOutcome = { ok: boolean; accept: boolean; showHud: boolean; abort: boolean };

export async function menuItems(deps: Phase5Deps, run: Run, photo: Photo): Promise<MenuOutcome> {
  const out: Json = { ok: false };
  run.results["menu"] = out;
  deps.say("");
  deps.say("The menu items: two short sessions, ended from Lightroom's menu.");
  const accept = await guarded(deps, run, out, "accept", () => menuAccept(deps, run, photo, out));
  const showHud = await guarded(deps, run, out, "show_hud", () => menuShowHud(deps, run, out));
  const abort = await guarded(deps, run, out, "abort", () => menuAbort(deps, run, photo, out));
  const ok = accept && showHud && abort;
  out["ok"] = ok;
  deps.say(`  Menu items: Accept Session ${yn(accept)}; Show Vision Gateway HUD ${yn(showHud)}; Abort Session ${yn(abort)}.`);
  return { ok, accept, showHud, abort };
}

/** One menu item's part; an error fails that part, ends a session left open, and lets the next run. */
async function guarded(deps: Phase5Deps, run: Run, out: Json, part: string, fn: () => Promise<boolean>): Promise<boolean> {
  try {
    return await fn();
  } catch (err) {
    out[`${part}_error`] = errorBody(err);
    run.fail(failLine(`the menu items (${part})`, err));
    await closeOpenSession(deps, out);
    return false;
  }
}

async function beginWithPass(deps: Phase5Deps, run: Run, name: string): Promise<{ sid: string; snapshotId: string }> {
  const begin = (await deps.tools.beginSession({ intent_id: INTENT, return_image: "none" })).json;
  const sid = String(begin["session_id"]);
  run.sessions.push({ name, session_id: sid });
  await deps.tools.step({ session_id: sid, settings: STEPS[3].settings, rationale: STEPS[3].rationale, return_image: "none" });
  return { sid, snapshotId: String((begin["snapshot"] as { id?: unknown } | undefined)?.id ?? "") };
}

async function menuAccept(deps: Phase5Deps, run: Run, photo: Photo, out: Json): Promise<boolean> {
  const { sid, snapshotId } = await beginWithPass(deps, run, "D");
  await sync(deps, run);
  deps.say(`  Session D made pass 1. Now choose ${MENU.accept}.`);
  if (!(await waitSessionEnded(deps, sid))) {
    run.fail("no Accept Session came from the menu in time (session D)");
    await closeOpenSession(deps, out);
    return false;
  }
  const end = userEndOf(deps, sid, { outcome: "accept", source: "menu" });
  const back = await readBack(deps, run, "Accept Session (session D)");
  // The accepted edit stays on the photo; the check puts it back with the session's snapshot.
  await deps.client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: snapshotId }, { timeoutMs: 30000 });
  const putBack = await readBack(deps, run, "the check's put-back of session D", { expect: [{ uuid: photo.uuid, settings: photo.start }] });
  out["accept"] = { ...end, read_back_ok: back, put_back: putBack };
  if (!end.ok) run.fail(`Accept Session: the session ended as ${String(end.outcome)} from ${String(end.source)}, not accept from the menu`);
  return end.ok && back && putBack;
}

async function menuShowHud(deps: Phase5Deps, run: Run, out: Json): Promise<boolean> {
  // Session D's end closes the HUD 5 s later [handle: plugin\LrC-AVG.lrplugin\HudState.lua
  // CLOSE_AFTER_SECONDS]; the check waits for that before asking for the menu item.
  const ended = Date.now();
  await waitFor(() => deps.pluginLog.hudLineAfter(/hud: closed/, ended - CLOSE_WAIT_MS) !== null, CLOSE_WAIT_MS, pollOf(deps));
  const asked = Date.now();
  deps.say(`  The HUD should have closed by itself; if it is still open, close it with its X. Then choose ${MENU.hud}.`);
  const came = await waitFor(() => deps.pluginLog.hudLineAfter(/hud: shown/, asked) !== null, clickWait(deps), pollOf(deps));
  out["show_hud"] = { ok: came, line: deps.pluginLog.hudLineAfter(/hud: shown/, asked)?.text ?? null };
  if (!came) run.fail('the HUD did not open from the menu in time (no "hud: shown" in the plugin\'s log)');
  return came;
}

async function menuAbort(deps: Phase5Deps, run: Run, photo: Photo, out: Json): Promise<boolean> {
  const { sid } = await beginWithPass(deps, run, "E");
  await sync(deps, run);
  deps.say(`  Session E made pass 1. Now choose ${MENU.abort}.`);
  if (!(await waitSessionEnded(deps, sid))) {
    run.fail("no Abort Session came from the menu in time (session E)");
    await closeOpenSession(deps, out);
    return false;
  }
  const end = await judgeAbort(deps, run, photo, sid, "Abort Session (session E)", "menu");
  out["abort"] = end;
  return end.ok;
}
