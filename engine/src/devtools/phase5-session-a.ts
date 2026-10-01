// Session A of the Phase 5 check (phase5-part1.ts): a Converge session in Autonomous mode on the
// photo, with the HUD.
//   - The HUD opens by itself at lr_begin_session (PHASE5_PLAN decision 6) and follows the stages
//     (AC-1's "with the HUD tracking stages"): the plugin's "hud: shown" line, the stages the check's
//     engine sent (phase5-trace.ts), and Jim's y/n.
//   - Pass 1, then the Plug-in Manager visit, with pass 2 sent into the pause (phase5-pause.ts).
//   - AC-2 via the HUD's Abort (PRD section 10: "Abort from the HUD mid-session restores the
//     pre-session snapshot within 1 s"; decision 3: with no command in flight): the click's time to
//     the photo back (phase5-ended.ts), and every setting read back against the start.

import { yn } from "./phase3-config.js";
import { closeOpenSession, errorBody, failLine, type Photo } from "./phase4-config.js";
import { AC2_BUDGET_MS, INTENT, STEPS, waitFor, waitSessionEnded, type Answer, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { userEndOf, type UserEndReport } from "./phase5-ended.js";
import { pauseVisit } from "./phase5-pause.js";
import { readBack, sync } from "./phase5-readback.js";
import { stagesOf, tracked } from "./phase5-trace.js";

/** How long after the end the HUD closes itself, plus slack: 5 s (PHASE5_PLAN row 4 decision 1) [inference: 10 s of slack]. */
const CLOSE_WAIT_MS = 15000;

export type SessionAOutcome = { ok: boolean; ac2: boolean; stagesTracked: boolean; pause: boolean; pageChanged: boolean; sid: string | null };

export async function sessionA(deps: Phase5Deps, run: Run, photo: Photo): Promise<SessionAOutcome> {
  const out: Json = { ok: false };
  run.results["session_a"] = out;
  const none: SessionAOutcome = { ok: false, ac2: false, stagesTracked: false, pause: false, pageChanged: false, sid: null };
  const { say } = deps;
  say("");
  say("Session A (Autonomous): the HUD opens by itself and follows the work. Watch it; questions come at the end.");
  try {
    const started = Date.now();
    const begin = (await deps.tools.beginSession({ intent_id: INTENT, return_image: "none" })).json;
    const sid = String(begin["session_id"]);
    run.sessions.push({ name: "A", session_id: sid });
    out["begin"] = { session_id: sid, session_settings: begin["session_settings"] ?? null, snapshot: begin["snapshot"] ?? null };
    const shown = await waitFor(() => deps.pluginLog.hudLineAfter(/hud: shown/, started) !== null, 5000, 250);
    out["hud_shown_line"] = deps.pluginLog.hudLineAfter(/hud: shown/, started)?.text ?? null;
    const p1 = (await deps.tools.step({ session_id: sid, settings: STEPS[0].settings, rationale: STEPS[0].rationale, return_image: "none" })).json;
    out["pass_1"] = { pass: p1["pass"], history_names: p1["history_names"] };
    say(`  Session A began and made pass 1 (the plugin logged the HUD opening: ${yn(shown)}).`);
    const pause = await pauseVisit(deps, run, sid);
    out["pause"] = pause;
    const ac2 = await hudAbort(deps, run, photo, sid);
    out["ac2"] = ac2;
    const stages = stagesOf(deps.hudTrace, sid);
    const closed = await waitFor(() => deps.pluginLog.hudLineAfter(/hud: closed/, Date.parse(String(ac2["received"] ?? new Date().toISOString()))) !== null, CLOSE_WAIT_MS, 250);
    out["stages"] = stages;
    out["hud_closed_itself"] = closed;
    const jim = await questions(deps);
    out["jim"] = jim;
    const stagesTracked = tracked(stages) && jim.opened === "y" && jim.followed === "y";
    out["ok"] = ac2.ok && stagesTracked && pause.ok && pause.page_ok && jim.aborted === "y";
    deps.say(`  Session A: HUD tracked the stages ${yn(stagesTracked)} (${stages.join(" > ") || "none seen"}); rode out the pause ${yn(pause.ok)}; AC-2 ${yn(ac2.ok)}.`);
    return { ok: out["ok"] === true, ac2: ac2.ok, stagesTracked, pause: pause.ok, pageChanged: pause.page_ok, sid };
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("session A", err));
    await closeOpenSession(deps, out);
    return none;
  }
}

/** AC-2: Jim's Abort in the HUD; the photo back, timed from the click, read back against the start. */
export async function hudAbort(deps: Phase5Deps, run: Run, photo: Photo, sid: string): Promise<UserEndReport> {
  await sync(deps, run);
  deps.say("");
  deps.say("  Now click Abort in the HUD.");
  if (!(await waitSessionEnded(deps, sid))) {
    run.fail("AC-2: no Abort arrived from the HUD in time; the check put the photo back itself");
    const out: Json = {};
    await closeOpenSession(deps, out);
    return { ok: false, outcome: null, source: null, click_to_end_ms: null, interrupted: null, log_path: null, closed: out };
  }
  return judgeAbort(deps, run, photo, sid, "the HUD's Abort", "hud");
}

/** An Abort's report: aborted from `source`, the photo exactly back, within AC-2's second for the HUD. */
export async function judgeAbort(deps: Phase5Deps, run: Run, photo: Photo, sid: string, what: string, source: "hud" | "menu"): Promise<UserEndReport> {
  const end = userEndOf(deps, sid, { outcome: "aborted", source });
  const back = await readBack(deps, run, what, { expect: [{ uuid: photo.uuid, settings: photo.start }] });
  const inTime = end.click_to_end_ms !== null && end.click_to_end_ms <= AC2_BUDGET_MS;
  const ok = end.ok && back && (source === "menu" || inTime);
  deps.say(`  ${what[0]?.toUpperCase() ?? ""}${what.slice(1)}: the photo is back as before the session ${yn(back)}; from the click: ${end.click_to_end_ms === null ? "not measured" : `${end.click_to_end_ms} ms`}${source === "hud" ? ` (AC-2: within ${AC2_BUDGET_MS} ms ${yn(inTime)})` : ""}.`);
  if (!ok) run.fail(`${what}: ${!end.ok ? `the session ended as ${String(end.outcome)} from ${String(end.source)}` : !back ? "the photo is not back as before the session" : `the photo was back ${String(end.click_to_end_ms)} ms after the click, not within ${AC2_BUDGET_MS} ms`}`);
  return { ...end, ok, photo_back: back, within_budget: inTime };
}

async function questions(deps: Phase5Deps): Promise<{ opened: Answer; followed: Answer; aborted: Answer }> {
  const opened = await deps.ask("1. When session A began, did the HUD open by itself?");
  const followed = await deps.ask('2. Did its Stage line follow the work (for example "Pass 0", "Applying pass", "Acquiring preview", "Awaiting Claude")?');
  const aborted = await deps.ask('3. After your Abort, did the HUD say "Aborted: the photo is back as it was before the session." and close itself a few seconds later?');
  return { opened, followed, aborted };
}
