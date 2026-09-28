// AC-3 in the Phase 4 check (phase4-check.ts; PRD section 10: "Variants mode creates three virtual
// copies with visibly different looks; picking one ... continues convergence on it"; in Phase 4 the
// pick is lr_select_variant, not the HUD [stated: Jim, 2026-09-27, PHASE4_PLAN decision 3]).
// A scripted Variants session on the photo: lr_begin_session mode "variants" makes copies A, B, C
// with pass 0 each; one refined lr_step per copy; the check selects each copy in turn for Jim to
// look at, asks whether they look visibly different, and Jim types the pick [stated: Jim,
// 2026-09-28, plan decision 3]; lr_select_variant, one more lr_step (on the pick, target left out),
// accept. Checked from the session log and recipe: the pass after the pick went to the pick, the
// recipe is the pick's, and the master is unchanged. The session's AC-4 counts every copy's passes.

import { readFileSync } from "node:fs";
import { recipeSchema, sessionLogSchema } from "../log/index.js";
import { differingSettings } from "../params/index.js";
import { clipCheckFile, describeClip, clipCheckAll, type SessionClip } from "./clip-check.js";
import { brief, yn, type Answer } from "./phase3-config.js";
import { copiesInError } from "./phase4-copies.js";
import { INTENT, PICK_STEP, VARIANT_STEP, addUnconfirmed, closeOpenSession, copyOf, errorBody, failLine, select, settingsOf, type Json, type Phase4Deps, type Photo, type Run } from "./phase4-config.js";

type VariantId = "A" | "B" | "C";
type Variant = { id: VariantId; label: string; uuid: string; copy_name: string; metrics?: unknown; guardrail_actions?: unknown[] };
/** The pick, selected in Lightroom once the session is accepted (session\end.ts focuses the photo it keeps). */
export type Picked = { id: VariantId; uuid: string; copy_name: string };
export type VariantsOutcome = { picked: Picked | null; clip: SessionClip | null };

/** The scripted Variants session. The pick is null (the reason in the results) when the session did not end with accept. */
export async function variantsSession(deps: Phase4Deps, run: Run, photo: Photo): Promise<VariantsOutcome> {
  const out: Json = { ok: false };
  run.results["variants"] = out;
  try {
    const begin = (await deps.tools.beginSession({ intent_id: INTENT, mode: "variants", variant_count: 3, return_image: "none" })).json;
    const sid = String(begin["session_id"]);
    const variants = (begin["variants"] as Variant[] | undefined) ?? [];
    for (const v of variants) run.copies.push({ uuid: v.uuid, copy_name: v.copy_name, made_by: "variants" });
    out["begin"] = { session_id: sid, total_ms: (begin["timings"] as Json | undefined)?.["total_ms"], variants: variants.map((v) => ({ id: v.id, label: v.label, uuid: v.uuid, copy_name: v.copy_name, metrics: brief(v.metrics), guardrail_actions: v.guardrail_actions?.length ?? 0 })) };
    deps.say(`  Variants: ${variants.length} copies made with pass 0 in ${String((out["begin"] as Json)["total_ms"])} ms (${variants.map((v) => `${v.id} ${v.label}`).join(", ")}).`);
    out["refined"] = await refinedPasses(deps, sid, variants);
    const jim = await lookAndPick(deps, photo, variants);
    out["jim"] = jim;
    if (jim.pick === null) throw new Error("no copy was picked (input ended)");
    return await continueOnPick(deps, run, photo, out, sid, variants.find((v) => v.id === jim.pick) as Variant);
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("the Variants session", err));
    keepFailedCopies(deps, run, out["error"] as Json);
    await closeOpenSession(deps, out);
    return { picked: null, clip: null };
  }
}

/**
 * A begin that failed part-way still made copies (session\copies.ts makeCopies): the open session's
 * variants and the error name them, so the cleanup looks for them too; a begin with no answer names
 * the copies it asked for, which may exist (phase4-copies.ts copiesInError).
 */
function keepFailedCopies(deps: Phase4Deps, run: Run, error: Json): void {
  const known = new Set(run.copies.map((c) => c.uuid));
  const photos = deps.tools.sessionManager()?.current()?.photos ?? [];
  const fromSession = photos.filter((p) => p.target !== "master").map((p) => ({ uuid: p.uuid, copy_name: `AVG ${INTENT} ${p.target}` })); // session\copies.ts copyName
  const fromError = copiesInError(error);
  for (const c of [...fromSession, ...fromError.known]) {
    if (known.has(c.uuid)) continue;
    known.add(c.uuid);
    run.copies.push({ ...c, made_by: "variants" });
  }
  addUnconfirmed(run, fromError.unconfirmed);
}

