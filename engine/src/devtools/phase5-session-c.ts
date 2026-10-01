// Session C of the Phase 5 check (phase5-part1.ts): AC-3 with the HUD's Pick (PHASES.md Phase 5,
// "Inputs from Phase 4": "picking a variant with the HUD's Pick button continues convergence on it").
// The page still says approve_each_pass, so this also checks row 6's D1-A in Lightroom: the pick
// approves the pass it was picked at, and the next pass on the pick needs no Approve [handle:
// engine\src\session\pick.ts recordApproval(..., "pick")].
// A Variants session makes copies A, B, C with pass 0 each; one refined pass per copy (pass 1, never
// gated); the check selects each copy for Jim to look at (y/n: visibly different); Jim clicks Pick
// in the HUD; the check's next lr_step (target left out) goes to the pick and reports the HUD's pick
// in `hud_actions`; Jim clicks Accept in the HUD. Checked from the session log and recipe, as Phase
// 4's scripted Variants session was (phase4-variants.ts verifyPick).

import { readFileSync } from "node:fs";
import { recipeSchema } from "../log/index.js";
import { differingSettings } from "../params/index.js";
import { yn } from "./phase3-config.js";
import { closeOpenSession, copyOf, errorBody, failLine, select, settingsOf, type Photo } from "./phase4-config.js";
import { INTENT, STEPS, clickWait, pollOf, waitFor, waitSessionEnded, type Answer, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { sessionLogOf, userEndOf } from "./phase5-ended.js";
import { readBack, sync } from "./phase5-readback.js";

type Variant = { id: string; label: string; uuid: string; copy_name: string };

export type SessionCOutcome = { ok: boolean };

export async function sessionC(deps: Phase5Deps, run: Run, photo: Photo): Promise<SessionCOutcome> {
  const out: Json = { ok: false };
  run.results["session_c"] = out;
  deps.say("");
  deps.say("Session C (Variants): three virtual copies, your pick in the HUD, then Accept in the HUD.");
  try {
    const begin = (await deps.tools.beginSession({ intent_id: INTENT, mode: "variants", variant_count: 3, return_image: "none" })).json;
    const sid = String(begin["session_id"]);
    run.sessions.push({ name: "C", session_id: sid });
    const variants = (begin["variants"] as Variant[] | undefined) ?? [];
    const mode = (begin["session_settings"] as { approval?: unknown } | undefined)?.approval;
    for (const v of variants) {
      run.copies.push({ uuid: v.uuid, copy_name: v.copy_name, made_by: "variants" });
      run.known.set(v.uuid, `copy ${v.id} "${v.copy_name}"`, (await settingsOf(deps, v.uuid)).settings);
    }
    out["begin"] = { session_id: sid, variants: variants.map((v) => ({ id: v.id, label: v.label, uuid: v.uuid, copy_name: v.copy_name })) };
    for (const v of variants) await deps.tools.step({ session_id: sid, target: v.id as "A", settings: STEPS[0].settings, rationale: STEPS[0].rationale, return_image: "none" });
    const different = await lookAtCopies(deps, photo, variants);
    out["visibly_different"] = different;
    const picked = await hudPick(deps, run, sid, out);
    if (picked === null) throw new Error("no Pick arrived from the HUD in time");
    const after = (await deps.tools.step({ session_id: sid, settings: STEPS[2].settings, rationale: STEPS[2].rationale, return_image: "none" })).json;
    const actions = (after["hud_actions"] as Json[] | undefined) ?? [];
    const approval = (after["approval"] ?? null) as { by?: unknown } | null;
    // In approve_each_pass mode the pick approves the pass (D1-A); in autonomous mode nothing does.
    const approvedByPick = mode === "approve_each_pass" ? approval?.by === "pick" : approval === null;
    const continued = after["target"] === picked && approvedByPick && actions.some((a) => a["action"] === "pick" && a["variant"] === picked && a["source"] === "hud");
    out["after_pick"] = { ok: continued, target: after["target"], pass: after["pass"], approval, hud_actions: actions };
    const why = mode === "approve_each_pass" ? " with no Approve needed (the pick approved it)" : "";
    deps.say(`  The next pass went to copy ${picked}${why}, and Claude heard of your pick: ${yn(continued)}.`);
    const accepted = await hudAccept(deps, run, sid, out);
    const verified = await verifyPick(deps, photo, sid, variants.find((v) => v.id === picked));
    out["verified"] = verified;
    const ok = variants.length === 3 && different === "y" && continued && accepted && verified["ok"] === true;
    out["ok"] = ok;
    if (!ok) run.fail("AC-3 with the HUD's Pick did not pass (details in session_c)");
    return { ok };
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("session C", err));
    await closeOpenSession(deps, out);
    return { ok: false };
  }
}

