// One photo of the Phase 3 check's Part 1, once Jim has selected it (phase3-check.ts): its golden
// JPEG; session A (pass 0, the scripted passes, accept) with its log, recipe and AC-5 replay, and
// the put-back; on the first photo the region crop; session B (a probe, on the first photo the
// selection guard, one pass, revert: AC-2). AC-4 counts every pass of sessions A and B
// (clip-check.ts, PHASE4_PLAN decision 1) [handle: tests\phase3-check.test.ts "counts AC-4 on
// session B too, not only session A (PHASE4_PLAN decision 1)"].

import { readFileSync } from "node:fs";
import { recipeSchema, sessionLogSchema, type Recipe } from "../log/index.js";
import { ToolError } from "../mcp/index.js";
import { differingSettings } from "../params/index.js";
import { clipCheckAll, clipCheckFile, describeClip, type SessionClip } from "./clip-check.js";
import { describeError } from "./phase1-check.js";
import {
  INTENT_A,
  INTENT_B,
  REGION,
  REPLAY_HISTORY_NAME,
  REVERT_BUDGET_MS,
  SCRIPT,
  WRITE_TIMEOUT_MS,
  brief,
  errorBody,
  historyOf,
  summary,
  yn,
  type Json,
  type Phase3Deps,
} from "./phase3-config.js";

type Snapshot = { id: string; name: string };

const photoUuid = (fx: Json): string => String((fx["photo"] as Json)["uuid"]);
const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const issues = (error: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> }): string[] =>
  error.issues.slice(0, 5).map((i) => `${i.path.map(String).join(".")}: ${i.message}`);

export async function runFixture(deps: Phase3Deps, name: string, fx: Json, first: boolean, passDurations: number[]): Promise<void> {
  const photo = fx["photo"] as Json;
  if (photo["settings_error"]) throw new Error(`the photo's settings cannot be read (${JSON.stringify(photo["settings_error"])})`);
  const history: string[] = [];
  fx["history_names"] = history;
  await saveGolden(deps, name, fx);
  const a = await sessionA(deps, fx, history);
  const clipA = await checkSessionA(deps, fx, a, history, passDurations);
  if (first) await regionCrop(deps, fx);
  const clipB = await sessionB(deps, name, fx, first, history);
  const ac4 = clipCheckAll([clipA, clipB]);
  fx["ac4"] = ac4;
  deps.say(`  AC-4, clipping within the limits on every pass of sessions A and B: ${describeClip(ac4)}`);
  fx["status"] = "done";
}

/** 1. The golden JPEG: the photo as it is. */
async function saveGolden(deps: Phase3Deps, name: string, fx: Json): Promise<void> {
  const golden = await deps.tools.getPreview({ long_edge: 1600 });
  const goldenFile = deps.saveGolden(name, golden.image as Buffer);
  fx["golden"] = { saved_as: goldenFile, preview_hash: golden.json["preview_hash"], width: golden.json["width"], height: golden.json["height"], bytes: golden.json["bytes"], metrics: golden.json["metrics"] };
  deps.say(`  Golden JPEG saved (${String(golden.json["width"])}x${String(golden.json["height"])}).`);
}

/** 2. Session A: pass 0, the scripted passes, accept. Returns lr_begin_session's and lr_end_session's results. Phase 4's check runs it too. */
export async function sessionA(deps: Pick<Phase3Deps, "tools" | "say">, fx: Json, history: string[]): Promise<{ begin: Json; end: Json }> {
  const a: Json = { ok: false, passes: [] as Json[] };
  fx["session_a"] = a;
  const begin = (await deps.tools.beginSession({ intent_id: INTENT_A, return_image: "none" })).json;
  const sid = String(begin["session_id"]);
  history.push(...historyOf(begin));
  a["session_id"] = sid;
  a["pass0"] = { history_names: begin["history_names"], applied: begin["pass0_applied"], guardrail_actions: begin["guardrail_actions"], metrics: brief(begin["metrics"]) };
  deps.say(`  Session A (${INTENT_A}): pass 0 done, ${summary(begin)}`);
  for (const step of SCRIPT) {
    const pass: Json = { requested: step.settings };
    (a["passes"] as Json[]).push(pass);
    if (await scriptedPass(deps, sid, step, pass, history)) break;
  }
  const end = (await deps.tools.endSession({ session_id: sid, outcome: "accept" })).json;
  return { begin, end };
}

