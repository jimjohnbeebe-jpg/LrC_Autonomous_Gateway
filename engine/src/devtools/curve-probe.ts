// `npm run curve:probe` (GitHub issue #187; Phase 10 row 2): the steps, so tests\curve-probe.test.ts can run
// them against the simulated plugin (the command line is curve-probe-cli.ts; Jim's steps and the report are
// docs\reports\phase10\curve-probe.md). On the photo selected in Develop, issue #187's photo, behind a snapshot:
//   a. issue #187's exact step through a real engine session (begin, lr_step, end with revert): taken, or
//      refused, and then whether the photo is back at its pre-step settings (PHASE10_PLAN L-2);
//   b. the same curve written straight through the bridge, as S14 wrote it, alone and with the step's vibrance:
//      separates the write path from the photo and its profile (S14.md "a. Tone curve": S14's curve was taken on
//      another photo, so which of the three matters is [unverified]);
//   c. the profile sweep (run 2, after run 1 on 2026-10-26 had every curve write refused on this photo, by the
//      session and by the bridge [stated: Jim, 2026-10-26, "Keep #187 open, isolate now"]): from the snapshot,
//      each raw profile of SWEEP_PROFILES written through the params map, then #187's curve by the bridge;
//      a suggested reading of which matters, the profile or the photo;
//   e. the extended curve (run 3, after run 2 had the curve refused under every profile [stated: Jim, 2026-10-26,
//      "Run 3: write the extended curve (Recommended)"]): from the snapshot, #187's curve, then a 3-point lift,
//      written to ExtendedToneCurvePV2012, which HDR-mode photos carry beside ToneCurvePV2012 (EXTENDED below);
//      the lift stays on the photo for part d; skipped, with the reason, on a photo without that key;
//   d. (run after e) Jim's answer on what the Tone Curve panel shows in its Point Curve view (S14's "the curve was
//      still straight" may be the panel opening on the Parametric view [inference]), asked on the first state where
//      a curve read back taken: a 3-point lift under the first profile of the sweep that took the curve, else the
//      extended lift of part e; not asked, with the reason, otherwise (run 1 asked it on a refused curve);
//   f. the photo put back from the snapshot, every key compared: PUT BACK YES/NO.
// Before any write, the photo's settings are saved as census\curve_probe_settings_<file>__<uuid8>.json, with
// the keys it carries beyond the raw pin and the pinned keys it lacks (an HDR DNG against S5's NEF).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sdkKeysJson from "../params/sdk-keys.lrc15.json" with { type: "json" };
import { IntentLibrary } from "../intents/index.js";
import { ENGINE_VERSION } from "../mcp/index.js";
import { toToolError } from "../mcp/errors.js";
import { CAMERA_PROFILE_KEY, PROFILE_KEYS } from "../params/index.js";
import { loadSdkKeys } from "../params/sdk-keys.js";
import { PreviewService } from "../preview/index.js";
import { SessionManager } from "../session/index.js";
import { describeError, differingKeys } from "./phase1-check.js";
import { yn, type Json } from "./phase3-config.js";
import { describe, dumpName, summary } from "./s10-census.js";
import { connect, EXPORT_TIMEOUT_MS, write, type Ctx, type Photo, type S10Deps } from "./s10-config.js";
import { behindSnapshot } from "./s10-writes.js";
import { readOf, takenAll, toSnapshot } from "./s14-config.js";

/** Issue #187's photo and step [handle: issue #187 "Summary", "Evidence" 1]. */
export const ISSUE_PHOTO = { filename: "20220828-_DSC1159-HDR.dng", uuid: "65937445-C308-4B2E-B1CD-F38C7EE40E0D" } as const;
export const STEP_187 = { "tone_curve.master": [0, 0, 64, 56, 128, 128, 192, 200, 255, 255], vibrance: 7 };
/** The midtones lifted by 32 levels (S14's LIFT3): a bend Jim cannot miss. */
export const LIFT3 = [0, 0, 128, 160, 255, 255];
export const QUESTION = "In Develop > Tone Curve, click the Point Curve button (the second of the curve-type icons at the top of the panel). Does the curve show raised in the middle?";
/** The raw profiles of the sweep, #187's photo's own last [handle: docs\reports\phase10\curve-probe.md "Purpose"]. */
export const SWEEP_PROFILES = ["Adobe Color", "Adobe Standard", "Adobe Landscape"] as const;
/**
 * The point curve key of HDR edit mode [inference: what run 3 tests]. #187's photo has HDREditMode 1 and carries it
 * beside ToneCurvePV2012, both [0,0,255,255] [handle: docs\reports\phase10\curve-probe\run2\curve_probe_settings_20220828-_DSC1159-HDR.dng__65937445.json];
 * S5's dumps have HDREditMode 0 and no such key [handle: docs\reports\phase0\S5\*.json:86], and S10 saw the
 * ExtendedToneCurvePV2012* keys only on HDR photos [handle: vault LR_SDK_NOTES "Recorded in Phase 8"].
 */