/** The check selects each copy in turn for Jim to look at; whether they looked visibly different. */
async function lookAtCopies(deps: Phase5Deps, photo: Photo, variants: readonly Variant[]): Promise<Answer> {
  deps.say("  Look at the three copies. The check selects each one in Lightroom in turn.");
  for (const v of variants) {
    await select(deps, v.uuid, copyOf(photo, v.copy_name));
    if ((await deps.prompt(`  Lightroom now shows copy ${v.id} (${v.label}), "${v.copy_name}". Look at it, then press Enter.`)) === null) return "no answer";
  }
  return deps.ask("5. Did the three copies look visibly different from each other?");
}

/** Jim's Pick in the HUD: the letter the engine picked, or null when none came in time. */
async function hudPick(deps: Phase5Deps, run: Run, sid: string, out: Json): Promise<string | null> {
  await sync(deps, run);
  deps.say('  In the HUD, "Pick A", "Pick B" and "Pick C" are now on. Click the one for the copy you liked best.');
  const pickedNow = (): string | null => {
    try {
      return sessionLogOf(deps, sid).log.picked;
    } catch {
      return null;
    }
  };
  const came = await waitFor(() => pickedNow() !== null, clickWait(deps), pollOf(deps));
  const picked = came ? pickedNow() : null;
  out["picked"] = picked;
  await readBack(deps, run, "your Pick (session C)");
  if (picked) deps.say(`  You picked copy ${picked}.`);
  return picked;
}

/** Jim's Accept in the HUD ends the session with the pick kept. */
async function hudAccept(deps: Phase5Deps, run: Run, sid: string, out: Json): Promise<boolean> {
  await sync(deps, run);
  deps.say("  Now click Accept in the HUD.");
  if (!(await waitSessionEnded(deps, sid))) {
    run.fail("no Accept arrived from the HUD in time (session C); the check ended the session with revert");
    await closeOpenSession(deps, out); // an open session would refuse the next begin (SESSION_ALREADY_ACTIVE)
    return false;
  }
  const end = userEndOf(deps, sid, { outcome: "accept", source: "hud" });
  const back = await readBack(deps, run, "your Accept (session C)");
  out["accept"] = { ...end, read_back_ok: back };
  deps.say(`  Accepted from the HUD: ${yn(end.ok)}.`);
  return end.ok && back;
}

/** From the session's log and recipe: the pick, its passes, the recipe's photo; and the original as before. */
async function verifyPick(deps: Phase5Deps, photo: Photo, sid: string, pick: Variant | undefined): Promise<Json> {
  if (!pick) return { ok: false, error: "the pick is not one of the copies" };
  const { log } = sessionLogOf(deps, sid);
  const recipe = log.recipe_path ? recipeSchema.parse(JSON.parse(readFileSync(log.recipe_path, "utf8"))) : null;
  const steps = log.passes.filter((p) => p.kind === "step");
  const onPick = steps.filter((p) => p.target === pick.id).length;
  const lastOnPick = steps.at(-1)?.target === pick.id;
  const masterDiffering = differingSettings((await settingsOf(deps, photo.uuid)).settings, photo.start);
  const ok = log.picked === pick.id && onPick >= 2 && lastOnPick && recipe?.source.uuid === pick.uuid && masterDiffering.length === 0;
  return { ok, log_picked: log.picked, steps_on_pick: onPick, last_step_on_pick: lastOnPick, recipe_photo: recipe?.source.uuid ?? null, master_differing: masterDiffering };
}