/** One scripted pass of session A, recorded in `pass`. True when the session converged or reached its cap. */
async function scriptedPass(deps: Pick<Phase3Deps, "tools" | "say">, sid: string, step: (typeof SCRIPT)[number], pass: Json, history: string[]): Promise<boolean> {
  try {
    const out = (await deps.tools.step({ session_id: sid, settings: step.settings, rationale: step.rationale, return_image: "none" })).json;
    history.push(...historyOf(out));
    Object.assign(pass, {
      pass: out["pass"],
      history_names: out["history_names"],
      applied: out["applied"],
      clamped: out["clamped"],
      refused: out["refused"],
      guardrail_actions: out["guardrail_actions"],
      converged_by_metrics: out["converged_by_metrics"],
      cap_reached: out["cap_reached"],
      metrics: brief(out["metrics"]),
      total_ms: (out["timings"] as { total_ms?: number } | undefined)?.total_ms ?? null,
    });
    deps.say(`  ${String(out["pass"])}: ${summary(out)}`);
    return out["converged_by_metrics"] === true || out["cap_reached"] === true;
  } catch (err) {
    pass["error"] = errorBody(err);
    deps.say(`  pass refused: ${describeError(err)}`);
    const code = err instanceof ToolError ? err.code : "";
    if (code !== "GUARDRAIL_REFUSED" && code !== "NO_CHANGE") throw err;
    return false;
  }
}

/**
 * Session A's log and recipe against their schemas, its AC-4 and pass times, and AC-5's replay.
 * Session A is closed now, so an error from here on would leave the accepted edit (or the replay)
 * on the photo: the pre-session snapshot is applied in `finally`, whatever happens before it
 * (Greptile, PR #24). Its id and name come from lr_begin_session's result, not from the log.
 */
async function checkSessionA(deps: Phase3Deps, fx: Json, a: { begin: Json; end: Json }, history: string[], passDurations: number[]): Promise<SessionClip> {
  const sa = fx["session_a"] as Json;
  const logPath = String(a.end["log_path"]);
  const recipePath = String(a.end["recipe_path"]);
  Object.assign(sa, { log_path: logPath, recipe_path: recipePath });
  const snapshot = (a.begin["snapshot"] ?? {}) as { id?: unknown; name?: unknown };
  const snap: Snapshot = { id: String(snapshot.id ?? ""), name: String(snapshot.name ?? "AVG pre-session ...") };
  const putBack: Json = { ok: false, snapshot: snap.name };
  fx["put_back"] = putBack;
  const ac5: Json = { ok: false };
  fx["ac5"] = ac5;
  const clip = clipCheckFile("A", logPath);
  try {
    const parsedLog = sessionLogSchema.safeParse(readJson(logPath));
    const parsedRecipe = recipeSchema.safeParse(readJson(recipePath));
    const stepsDone = parsedLog.success ? parsedLog.data.passes.filter((p) => p.kind === "step").length : 0;
    Object.assign(sa, { ok: parsedLog.success && stepsDone >= 1 && stepsDone <= 4, steps_done: stepsDone });
    fx["ac4"] = clipCheckAll([clip]); // session B's passes are added when it ends
    if (parsedLog.success) for (const p of parsedLog.data.passes) if (p.kind === "step") passDurations.push(p.duration_ms);
    deps.say(`  Session A accepted: log valid ${yn(parsedLog.success)}, recipe valid ${yn(parsedRecipe.success)}`);
    Object.assign(ac5, { log_valid: parsedLog.success, recipe_valid: parsedRecipe.success });
    if (!parsedLog.success) ac5["log_issues"] = issues(parsedLog.error);
    if (!parsedRecipe.success) ac5["recipe_issues"] = issues(parsedRecipe.error);
    if (parsedLog.success && parsedRecipe.success) await replay(deps, fx, snap, parsedRecipe.data, ac5, history);
  } catch (err) {
    ac5["error"] = errorBody(err);
    throw err;
  } finally {
    await putPhotoBack(deps, fx, snap, putBack);
  }
  return clip;
}