export const EXTENDED = "ExtendedToneCurvePV2012";
const PHOTO_PROFILE = "Adobe Landscape";
const REFUSED = ["WRITE_NOT_TAKEN", "FEATURE_UNAVAILABLE"];
const history = (what: string): string => `AVG curve probe ${what}`;

export type CurveDeps = S10Deps & { sessionDir: string };

/** The one photo selected in Lightroom, which must be issue #187's; else nothing is written. */
async function selectedPhoto(ctx: Ctx): Promise<Photo> {
  const { client } = ctx.deps;
  const sel = await client.request("get_selection", { max: 2 });
  const uuid = sel.photos[0]?.uuid;
  if (sel.count !== 1 || typeof uuid !== "string") throw new Error(`select one photo in Lightroom's Develop module, ${ISSUE_PHOTO.filename} (${sel.count} selected). Nothing was written.`);
  const context = await client.request("get_context", { photo_uuid: uuid });
  const settings = (await client.request("get_settings", { photo_uuid: uuid })).settings;
  const photo = describe(ctx, loadSdkKeys(sdkKeysJson as unknown), context, settings, uuid);
  if (photo.filename !== ISSUE_PHOTO.filename) throw new Error(`the selected photo is ${photo.filename}, not ${ISSUE_PHOTO.filename} (issue #187's photo). Select it in Develop, then run this again. Nothing was written.`);
  return photo;
}

const read = async (ctx: Ctx, photo: Photo) => (await ctx.deps.client.request("get_settings", { photo_uuid: photo.uuid })).settings;
const curveOf = (s: Record<string, unknown>): Json => ({ ToneCurvePV2012: s["ToneCurvePV2012"] ?? null, ToneCurveName2012: s["ToneCurveName2012"] ?? null, Vibrance: s["Vibrance"] ?? null });

function newManager(ctx: Ctx & { deps: CurveDeps }): SessionManager {
  const { client, map } = ctx.deps;
  const previews = new PreviewService(client, { exportTimeoutMs: EXPORT_TIMEOUT_MS, ...(ctx.deps.previewDir ? { previewDir: ctx.deps.previewDir } : {}) });
  const userDir = path.join(ctx.deps.sessionDir, "intents");
  mkdirSync(userDir, { recursive: true });
  return new SessionManager({
    client, map, intents: new IntentLibrary({ map, userDir }), logDir: ctx.deps.sessionDir, engineVersion: ENGINE_VERSION,
    render: (r) => previews.render({ longEdge: r.longEdge, quality: r.quality, targetUuid: r.targetUuid, regions: r.regions }),
  });
}

/**
 * End the session with revert when the probe left it open (a begin whose pass 0 failed, a read that threw): its log
 * would stay open in the sessions folder, and every later run on this photo would get SESSION_LEFT_OPEN (Greptile,
 * PR #200; the pattern of phase4-config.ts closeOpenSession). The revert checks the read-back before it ends the log.
 */
async function closeLeftOpen(ctx: Ctx, manager: SessionManager, out: Json): Promise<void> {
  const open = manager.current();
  if (!open) return;
  try {
    const end = await manager.end({ session_id: open.id, outcome: "revert" });
    out["closed_after_error"] = { session_id: open.id, revert: end.json["revert"] ?? null };
  } catch (err) {
    out["closed_after_error"] = { session_id: open.id, error: toToolError(err).body() };
    ctx.fail(`the probe's session ${open.id} could not be ended (${describeError(err)}): end it with lr_end_session outcome "revert". Tell Claude Code.`);
  }
}

/** a. Issue #187's step in a real engine session, which is then ended with revert, also after an error. */
async function sessionStep(ctx: Ctx & { deps: CurveDeps }, photo: Photo): Promise<Json> {
  const manager = newManager(ctx);
  const out: Json = { step: STEP_187 };
  try {
    await stepAndEnd(ctx, manager, photo, out);
  } finally {
    await closeLeftOpen(ctx, manager, out);
  }
  ctx.deps.say(`  a. session step: ${String(out["outcome"])}${out["back_at_pre_step"] ? `; photo back at its pre-step settings: ${yn((out["back_at_pre_step"] as Json)["ok"] === true)}` : ""}`);
  return out;
}