/** One refined lr_step per copy (PRD 6.6 step 4). */
async function refinedPasses(deps: Phase4Deps, sid: string, variants: readonly Variant[]): Promise<Json[]> {
  const passes: Json[] = [];
  for (const v of variants) {
    const res = (await deps.tools.step({ session_id: sid, target: v.id, settings: VARIANT_STEP.settings, rationale: VARIANT_STEP.rationale, return_image: "none" })).json;
    passes.push({ target: v.id, pass: res["pass"], undone: res["undone"] ?? null, awaiting_pick: res["awaiting_pick"] ?? false, metrics: brief(res["metrics"]) });
  }
  return passes;
}

/** Jim looks at each copy in Lightroom (the check selects it), says whether they differ, and types the pick. */
async function lookAndPick(deps: Phase4Deps, photo: Photo, variants: readonly Variant[]): Promise<{ visibly_different: Answer; pick: VariantId | null }> {
  deps.say("");
  deps.say("  Look at the three copies. The check selects each one in Lightroom in turn.");
  for (const v of variants) {
    await select(deps, v.uuid, copyOf(photo, v.copy_name));
    if ((await deps.prompt(`  Lightroom now shows copy ${v.id} (${v.label}), "${v.copy_name}". Look at it, then press Enter.`)) === null) return { visibly_different: "no answer", pick: null };
  }
  const different = await deps.ask("1. Did the three copies look visibly different from each other?");
  const letters = variants.map((v) => v.id);
  for (;;) {
    const line = await deps.prompt(`  Which copy should the session continue on? Type ${letters.join(", ")}, then press Enter:`);
    if (line === null) return { visibly_different: different, pick: null };
    const pick = line.toUpperCase() as VariantId;
    if (letters.includes(pick)) return { visibly_different: different, pick };
  }
}

/** lr_select_variant, one pass on the pick, accept; then the log, the recipe and the master checked. */
async function continueOnPick(deps: Phase4Deps, run: Run, photo: Photo, out: Json, sid: string, pick: Variant): Promise<VariantsOutcome> {
  const selected = (await deps.tools.selectVariant({ session_id: sid, variant: pick.id })).json;
  const after = (await deps.tools.step({ session_id: sid, settings: PICK_STEP.settings, rationale: PICK_STEP.rationale, return_image: "none" })).json;
  const end = (await deps.tools.endSession({ session_id: sid, outcome: "accept" })).json;
  const logPath = String(end["log_path"]);
  const verified = await verifyPick(deps, photo, logPath, String(end["recipe_path"]), pick);
  const clip = clipCheckFile("variants", logPath);
  const ok = (out["begin"] as { variants: unknown[] }).variants.length === 3 && (out["jim"] as { visibly_different: Answer }).visibly_different === "y" && verified.ok;
  Object.assign(out, { ok, picked: { id: pick.id, uuid: pick.uuid, pass: selected["pass"] }, pass_after_pick: after["pass"], log_path: logPath, verified, ac4: clip });
  deps.say(`  Picked ${pick.id}; the pass after the pick went to it and the recipe is its: ${yn(verified.ok)}. AC-4 on every copy's passes: ${describeClip(clipCheckAll([clip]))}`);
  if (!ok) run.fail("AC-3: the Variants session did not pass (details in variants)");
  return { picked: { id: pick.id, uuid: pick.uuid, copy_name: pick.copy_name }, clip };
}

/** From the session's log and recipe: the pick, the passes on it, the recipe's photo; and the master as before. */
async function verifyPick(deps: Phase4Deps, photo: Photo, logPath: string, recipePath: string, pick: Variant): Promise<Json & { ok: boolean }> {
  const log = sessionLogSchema.parse(JSON.parse(readFileSync(logPath, "utf8")));
  const recipe = recipeSchema.parse(JSON.parse(readFileSync(recipePath, "utf8")));
  const steps = log.passes.filter((p) => p.kind === "step");
  const onPick = steps.filter((p) => p.target === pick.id).length;
  const lastOnPick = steps.at(-1)?.target === pick.id;
  const masterDiffering = differingSettings((await settingsOf(deps, photo.uuid)).settings, photo.start);
  const ok = log.picked === pick.id && onPick >= 2 && lastOnPick && recipe.source.uuid === pick.uuid && masterDiffering.length === 0;
  return { ok, log_picked: log.picked ?? null, steps_on_pick: onPick, last_step_on_pick: lastOnPick, recipe_photo: recipe.source.uuid, master_differing: masterDiffering };
}