/**
 * AC-5 as decided for Phase 3 (decision 1): the pre-session snapshot, then the recipe as one write,
 * read back. Values are compared within the read-back tolerance, as every write is (Greptile, PR #24).
 */
async function replay(deps: Phase3Deps, fx: Json, snap: Snapshot, recipe: Recipe, ac5: Json, history: string[]): Promise<void> {
  const { client, map } = deps;
  const uuid = photoUuid(fx);
  await client.request("apply_snapshot", { target_uuid: uuid, snapshot_id: snap.id }, { timeoutMs: WRITE_TIMEOUT_MS });
  const sdk = map.toSdk(recipe.settings, { processVersion: recipe.process_version, pipeline: "raw" }); // the Phase 3 fixtures are raw files
  const replayed = await client.request("apply_settings", { target_uuid: uuid, settings: sdk, history_name: REPLAY_HISTORY_NAME }, { timeoutMs: WRITE_TIMEOUT_MS });
  history.push(REPLAY_HISTORY_NAME);
  const differing = differingSettings(map.fromSdk(replayed.read_back).settings, recipe.settings);
  Object.assign(ac5, { replay_differing: differing, readback_mismatches: map.verifyReadback(sdk, replayed.read_back).map((m) => m.sdk_key), ok: differing.length === 0 });
  deps.say(`  AC-5 replay of the recipe after the snapshot: ${differing.length === 0 ? "exact" : `${differing.length} setting(s) differ: ${differing.join(", ")}`}`);
}

/** Leave the photo as it was: the pre-session snapshot again, compared with the settings read before the check. */
async function putPhotoBack(deps: Phase3Deps, fx: Json, snap: Snapshot, putBack: Json): Promise<void> {
  try {
    const back = await deps.client.request("apply_snapshot", { target_uuid: photoUuid(fx), snapshot_id: snap.id }, { timeoutMs: WRITE_TIMEOUT_MS });
    const off = differingSettings(deps.map.fromSdk(back.read_back).settings, (fx["start_settings"] ?? {}) as Record<string, unknown>);
    Object.assign(putBack, { ok: off.length === 0, differing: off });
    if (off.length > 0) deps.say(`  The photo is NOT as before the check (${off.join(", ")} differ). In the Snapshots panel, click "${snap.name}".`);
  } catch (err) {
    Object.assign(putBack, { ok: false, error: errorBody(err) });
    deps.say(`  The photo was NOT put back (${describeError(err)}). In the Snapshots panel, click "${snap.name}".`);
  }
}

/** First fixture: a region crop, with the context's size. */
async function regionCrop(deps: Phase3Deps, fx: Json): Promise<void> {
  const photo = fx["photo"] as Json;
  try {
    const crop = await deps.tools.getPreview({ long_edge: 800, region: REGION });
    fx["region"] = {
      region: REGION,
      export_long_edge: crop.json["export_long_edge"],
      width: crop.json["width"],
      height: crop.json["height"],
      effective_scale: crop.json["effective_scale"],
      scale_in_export: crop.json["scale_in_export"],
      context_width: photo["width"],
      context_height: photo["height"],
      timings: crop.json["timings"],
    };
    deps.say(`  Region crop: export ${String(crop.json["export_long_edge"])} px, effective scale ${String(crop.json["effective_scale"])}.`);
  } catch (err) {
    fx["region"] = { error: errorBody(err) };
    deps.say(`  Region crop FAILED: ${describeError(err)}`);
  }
}