async function stepAndEnd(ctx: Ctx, manager: SessionManager, photo: Photo, out: Json): Promise<void> {
  const { map } = ctx.deps;
  const begun = await manager.begin({ notes: "npm run curve:probe: issue #187's step" });
  const id = String(begun.json["session_id"]);
  Object.assign(out, { session_id: id, log_path: begun.json["log_path"] ?? null });
  const pre = await read(ctx, photo);
  try {
    const r = await manager.step({ session_id: id, settings: STEP_187, rationale: "issue #187's step (npm run curve:probe)" });
    Object.assign(out, { outcome: "taken", pass: r.json["pass"], history_names: r.json["history_names"] });
  } catch (err) {
    const e = toToolError(err);
    Object.assign(out, { outcome: e.code, error: e.body() });
    const differing = differingKeys(map, pre, await read(ctx, photo));
    if (REFUSED.includes(e.code)) out["back_at_pre_step"] = { ok: differing.length === 0, differing };
    if (!REFUSED.includes(e.code)) ctx.fail(`issue #187's step failed with ${e.code}: ${e.message}`);
    else if (differing.length > 0) ctx.fail(`the refused step left ${differing.join(", ")} changed on the photo (L-2 not met). Tell Claude Code.`);
  }
  out["after_step"] = curveOf(await read(ctx, photo));
  await manager.end({ session_id: id, outcome: "revert" });
  out["completed"] = true;
}

/** One write by uuid, and whether every key read back as written. */
async function writeOne(ctx: Ctx, photo: Photo, label: string, settings: Record<string, unknown>): Promise<Json> {
  const w: Json = { label, written: settings };
  const rb = await write(ctx, photo, settings, history(label), w);
  Object.assign(w, { read_back: readOf(settings, rb), name_read: rb?.["ToneCurveName2012"] ?? null, taken: takenAll(settings, rb) });
  return w;
}

/** One write by uuid from the snapshot. */
async function direct(ctx: Ctx, photo: Photo, out: Json, label: string, settings: Record<string, unknown>): Promise<Json> {
  await toSnapshot(ctx, photo, out);
  return writeOne(ctx, photo, label, settings);
}

/** b. The curve straight through the bridge (the S14 path): alone, and with the step's vibrance. */
async function directWrites(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const curve = STEP_187["tone_curve.master"];
  const vibrance = Number(photo.start["Vibrance"] ?? 0) + STEP_187.vibrance;
  const writes = [await direct(ctx, photo, out, "direct curve", { ToneCurvePV2012: curve }), await direct(ctx, photo, out, "direct curve + vibrance", { ToneCurvePV2012: curve, Vibrance: vibrance })];
  ctx.deps.say(`  b. direct writes: ${writes.map((w) => `${String(w["label"])} taken ${String(w["taken"])}`).join("; ")}`);
  return { writes, completed: writes.every((w) => typeof w["taken"] === "boolean") };
}

/** A profile pair written through the params map; taken when Lightroom reads back that pinned pair. */
async function profileWrite(ctx: Ctx, photo: Photo, name: string): Promise<Json> {
  const profiles = ctx.deps.map.cameraProfiles();
  const w: Json = { label: `profile ${name}` };
  const rb = await write(ctx, photo, profiles.toSdk(name), history(`profile ${name}`), w);
  const id = rb ? profiles.identify(rb[CAMERA_PROFILE_KEY], rb[PROFILE_KEYS[1] as string]) : null;
  return Object.assign(w, { read_back: id, taken: id === null ? null : id.name === name });
}

/** From the snapshot: the profile, then the curve (written only when Lightroom took the profile). */
async function underProfile(ctx: Ctx, photo: Photo, out: Json, name: string, curve: number[], what: string): Promise<Json> {
  await toSnapshot(ctx, photo, out);
  const profile = await profileWrite(ctx, photo, name);
  const w = profile["taken"] === true ? await writeOne(ctx, photo, `${what} under ${name}`, { ToneCurvePV2012: curve }) : null;
  return { profile: name, profile_write: profile, curve: w, curve_taken: (w?.["taken"] as boolean | null | undefined) ?? null };
}

