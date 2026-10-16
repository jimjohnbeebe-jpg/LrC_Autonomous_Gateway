// Sessions an engine left open when it stopped (Claude Desktop killed it, or it crashed): its session was in memory
// only, so a new engine knew nothing of it and lr_end_session got SESSION_NOT_ACTIVE, the photo left with the
// session's edits and, after an AI mask, the plugin's guard on it. On 2026-10-11 session 7ae27134 stayed open that
// way after Lightroom's AI Vegetation mask failed [handle: repo logs\20261011-7ae271.json, `ended` null]. Jim's
// shape [stated: Jim, 2026-10-11, "Build recovery now", then "Go" on the plan with "Refuse until resolved" and "All in
// the log folder"]:
//   - a session left open is a log in the current log folder whose `ended` is null, other than the session this
//     engine has open. An engine keeps the bridge while its session is open [handle: engine\src\mcp\main.ts:20-21,
//     "no idle release"], so, once this engine holds the bridge, no live engine's session is taken for one. So every
//     outcome on one waits for the bridge, abandon too (mcp\tools-session.ts): an old engine not yet exited would
//     otherwise write its log back over the recovery's (the review of f5eb667);
//   - its photo is named by photo_uuid, so it need not be selected: the snapshot put-backs of the S10 battery named
//     unselected photos so [handle: engine\src\devtools\s10-writes.ts:80; docs\reports\phase8\S10.md, PUT BACK YES];
//   - lr_get_active_photo_context lists them (`left_open`), and lr_begin_session refuses a photo that one names
//     (SESSION_LEFT_OPEN): a new snapshot would hold the half-finished edit;
//   - lr_end_session takes one: "revert" applies its snapshot to its photo and checks the read-back against the
//     log's settings (and masks) before the session; "accept" reads the photo (the pick in Variants mode) and
//     writes the recipe; "abandon" leaves the photo as it is and drops the plugin's guard on it, best-effort. The log
//     is finished with `ended_by` "recovery".
// [handle: tests\session-left-open.test.ts, against the Lightroom sim; in Lightroom [unverified] until Jim's check.]

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { RECIPE_SCHEMA_ID, sessionLogSchema, writeJson, type SessionLogData } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { differingSettings, type CanonicalSettings } from "../params/index.js";
import { dropGuard, GUARD_NOTE, type GuardOutcome } from "./abandon.js";
import { ms } from "./io.js";
import { WRITE_TIMEOUT_MS, type EndArgs, type SessionContext, type SessionOutput } from "./types.js";

export type LeftOpen = { file: string; log: SessionLogData };

const LOG_NAME = /^\d{8}-[0-9a-f]{6}\.json$/;
/** The failures that leave an AI mask without a result (ai-update.ts). */
const AI_STUCK = ["AI_MASK_FAILED", "LIGHTROOM_STUCK", "AI_UPDATE_PENDING"];

/** The sessions left open in `dir`, oldest first; `openId`, this engine's open session, is not one. Unreadable files are skipped. */
export function findLeftOpen(dir: string, openId: string | null): LeftOpen[] {
  let names: string[];
  try {
    names = readdirSync(dir).filter((f) => LOG_NAME.test(f));
  } catch {
    return []; // no such folder (yet)
  }
  const found: LeftOpen[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const log = readLog(file, true);
    if (log && log.ended === null && log.session_id !== openId) found.push({ file, log });
  }
  return found.sort((a, b) => a.log.started.localeCompare(b.log.started));
}