/** 3. Session B: a probe, (first fixture) the selection guard, one pass, revert (AC-2). Returns its AC-4. */
async function sessionB(deps: Phase3Deps, name: string, fx: Json, first: boolean, history: string[]): Promise<SessionClip> {
  const { tools } = deps;
  const b: Json = {};
  fx["session_b"] = b;
  const begin = (await tools.beginSession({ intent_id: INTENT_B, return_image: "none" })).json;
  const sid = String(begin["session_id"]);
  history.push(...historyOf(begin));
  b["session_id"] = sid;
  await probe(deps, sid, b, history);
  if (first) await selectionGuard(deps, name, sid, b);
  // Shadows, not exposure: after the probe, its slope may (rightly) refuse an exposure increase
  // [handle: Claude Code, 2026-09-26, the first run of tests\phase3-check.test.ts: "Nothing was
  // written: every change was refused (exposure: the probe's slope projects a clipping breach ...)"].
  const step = (await tools.step({ session_id: sid, settings: { shadows: 10 }, rationale: "scripted pass before the revert", return_image: "none" })).json;
  history.push(...historyOf(step));
  const end = (await tools.endSession({ session_id: sid, outcome: "revert" })).json;
  const revert = end["revert"] as { ms: number; differing: string[] };
  Object.assign(b, { revert, log_path: end["log_path"] });
  const ac2 = { ok: revert.ms <= REVERT_BUDGET_MS && revert.differing.length === 0, ms: revert.ms, differing: revert.differing };
  fx["ac2"] = ac2;
  deps.say(`  Session B reverted in ${revert.ms} ms (AC-2: within 1 s and exact: ${yn(ac2.ok)}).`);
  return clipCheckFile("B", String(end["log_path"]));
}

async function probe(deps: Phase3Deps, sid: string, b: Json, history: string[]): Promise<void> {
  try {
    const out = (await deps.tools.probe({ session_id: sid, sliders: ["exposure", "whites"], magnitude: 0.5 })).json;
    history.push(...historyOf(out));
    b["probe"] = { results: out["results"], history_names: out["history_names"], total_ms: (out["timings"] as { total_ms?: number } | undefined)?.total_ms };
    deps.say(`  Session B (${INTENT_B}): probe done (${historyOf(out).length} History steps).`);
  } catch (err) {
    b["probe"] = { error: errorBody(err) };
    deps.say(`  Probe FAILED: ${describeError(err)}`);
  }
}

/** First fixture: with another photo selected, a pass is refused (PRD 6.13); then Jim selects the fixture again. */
async function selectionGuard(deps: Phase3Deps, name: string, sid: string, b: Json): Promise<void> {
  const { tools } = deps;
  const guard: Json = {};
  b["selection_guard"] = guard;
  const other = await deps.prompt(`  Click any OTHER photo in the Filmstrip (not ${name}), then press Enter.`);
  if (other === null) return;
  try {
    await tools.step({ session_id: sid, settings: { shadows: 5 }, rationale: "check: another photo is selected", return_image: "none" });
    Object.assign(guard, { ok: false, note: "the pass was written although another photo was selected" });
  } catch (err) {
    Object.assign(guard, { ok: err instanceof ToolError && err.code === "TARGET_CHANGED", error: errorBody(err) });
  }
  deps.say(`  Selection guard: pass refused while another photo was selected: ${yn(guard["ok"] === true)}`);
  // Back to the fixture, checked, so the rest of session B (and its revert) reaches this photo.
  let back = false;
  for (let attempt = 1; attempt <= 3 && !back; attempt++) {
    const line = await deps.prompt(attempt === 1 ? `  Click ${name} again, then press Enter.` : `  The selected photo is not ${name}. Click ${name}, then press Enter.`);
    if (line === null) break;
    back = (await tools.getActivePhotoContext()).json["filename"] === name;
  }
  if (!back) throw new Error(`${name} was not selected again after the selection-guard step`);
}