/** The suggested reading of the sweep (a suggestion; the verdict is Jim's, rule 02). */
export function sweepSuggestion(rows: ReadonlyArray<{ profile: string; curve_taken: boolean | null }>): string {
  const own = rows.find((r) => r.profile === PHOTO_PROFILE)?.curve_taken;
  if (rows.some((r) => r.curve_taken === true) && own === false) return "profile is the cause";
  if (rows.every((r) => r.curve_taken === false)) return "photo is the cause";
  return "mixed";
}

/** c. #187's curve under each raw profile of SWEEP_PROFILES. */
async function profileSweep(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const rows: Json[] = [];
  for (const name of SWEEP_PROFILES) rows.push(await underProfile(ctx, photo, out, name, STEP_187["tone_curve.master"], "sweep curve"));
  const suggestion = sweepSuggestion(rows as Array<{ profile: string; curve_taken: boolean | null }>);
  const cell = (r: Json): string => `${String(r["profile"])} (profile taken ${String((r["profile_write"] as Json)["taken"])}) curve taken ${String((r["curve"] as Json | null)?.["taken"] ?? null)}`;
  ctx.deps.say(`  c. profile sweep: ${rows.map(cell).join("; ")}`);
  ctx.deps.say(`     suggestion (not a verdict): ${suggestion}`);
  // Complete only when every profile was taken and its curve read back (Greptile, PR #201).
  return { profiles: rows, photo_profile: PHOTO_PROFILE, suggestion, completed: rows.every((r) => typeof r["curve_taken"] === "boolean") };
}

/** The suggested reading of part e against the standard curve writes of parts b and c (a suggestion, rule 02). */
export function extendedSuggestion(standard: readonly unknown[], extended: readonly unknown[]): string {
  const refused = standard.every((t) => t === false);
  if (refused && extended.every((t) => t === true)) return "HDR mode uses ExtendedToneCurvePV2012";
  if (refused && extended.every((t) => t === false)) return "extended curve refused too";
  return "mixed";
}

/** e. #187's curve, then the 3-point lift, written to EXTENDED from the snapshot; the lift stays on the photo for part d. */
async function extendedCurve(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const { say } = ctx.deps;
  if (!(EXTENDED in photo.start)) {
    const skipped = `the photo's settings have no ${EXTENDED} (HDREditMode ${String(photo.start["HDREditMode"] ?? null)})`;
    say(`  e. extended curve skipped: ${skipped}`);
    return { skipped, completed: true };
  }
  const curve = await direct(ctx, photo, out, "extended curve", { [EXTENDED]: STEP_187["tone_curve.master"] });
  curve["standard_after"] = curveOf(await read(ctx, photo)); // does the extended write move ToneCurvePV2012 or the name?
  const lift = await direct(ctx, photo, out, "extended lift", { [EXTENDED]: LIFT3 });
  const writes = ((out["direct"] as Json)["writes"] as Json[]).map((w) => w["taken"]);
  const standard = [...writes, ...((out["profile_sweep"] as Json)["profiles"] as Json[]).map((r) => r["curve_taken"])];
  const suggestion = extendedSuggestion(standard, [curve["taken"], lift["taken"]]);
  const after = curve["standard_after"] as Json;
  say(`  e. extended curve taken ${String(curve["taken"])} (ToneCurvePV2012 then ${JSON.stringify(after["ToneCurvePV2012"])}, name ${JSON.stringify(after["ToneCurveName2012"])}); extended lift taken ${String(lift["taken"])}`);
  say(`     suggestion (not a verdict): ${suggestion}`);
  return { key: EXTENDED, curve, lift, suggestion, completed: typeof curve["taken"] === "boolean" && typeof lift["taken"] === "boolean" };
}

/** d. Jim's answer on the Point Curve view, on the first taken curve: under a sweep profile, else part e's extended lift. */
async function question(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const q: Json = { id: "point_curve", question: QUESTION };
  (ctx.results["questions"] as Json[]).push(q);
  const first = ((out["profile_sweep"] as Json)["profiles"] as Json[]).find((r) => r["curve_taken"] === true);
  if (first) return onSweepLift(ctx, photo, out, q, String(first["profile"]));
  const lift = (out["extended_curve"] as Json)["lift"] as Json | undefined;
  if (lift?.["taken"] === true) {
    Object.assign(q, { asked_on: EXTENDED, write: lift, answer: await ctx.deps.ask(QUESTION) });
    await toSnapshot(ctx, photo, out); // the extended lift off the photo again
    ctx.deps.say(`  d. extended lift on the photo; Point Curve raised: ${String(q["answer"])}`);
    return { ...q, completed: true };
  }
  q["answer"] = `not asked: no profile took the curve, and the extended lift was ${lift ? "not taken" : "not written"}, so the panel has no taken curve to show`;
  ctx.deps.say(`  d. Point Curve question ${String(q["answer"])}`);
  return { ...q, completed: true };
}

