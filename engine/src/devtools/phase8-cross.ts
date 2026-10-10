// Part 3 of the Phase 8 check (phase8-check.ts): a raw→rendered sync, as PHASE8_PLAN row 6 asks and
// its acceptance states ("Raw→rendered sync reports what it could not transfer, and transfers the rest
// exactly"). A session on the raw source ends with accept; its recipe is synced onto the JPEG; the
// JPEG must list white_balance and camera_profile as not_transferable (sync\transfer.ts) and read back
// every other copied setting as the recipe has it. The JPEG, still holding the sync, then gives the
// preset Part 4 applies (kept in the state). Both photos are put back.

import { readFileSync } from "node:fs";
import { recipeSchema } from "../log/index.js";
import { describeError } from "./phase1-check.js";
import { differingIn, errorBody, settingsOf } from "./phase4-config.js";
import { INTENT, holdBack, keptPresetName, putBack, putBackAll, selectSettled, stepsFor, yes, type Fixture, type Json, type Phase8Deps, type Run } from "./phase8-config.js";
import { presetFileProblems } from "./phase8-presets.js";
import { scriptedSession } from "./phase8-session.js";
import { partOf } from "./phase8-state.js";

/** The groups a raw recipe cannot carry onto a rendered photo (sync\transfer.ts). */
export const NOT_TRANSFERABLE = ["camera_profile", "white_balance"] as const;

export async function crossPart(deps: Phase8Deps, run: Run, raw: Fixture, jpeg: Fixture): Promise<void> {
  const out: Json = { source: raw.label, target: jpeg.label };
  run.results["cross"] = out;
  deps.say("");
  deps.say(`Part 3: a session on ${raw.label} (raw), its recipe synced onto ${jpeg.label} (rendered).`);
  let ok = false;
  try {
    ok = await cross(deps, run, raw, jpeg, out);
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(`Part 3: ${describeError(err)}`);
  }
  ok = (await putBackAll(deps, run)) && ok;
  out["ok"] = ok;
  run.state.cross = partOf(ok, out);
  run.save();
  deps.say(`Part 3, the raw→rendered sync: ${ok ? "WORKED" : "FAILED"}`);
}

async function cross(deps: Phase8Deps, run: Run, raw: Fixture, jpeg: Fixture, out: Json): Promise<boolean> {
  await selectSettled(deps, raw.uuid);
  await holdBack(deps, run, raw.uuid, raw.label);
  const session: Json = {};
  out["session"] = session;
  const s = await scriptedSession(deps, session, raw.uuid, INTENT, stepsFor("raw"), "accept");
  const recipe = recipeSchema.parse(JSON.parse(readFileSync(String(s.end["recipe_path"]), "utf8")));
  const heldJpeg = await holdBack(deps, run, jpeg.uuid, jpeg.label);
  const res = (await deps.tools.syncSeries({ source: { session_id: s.sid }, targets: { uuids: [jpeg.uuid] }, adaptive_exposure: false, return_image: "none" })).json;
  const t = ((res["targets"] as Json[] | undefined) ?? [])[0];
  const leftOut = (t?.["not_transferable"] as Array<{ group: string; names: string[] }> | undefined) ?? [];
  const groups = [...new Set(leftOut.map((g) => g.group))].sort();
  const names = Object.keys(recipe.settings).filter((n) => !leftOut.some((g) => g.names.includes(n)));
  const differing = differingIn(names, (await settingsOf(deps, jpeg.uuid)).settings, recipe.settings);
  const groupsOk = JSON.stringify(groups) === JSON.stringify([...NOT_TRANSFERABLE]);
  Object.assign(out, { applied: res["applied"], skipped: res["skipped"], target_pipeline: t?.["pipeline"] ?? null, not_transferable: leftOut, transferred: names.length, read_back_differing: differing });
  deps.say(`  not_transferable: ${groups.join(", ") || "none"} (expected ${NOT_TRANSFERABLE.join(", ")}): ${yes(groupsOk)}; the other ${names.length} settings read back as the recipe: ${yes(differing.length === 0)}`);
  const preset = await keepPreset(deps, run, jpeg, out);
  const snapshot = (t?.["snapshot"] as { id?: string } | undefined)?.id;
  const back = snapshot ? await putBack(deps, run, heldJpeg, snapshot) : ["no sync snapshot"];
  out["jpeg_undone_by_its_snapshot"] = back.length === 0;
  const ok = res["applied"] === 1 && groupsOk && differing.length === 0 && preset && back.length === 0;
  if (!ok) run.fail("Part 3: the raw→rendered sync did not work as expected (details in cross)");
  return ok;
}

/** The preset from the JPEG as the sync left it, checked in its file and kept for Part 4. */
async function keepPreset(deps: Phase8Deps, run: Run, jpeg: Fixture, out: Json): Promise<boolean> {
  await selectSettled(deps, jpeg.uuid);
  const res = (await deps.tools.createPresetFromActive({ name: keptPresetName(deps.stamp) })).json;
  const written = (res["written"] as string[] | undefined) ?? [];
  const source = (await settingsOf(deps, jpeg.uuid)).settings;
  const problems = presetFileProblems(deps.map, String(res["path"]), "rendered", written, source);
  run.state.kept_preset = { name: String(res["name"]), path: String(res["path"]), uuid: jpeg.uuid, written, source };
  run.save();
  out["preset"] = { name: res["name"], written, problems };
  deps.say(`  Preset "${String(res["name"])}" from the JPEG: ${written.length} settings, form as Lightroom writes it: ${yes(problems.length === 0)}`);
  return problems.length === 0 && written.length > 0;
}
