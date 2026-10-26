// `npm run curve:probe` (GitHub issue #187; Phase 10 row 2): the steps, so tests\curve-probe.test.ts can run
// them against the simulated plugin (the command line is curve-probe-cli.ts; Jim's steps and the report are
// docs\reports\phase10\curve-probe.md). On the photo selected in Develop, issue #187's photo, behind a snapshot:
//   a. issue #187's exact step through a real engine session (begin, lr_step, end with revert): taken, or
//      refused, and then whether the photo is back at its pre-step settings (PHASE10_PLAN L-2);
//   b. the same curve written straight through the bridge, as S14 wrote it, alone and with the step's vibrance:
//      separates the write path from the photo and its profile (S14.md "a. Tone curve": S14's curve was taken on
//      another photo, so which of the three matters is [unverified]);
//   c. a visible 3-point lift, and Jim's answer on what the Tone Curve panel shows in its Point Curve view
//      (S14's "the curve was still straight" may be the panel opening on the Parametric view [inference]);
//   d. the photo put back from the snapshot, every key compared: PUT BACK YES/NO.

import { mkdirSync } from "node:fs";
import path from "node:path";
import sdkKeysJson from "../params/sdk-keys.lrc15.json" with { type: "json" };
import { IntentLibrary } from "../intents/index.js";
import { ENGINE_VERSION } from "../mcp/index.js";
import { toToolError } from "../mcp/errors.js";
import { loadSdkKeys } from "../params/sdk-keys.js";
import { PreviewService } from "../preview/index.js";
import { SessionManager } from "../session/index.js";
import { describeError, differingKeys } from "./phase1-check.js";
import { yn, type Json } from "./phase3-config.js";
import { describe } from "./s10-census.js";
import { connect, EXPORT_TIMEOUT_MS, write, type Ctx, type Photo, type S10Deps } from "./s10-config.js";
import { behindSnapshot } from "./s10-writes.js";
import { readOf, takenAll, toSnapshot } from "./s14-config.js";

/** Issue #187's photo and step [handle: issue #187 "Summary", "Evidence" 1]. */
export const ISSUE_PHOTO = { filename: "20220828-_DSC1159-HDR.dng", uuid: "65937445-C308-4B2E-B1CD-F38C7EE40E0D" } as const;
export const STEP_187 = { "tone_curve.master": [0, 0, 64, 56, 128, 128, 192, 200, 255, 255], vibrance: 7 };
/** The midtones lifted by 32 levels (S14's LIFT3): a bend Jim cannot miss. */
export const LIFT3 = [0, 0, 128, 160, 255, 255];
export const QUESTION = "In Develop > Tone Curve, click the Point Curve button (the second of the curve-type icons at the top of the panel). Does the curve show raised in the middle?";
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

/** One write by uuid from the snapshot, and whether every key read back as written. */
async function direct(ctx: Ctx, photo: Photo, out: Json, label: string, settings: Record<string, unknown>): Promise<Json> {
  await toSnapshot(ctx, photo, out);
  const w: Json = { label, written: settings };
  const rb = await write(ctx, photo, settings, history(label), w);
  Object.assign(w, { read_back: readOf(settings, rb), name_read: rb?.["ToneCurveName2012"] ?? null, taken: takenAll(settings, rb) });
  return w;
}

/** b. The curve straight through the bridge (the S14 path): alone, and with the step's vibrance. */
async function directWrites(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const curve = STEP_187["tone_curve.master"];
  const vibrance = Number(photo.start["Vibrance"] ?? 0) + STEP_187.vibrance;
  const writes = [await direct(ctx, photo, out, "direct curve", { ToneCurvePV2012: curve }), await direct(ctx, photo, out, "direct curve + vibrance", { ToneCurvePV2012: curve, Vibrance: vibrance })];
  ctx.deps.say(`  b. direct writes: ${writes.map((w) => `${String(w["label"])} taken ${String(w["taken"])}`).join("; ")}`);
  return { writes, completed: writes.every((w) => typeof w["taken"] === "boolean") };
}

/** c. The 3-point lift, and Jim's answer on the Point Curve view. */
async function question(ctx: Ctx, photo: Photo, out: Json): Promise<Json> {
  const w = await direct(ctx, photo, out, "lift", { ToneCurvePV2012: LIFT3 });
  const q: Json = { id: "point_curve", question: QUESTION, write: w };
  (ctx.results["questions"] as Json[]).push(q);
  q["answer"] = w["taken"] === null ? "not asked: the write failed" : await ctx.deps.ask(QUESTION);
  ctx.deps.say(`  c. lift taken ${String(w["taken"])}; Point Curve raised: ${String(q["answer"])}`);
  return { ...q, completed: w["taken"] !== null };
}

export async function runCurveProbe(deps: CurveDeps): Promise<{ worked: boolean; results: Json }> {
  const errors: string[] = [];
  const results: Json = { check: "curve-probe", started_at: (deps.now ?? (() => new Date()))().toISOString(), errors, questions: [] };
  const ctx = { deps, results, errors, fail: (m: string) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG curve probe (issue #187): the session step, the direct write, the Point Curve view");
  if (!(await connect(ctx))) return finish(ctx, null);
  let out: Json | null = null;
  try {
    const photo = await selectedPhoto(ctx);
    out = await behindSnapshot(ctx, photo, `AVG curve probe before ${deps.stamp}`, async (o) => {
      o["session_step"] = await sessionStep(ctx, photo);
      o["direct"] = await directWrites(ctx, photo, o);
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
  const parts = ["session_step", "direct", "point_curve"].map((k) => (out?.[k] as Json | undefined)?.["completed"] === true);
  const worked = ctx.errors.length === 0 && putBack && parts.every(Boolean);
  Object.assign(ctx.results, { photo: out, headline: worked ? "WORKED" : "FAILED", finished_at: (ctx.deps.now ?? (() => new Date()))().toISOString() });
  ctx.deps.say("");
  ctx.deps.say(`Curve probe: ${worked ? "WORKED" : "FAILED"}`);
  ctx.deps.say(`put back: ${out ? yn(putBack) : "YES (nothing was written)"}`);
  return { worked, results: ctx.results };
}