/** d. under `profile`, the first of the sweep that took the curve: the 3-point lift, and the question if it was taken. */
async function onSweepLift(ctx: Ctx, photo: Photo, out: Json, q: Json, profile: string): Promise<Json> {
  const r = await underProfile(ctx, photo, out, profile, LIFT3, "lift");
  const taken = r["curve_taken"];
  Object.assign(q, { profile, profile_write: r["profile_write"], write: r["curve"] });
  if (taken === true) Object.assign(q, { asked_on: `ToneCurvePV2012 under ${profile}`, answer: await ctx.deps.ask(QUESTION) });
  else q["answer"] = `not asked: the lift under ${profile} read back ${taken === false ? "not taken" : "nothing (a write failed)"}`;
  ctx.deps.say(`  d. lift under ${profile} taken ${String(taken)}; Point Curve raised: ${String(q["answer"])}`);
  return { ...q, completed: taken !== null };
}

/** The photo's settings before any write, in the S5 dump's layout ({ meta, settings }), and its keys against the raw pin. */
function saveSettings(ctx: Ctx, photo: Photo): Json {
  const { dumpDir, now, say } = ctx.deps;
  mkdirSync(dumpDir, { recursive: true });
  const file = path.join(dumpDir, dumpName(photo).replace(/^s10_/, "curve_probe_settings_"));
  // No meta.spike: the dump is read for comparison, never pinned, so it need not pass s5DumpSchema.
  const meta = { check: "curve-probe", ...summary(photo), captured_at: (now ?? (() => new Date()))().toISOString() };
  writeFileSync(file, `${JSON.stringify({ meta, settings: photo.start }, null, 2)}\n`);
  const out = { file: path.basename(file), key_count: photo.key_count, not_in_raw_pin: photo.extra_keys, pinned_not_in_photo: photo.missing_pinned_keys };
  say(`  settings saved: ${out.file}; ${photo.key_count} keys, ${photo.extra_keys.length} not in the raw pin, ${photo.missing_pinned_keys.length} pinned keys absent`);
  return out;
}

export async function runCurveProbe(deps: CurveDeps): Promise<{ worked: boolean; results: Json }> {
  const errors: string[] = [];
  const results: Json = { check: "curve-probe", started_at: (deps.now ?? (() => new Date()))().toISOString(), errors, questions: [] };
  const ctx = { deps, results, errors, fail: (m: string) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG curve probe (issue #187): the session step, the direct write, the profile sweep, the extended curve, the Point Curve view");
  if (!(await connect(ctx))) return finish(ctx, null);
  let out: Json | null = null;
  try {
    const photo = await selectedPhoto(ctx);
    results["settings_dump"] = saveSettings(ctx, photo);
    out = await behindSnapshot(ctx, photo, `AVG curve probe before ${deps.stamp}`, async (o) => {
      o["session_step"] = await sessionStep(ctx, photo);
      o["direct"] = await directWrites(ctx, photo, o);
      o["profile_sweep"] = await profileSweep(ctx, photo, o);
      o["extended_curve"] = await extendedCurve(ctx, photo, o);
      o["point_curve"] = await question(ctx, photo, o);
    });
  } catch (err) {
    ctx.fail(`the probe stopped: ${describeError(err)}`);
  }
  await deps.gate.release();
  return finish(ctx, out);
}

/** WORKED: no error, every part completed, the photo put back. */
function finish(ctx: Ctx, out: Json | null): { worked: boolean; results: Json } {
  const putBack = (out?.["put_back"] as Json | null | undefined)?.["ok"] === true;
  const parts = ["session_step", "direct", "profile_sweep", "extended_curve", "point_curve"].map((k) => (out?.[k] as Json | undefined)?.["completed"] === true);
  const worked = ctx.errors.length === 0 && putBack && parts.every(Boolean);
  Object.assign(ctx.results, { photo: out, headline: worked ? "WORKED" : "FAILED", finished_at: (ctx.deps.now ?? (() => new Date()))().toISOString() });
  ctx.deps.say("");
  ctx.deps.say(`Curve probe: ${worked ? "WORKED" : "FAILED"}`);
  ctx.deps.say(`put back: ${out ? yn(putBack) : "YES (nothing was written)"}`);
  return { worked, results: ctx.results };
}
