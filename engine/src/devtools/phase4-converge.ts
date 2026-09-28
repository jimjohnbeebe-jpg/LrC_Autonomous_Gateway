// Session A of the Phase 4 check (phase4-check.ts): Phase 3's scripted Converge session
// (phase3-fixture.ts sessionA: pass 0, up to four scripted passes, accept) on the photo where
// Phase 3's AC-4 failed. It verifies the AC-4 fix of PHASE4_PLAN row 2 (pass 0 corrects until under,
// a step still over a limit it started within is undone) on that photo, as PHASES.md Phase 4 asks
// ("Inputs from Phase 3"). Its log and recipe are checked against their schemas (AC-5's first half),
// and its recipe is what the sync test and AC-5's replay copy (phase4-sync.ts).

import { readFileSync } from "node:fs";
import { recipeSchema, sessionLogSchema, type Recipe } from "../log/index.js";
import { clipCheckFile, describeClip, clipCheckAll, type SessionClip } from "./clip-check.js";
import { yn } from "./phase3-config.js";
import { sessionA } from "./phase3-fixture.js";
import { closeOpenSession, errorBody, failLine, type Json, type Phase4Deps, type Run } from "./phase4-config.js";

/** What the rest of the check needs of session A. */
export type Converged = { sessionId: string; recipe: Recipe; clip: SessionClip };

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));

/** Session A on the photo, accepted; null (the reason in the results) when it failed or its log or recipe is invalid. */
export async function converge(deps: Phase4Deps, run: Run): Promise<Converged | null> {
  const fx: Json = {};
  run.results["converge"] = fx;
  try {
    const a = await sessionA(deps, fx, []);
    const snapshot = (a.begin["snapshot"] ?? {}) as { id?: unknown; name?: unknown };
    // The photo now holds session A's edit: from here on, the check puts it back with this snapshot.
    run.masterSnapshot = { id: String(snapshot.id ?? ""), name: String(snapshot.name ?? "AVG pre-session ...") };
    const sa = fx["session_a"] as Json;
    const logPath = String(a.end["log_path"]);
    const recipePath = String(a.end["recipe_path"]);
    const log = sessionLogSchema.safeParse(readJson(logPath));
    const recipe = recipeSchema.safeParse(readJson(recipePath));
    const steps = log.success ? log.data.passes.filter((p) => p.kind === "step").length : 0;
    const clip = clipCheckFile("A", logPath);
    Object.assign(sa, { log_path: logPath, recipe_path: recipePath, log_valid: log.success, recipe_valid: recipe.success, steps_done: steps, ok: log.success && recipe.success && steps >= 1 && steps <= 4 });
    fx["ac4"] = clip;
    deps.say(`  Session A accepted: log valid ${yn(log.success)}, recipe valid ${yn(recipe.success)}; AC-4 on every pass: ${describeClip(clipCheckAll([clip]))}`);
    if (!recipe.success || !log.success) {
      run.fail(`session A's ${log.success ? "recipe" : "log"} does not validate against its schema`);
      return null;
    }
    return { sessionId: String(a.begin["session_id"]), recipe: recipe.data, clip };
  } catch (err) {
    fx["error"] = errorBody(err);
    run.fail(failLine("session A", err));
    await closeOpenSession(deps, fx);
    return null;
  }
}
