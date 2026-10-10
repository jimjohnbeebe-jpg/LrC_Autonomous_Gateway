// Part 2 of the Phase 8 check (phase8-check.ts): every bundled intent on the JPEG, as PHASE8_PLAN's
// acceptance asks ("All 11 bundled intents run on both pipelines in the simulator and on DSC_0031.JPG
// in Lightroom"). Each one: lr_begin_session (pass 0 writes the intent's rendered profile and
// priors), one scripted pass, lr_end_session revert with 0 settings differing.

import { describeError } from "./phase1-check.js";
import { errorBody } from "./phase4-config.js";
import { INTENT_STEP, holdBack, putBack, putBackAll, selectSettled, type Fixture, type Json, type Phase8Deps, type Run } from "./phase8-config.js";
import { passesMade, revertExact, scriptedSession } from "./phase8-session.js";
import { partOf } from "./phase8-state.js";

/** The bundled intents' ids (lr_list_intents; a user intent of the same id would override one, which the check then runs instead). */
async function bundledIntents(deps: Phase8Deps): Promise<string[]> {
  const listed = ((await deps.tools.listIntents()).json["intents"] as Array<{ id: string; source: string }> | undefined) ?? [];
  return listed.filter((i) => i.source === "bundled").map((i) => i.id);
}

export async function intentsPart(deps: Phase8Deps, run: Run, jpeg: Fixture): Promise<void> {
  const ids = await bundledIntents(deps);
  run.results["intents"] = ids;
  deps.say("");
  deps.say(`Part 2: the ${ids.length} bundled intents on ${jpeg.label}, one pass each, then revert.`);
  for (const id of ids) {
    if (run.state.intents.some((i) => i.intent === id)) continue;
    const out: Json = {};
    let ok = false;
    try {
      await selectSettled(deps, jpeg.uuid);
      const held = await holdBack(deps, run, jpeg.uuid, jpeg.label);
      const s = await scriptedSession(deps, out, jpeg.uuid, id, [INTENT_STEP], "revert");
      const passes = passesMade(s);
      const differing = await putBack(deps, run, held);
      ok = revertExact(s) && passes === 1 && differing.length === 0;
      Object.assign(out, { pipeline: s.begin["pipeline"] ?? null, profile: s.begin["camera_profile"] ?? null, passes, revert_exact: revertExact(s), put_back_differing: differing });
      if (!ok) run.fail(`intent ${id} on ${jpeg.label}: ${passes} pass(es), revert exact ${String(revertExact(s))}`);
    } catch (err) {
      out["error"] = errorBody(err);
      run.fail(`intent ${id} on ${jpeg.label}: ${describeError(err)}`);
      await putBackAll(deps, run);
    }
    run.state.intents.push({ ...partOf(ok, out), intent: id });
    run.save();
    deps.say(`  ${id}: ${ok ? "WORKED" : "FAILED"}`);
  }
}