/** `open`: only a log still open is parsed (writeJson's `"ended": null`), as the scan runs on every context call. */
function readLog(file: string, open = false): SessionLogData | null {
  try {
    const text = readFileSync(file, "utf8");
    if (open && !text.includes('"ended": null')) return null;
    const parsed = sessionLogSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The photos a session left open edits: the master and, in Variants mode, its copies. */
const photosOf = (log: SessionLogData): string[] => [log.target.uuid, ...log.variants.map((v) => v.uuid)];

export const LEFT_OPEN_NOTE =
  "An engine that stopped (the AI client closed or restarted it) left these sessions open: their photos keep what the sessions did. " +
  'Tell the user and ask, for each, what to do, then call lr_end_session with its session_id: "revert" puts the photo back to the ' +
  "pre-session snapshot (any later change to it, by hand too, is lost); \"accept\" keeps the photo as it is now and writes the recipe; " +
  '"abandon" ends it and leaves the photo as it is. lr_begin_session refuses a photo with a session left open until then.';

/** lr_get_active_photo_context's `left_open`: what the user needs to choose. */
export function leftOpenJson(found: readonly LeftOpen[]): Record<string, unknown>[] {
  return found.map(({ file, log }) => ({
    session_id: log.session_id,
    started: log.started,
    filename: log.target.filename,
    copy_name: log.target.copy_name,
    uuid: log.target.uuid,
    mode: log.mode,
    passes: log.passes.length,
    snapshot: log.snapshot.name,
    last_failure: log.failures.at(-1)?.error.code ?? null,
    log_path: file,
  }));
}

/** lr_begin_session on a photo a session left open edits: refused until that session ends. */
export function refuseLeftOpen(dir: string, openId: string | null, photoUuid: string): void {
  const left = findLeftOpen(dir, openId).find((l) => photosOf(l.log).includes(photoUuid));
  if (!left) return;
  throw new ToolError(
    "SESSION_LEFT_OPEN",
    `Session ${left.log.session_id} (started ${left.log.started}) was left open on this photo by an engine that stopped, so nothing was written. ` +
      `Ask the user whether to revert, accept or abandon it, end it with lr_end_session, then begin again.`,
    false,
    { session_id: left.log.session_id, log_path: left.file },
  );
}

/** lr_end_session on a session left open. Revert and accept reach Lightroom; abandon only tries to drop the guard. */
export async function endLeftOpen(ctx: SessionContext, left: LeftOpen, outcome: EndArgs["outcome"]): Promise<SessionOutput> {
  const log = readLog(left.file);
  if (!log || log.ended !== null) throw new ToolError("SESSION_ENDED", `Session ${left.log.session_id} has ended already (${left.file}).`, false, { session_id: left.log.session_id });
  const started = performance.now();
  const reason = `engine ${ctx.deps.engineVersion} ended a session an engine that stopped left open`;
  const extra: Record<string, unknown> = {};
  try {
    if (outcome === "revert") Object.assign(extra, await revert(ctx, log));
    else if (outcome === "accept") Object.assign(extra, accept(ctx, left.file, log, await readKept(ctx, log)));
    else Object.assign(extra, await abandon(ctx, log));
  } catch (err) {
    const e = toToolError(err);
    log.failures.push({ at: ctx.now().toISOString(), stage: `end left open (${outcome})`, error: { code: e.code, message: e.message, recoverable: e.recoverable } });
    writeJson(left.file, log);
    throw e;
  }
  log.outcome = outcome === "abandon" ? "abandoned" : outcome;
  log.ended = ctx.now().toISOString();
  log.ended_by = { source: "recovery", reason };
  writeJson(left.file, log);
  const json = { ok: true, session_id: log.session_id, outcome: log.outcome, ended_by: log.ended_by, left_open: true, log_path: left.file, ...extra, timings: { total_ms: ms(started) } };
  return { json, log: { session_id: log.session_id, outcome: log.outcome, ended_by: log.ended_by, log_path: left.file, left_open: true } };
}

/** The snapshot applied to the master, checked against the settings (and, from engine 0.29.0, masks) before the session. */
async function revert(ctx: SessionContext, log: SessionLogData): Promise<Record<string, unknown>> {
  const { client, map } = ctx.deps;
  const t = performance.now();
  const res = await client.request("apply_snapshot", { photo_uuid: log.target.uuid, snapshot_id: log.snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS });
  const view = map.fromSdk(res.read_back);
  const before = log.start?.settings ?? log.passes[0]?.settings_before ?? null;
  const differing = before ? [...differingSettings(view.settings, before), ...(log.start && view.masks.fingerprint !== log.start.masks ? ["masks"] : [])] : [];
  log.final_settings = view.settings;
  log.revert = { ms: ms(t), differing };
  const checked = before === null ? "nothing: the log has no settings from before the session" : log.start ? "settings and masks" : "settings (this log has no mask record)";
  return { revert: log.revert, checked, final_settings: view.settings };
}

/** The photo accept keeps (the master, or the pick in Variants mode) and its settings now. */
async function readKept(ctx: SessionContext, log: SessionLogData): Promise<{ uuid: string; filename: string | null; settings: CanonicalSettings; masks: number }> {
  // An AI mask with no result may still hold the plugin's guard on the photo; an accept would end the log and leave it
  // there, beyond an abandon's reach (Greptile, PR #141). As the open session's accept is refused then (manager.ts live).
  const ai = log.failures.at(-1)?.error.code;
  if (ai && AI_STUCK.includes(ai)) {
    throw new ToolError("AI_UPDATE_PENDING", `Session ${log.session_id} ended on ${ai}: Lightroom's AI mask has no result, so accept is refused. End it with revert after restarting Lightroom, or with abandon.`, false, { session_id: log.session_id });
  }
  const pick = log.mode === "variants" ? log.variants.find((v) => v.picked) : null;
  if (log.mode === "variants" && !pick) {
    throw new ToolError("AWAITING_PICK", "No copy was picked in this Variants session, so accept has no edit to keep: end it with revert or abandon.", false, { session_id: log.session_id });
  }
  const uuid = pick?.uuid ?? log.target.uuid;
  const view = ctx.deps.map.fromSdk((await ctx.deps.client.request("get_settings", { photo_uuid: uuid })).settings);
  return { uuid, filename: log.target.filename, settings: view.settings, masks: view.masks.count };
}

function accept(ctx: SessionContext, file: string, log: SessionLogData, kept: Awaited<ReturnType<typeof readKept>>): Record<string, unknown> {
  const recipePath = file.replace(/\.json$/, ".recipe.json");
  writeJson(recipePath, {
    schema: RECIPE_SCHEMA_ID,
    session_id: log.session_id,
    created: ctx.now().toISOString(),
    intent_id: log.intent.id,
    source: { uuid: kept.uuid, filename: kept.filename },
    process_version: log.target.process_version,
    ...(log.target.pipeline ? { pipeline: log.target.pipeline } : {}),
    settings: kept.settings,
    ...(kept.masks > 0 ? { masks: kept.masks } : {}),
  });
  log.final_settings = kept.settings;
  log.recipe_path = recipePath;
  return { recipe_path: recipePath, final_settings: kept.settings };
}

/** Nothing read or written but clear_pending_ai, which never throws: a guard the stopped engine's AI mask left goes. */
async function abandon(ctx: SessionContext, log: SessionLogData): Promise<Record<string, unknown>> {
  // Each of its photos: in Variants mode an AI mask may have been on a copy (the review of f5eb667).
  const guards: GuardOutcome[] = [];
  for (const uuid of photosOf(log)) guards.push((await dropGuard(ctx, uuid, true)).guard);
  // A guard possibly left beats one cleared (Greptile, PR #141).
  const guard = guards.includes("not_cleared") ? "not_cleared" : guards.includes("plugin_too_old") ? "plugin_too_old" : guards.includes("cleared") ? "cleared" : "none";
  // Whether the stopped engine left a guard is not known (the log does not say), so "not reached" is said as a maybe.
  const guardNote = guard === "not_cleared" || guard === "plugin_too_old" ? " Lightroom was not reached: if the session was waiting on an AI mask, Lightroom refuses writes to the photo until it restarts." : GUARD_NOTE[guard];
  const note =
    `Nothing was read from or written to the photo: it keeps what the session did. To put it back, the user selects it in Develop ` +
    `and clicks the snapshot "${log.snapshot.name}" in the Snapshots panel.${guardNote}`;
  return { snapshot: log.snapshot.name, lightroom_guard: guard, note };
}
