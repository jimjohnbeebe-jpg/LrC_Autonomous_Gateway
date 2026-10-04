// AI masks inside a mask pass (masks.ts; GitHub issue #59, PR C steps 2 and 2b): the table route
// first, LrDevelopController after it [stated: Jim, 2026-10-03, "Table + Develop fallback"] for
// subject, sky and background only (params\mask-ai-kinds.ts).
//   - Table: the entry is written in Adobe's own form (params\mask-ops.ts), then update_ai_settings and
//     the wait for Lightroom's answer (ai-update.ts): computed; nothing found (ErrorReason not 0: the
//     entry is taken out of the table as it is now and MASK_NOTHING_FOUND says so, no pass used);
//     a dialog (the photo is put back to before the session and the session ends: autoRevert);
//     no result (LIGHTROOM_STUCK, nothing written; after a Lightroom restart revertAfterRestart puts the
//     photo back, restart.ts, D16); or a failure. One person's kinds go by instance: person-masks.ts runs the table route twice (the
//     probe, then the wanted entry).
//   - LrDevelopController runs only when the table route's update failed with a gate or plugin error,
//     never after a dialog and never after a mask that simply did not compute [inference: the lead's
//     design after Jim's "full control of the masking from the llm without throwing errors", stated
//     2026-10-03]. Then this pass's attempt is taken out of the table as it is now ("… mask ai
//     revert"; other masks, the user's changes included, stay) and create_ai_mask_dc makes the mask;
//     the new entry is found by its id, and its name and sliders are written by an AVG table write
//     ("… mask sliders"). The DC step itself keeps Lightroom's History name [stated: Jim, 2026-10-03,
//     "Accept for fallback (Recommended)"]; a DC setValue did not show in an immediate table read
//     [handle: docs\reports\phase6\masks-capture\12_probe_dc.json getDevelopSettings_after_sky], hence
//     the table write. When createNewMask answered but no new mask showed in the plugin's wait, the
//     table is read for a new entry for up to dcWaitMs more.
//   - Neither route: FEATURE_UNAVAILABLE {routes_tried, waited_ms}; the result says whether the last
//     read of the table showed this pass's attempts gone (they stay in History) and the pass is not used.
// The route that worked is kept for the session (s.aiRoute). [handle: tests\session-ai-masks.test.ts,
// tests\session-ai-dialog.test.ts, against the Lightroom sim; in Lightroom [unverified] until capture 4.]

import { ToolError, featureUnavailable, toToolError } from "../mcp/errors.js";
import { AI_KINDS, KIND_LABELS, computed, correctionIds, firstComponent, named, readTable, type AiKind, type Box, type Correction, type SdkSettings } from "../params/index.js";
import { aiTimings, updateAndWait } from "./ai-update.js";
import { autoRevert, stuckError } from "./ai-revert.js";
import { byPerson } from "./person-masks.js";
import { bridge, checkAbort, historyName, ms, readSdk, writeTable } from "./io.js";
import type { Session, SessionContext, Target } from "./types.js";

export const AI_POLL_MS = 250;
/** create_ai_mask_dc bounds itself at about 10 s to open Masking plus its wait (plugin\LrC-AVG.lrplugin\Masks.lua). */
const DC_TIMEOUT_MS = 35000;

export type AiResult = {
  sdk: SdkSettings;
  id: string;
  route: "table" | "dc";
  fallback?: string;
  update_ms?: number;
  computed_ms?: number;
  dc_ms?: number;
  /** How long Lightroom's write gate stayed held while the mask computed (a slow model, not a dialog after all). */
  dialog_ms?: number;
  /** One person's mask (person-masks.ts): every person's box Lightroom found, and the one chosen. */
  people?: Box[];
  instance?: number;
  /** One person's mask written after its probe: the probe's own update and compute times. */
  probe?: { update_ms: number; computed_ms: number };
};

/**
 * What the AI route needs from the pass: the photo, its pass, the table before it, the new entry's
 * id, name and sliders, and `attempts`: the ids of every entry this pass made (taken out on failure).
 */
export type AiJob = { t: Target; n: number; kind: AiKind; before: Correction[]; id: string; name: string; stored: Record<string, number>; historyNames: string[]; attempts: Set<string>; point?: [number, number] | null };

type Failed = { why: string; fallback: boolean };

const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** A failure that stops the pass rather than the route: Lightroom gone or not answering, another photo selected, the user's Abort. */
const stops = (err: unknown): boolean => ["BRIDGE_DISCONNECTED", "BRIDGE_TIMEOUT", "TARGET_CHANGED", "SESSION_ENDED"].includes(toToolError(err).code);
const sleep = (t: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, t));

/** Read the table until the correction `pick` names has computed, or the wait ends; the read and the time waited. */
async function waitComputed(ctx: SessionContext, s: Session, t: Target, pick: (entries: Correction[]) => string | null): Promise<{ sdk: SdkSettings; id: string | null; seen: string | null; ms: number }> {
  const started = performance.now();
  const wait = aiTimings(ctx).dcWaitMs;
  for (;;) {
    checkAbort(s);
    const { sdk } = await readSdk(ctx, s, t);
    const id = pick(readTable(sdk));
    const done = id !== null && computed(firstComponent(readTable(sdk), id) ?? {});
    if (done || performance.now() - started >= wait) return { sdk, id: done ? id : null, seen: id, ms: ms(started) };
    await sleep(AI_POLL_MS);
  }
}

/**
 * Take this pass's attempts out of the table as it is now (a fresh read, never an earlier array),
 * leaving every other entry; nothing is written when none is there. Returns null when the table no
 * longer holds any, else why it may.
 */
async function takeOut(ctx: SessionContext, s: Session, job: AiJob): Promise<string | null> {
  try {
    const now = readTable((await readSdk(ctx, s, job.t)).sdk);
    const kept = now.filter((e) => !job.attempts.has(correctionIds([e])[0] as string));
    if (kept.length === now.length) return null;
    const name = historyName(s, job.t, job.n, "mask ai revert");
    await writeTable(ctx, s, job.t, kept, name, true); // an undo of this pass's own entries (an empty table is [unverified])
    job.historyNames.push(name);
    return null;
  } catch (err) {
    if (stops(err)) throw err;
    return `taking this pass's attempt out of the mask table failed: ${why(err)}`;
  }
}

async function byTable(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult | Failed> {
  const u = await updateAndWait(ctx, s, job);
  if (u.kind === "computed") {
    return { sdk: u.sdk, id: job.id, route: "table", update_ms: u.update_ms, computed_ms: u.computed_ms, ...(u.dialog_ms !== undefined ? { dialog_ms: u.dialog_ms } : {}) };
  }
  if (u.kind === "dialog") return autoRevert(ctx, s, job, u.why, "dialog", (j) => takeOut(ctx, s, j));
  if (u.kind === "stuck") throw stuckError(s, job, u.why);
  if (u.kind === "failed") return { why: u.why, fallback: u.fallback };
  const left = await takeOut(ctx, s, job);
  const label = KIND_LABELS[job.kind];
  throw new ToolError(
    "MASK_NOTHING_FOUND",
    `Lightroom found no ${label} in this photo (its ErrorReason ${u.reason}), so the mask was taken out again${left ? ` (${left})` : ""}; the pass is not used. Try another kind, or a linear, radial or luminance mask.`,
    true,
    { session_id: s.id, kind: job.kind, error_reason: u.reason, history_names: job.historyNames, ...(left ? { left } : {}) },
  );
}

/**
 * After a Lightroom restart while s.aiPending was set (restart.ts): the photo put back and the session ended,
 * as autoRevert does (the attempt on a copy taken out first); returns the error it ended with, since no tool
 * call waits for it.
 */
export async function revertAfterRestart(ctx: SessionContext, s: Session, cause: string): Promise<ToolError> {
  const job = s.aiPending?.job;
  if (!job) return new ToolError("INTERNAL_ERROR", "no AI update was pending", false);
  try {
    return await autoRevert(ctx, s, job, cause, "restart", (j) => takeOut(ctx, s, j));
  } catch (err) {
    return toToolError(err);
  }
}

/** create_ai_mask_dc: the new ids it saw, or why it made none; `answered`: createNewMask itself reported ok. */
async function askDevelop(ctx: SessionContext, s: Session, job: AiJob, subtype: string): Promise<{ made: string[]; answered: boolean } | string> {
  try {
    const res = await bridge(s, job.t, () => ctx.deps.client.request("create_ai_mask_dc", { target_uuid: job.t.uuid, subtype }, { timeoutMs: DC_TIMEOUT_MS }));
    const answered = res.steps.some((st) => st.step === `createNewMask_${subtype}` && st.ok);
    if (res.new_ids.length === 0 && !answered) return `create_ai_mask_dc made no mask${res.stopped ? ` (${res.stopped})` : ""}`;
    return { made: res.new_ids, answered };
  } catch (err) {
    if (stops(err)) throw err;
    return `create_ai_mask_dc: ${why(err)}`;
  }
}

async function byDevelop(ctx: SessionContext, s: Session, job: AiJob, subtype: string): Promise<AiResult | string> {
  checkAbort(s);
  const t0 = performance.now();
  const asked = await askDevelop(ctx, s, job, subtype);
  if (typeof asked === "string") return asked;
  for (const id of asked.made) job.attempts.add(id);
  // A mask that showed after the plugin's wait still counts: any entry not in the table before the pass [inference: no one else adds masks meanwhile].
  const old = new Set(correctionIds(job.before));
  const fresh = (entries: Correction[]): string | null => correctionIds(entries).find((id) => (asked.made.length > 0 ? asked.made.includes(id) : !old.has(id) && !job.attempts.has(id))) ?? null;
  const done = await waitComputed(ctx, s, job.t, fresh);
  if (done.seen !== null) job.attempts.add(done.seen);
  if (done.id === null) return `the mask create_ai_mask_dc made ${done.seen ? "did not compute" : "did not show"} within ${Math.round(done.ms)} ms`;
  const name = historyName(s, job.t, job.n, "mask sliders");
  job.historyNames.push(name);
  let sdk: SdkSettings;
  try {
    sdk = await writeTable(ctx, s, job.t, named(readTable(done.sdk), done.id, job.name, job.stored), name, false);
  } catch (err) {
    if (stops(err)) throw err;
    return `naming the mask LrDevelopController made and setting its sliders failed: ${why(err)}`; // makeAiMask takes it out
  }
  return { sdk, id: done.id, route: "dc", dc_ms: ms(t0) };
}

/** Why LrDevelopController does not run for this kind after this table failure, or null when it may. */
function noDevelop(job: AiJob, table: Failed | null): string | null {
  if (AI_KINDS[job.kind].dc === null) return "none for this kind: LrDevelopController made no people or landscape mask in capture 2";
  if (table && !table.fallback) return "not tried: the table route did not fail with a gate or plugin error";
  return null;
}

/**
 * Make the AI mask of `job`, whose entry the pass has just written (the table route's start). Returns
 * the table after it and how it was made; MASK_NOTHING_FOUND, LIGHTROOM_DIALOG or FEATURE_UNAVAILABLE
 * when it was not.
 */
export async function makeAiMask(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult> {
  const started = performance.now();
  const tried: Array<{ route: "table" | "dc"; why: string }> = [];
  let table: Failed | null = null;
  if (s.aiRoute !== "dc" || AI_KINDS[job.kind].dc === null) {
    const out = AI_KINDS[job.kind].point
      ? await byPerson(ctx, s, job, { table: (j) => byTable(ctx, s, j), takeOut: (j) => takeOut(ctx, s, j) })
      : await byTable(ctx, s, job);
    if ("route" in out) {
      s.aiRoute = "table";
      return out;
    }
    table = out;
    tried.push({ route: "table", why: out.why });
  } else {
    tried.push({ route: "table", why: "skipped: the table route failed earlier in this session" });
  }
  const stuck = await takeOut(ctx, s, job); // a failed take-out is part of the table route's failure
  if (stuck !== null && tried[0]) tried[0].why += `; ${stuck}`;
  const refused = noDevelop(job, table);
  const dc = refused ?? (await byDevelop(ctx, s, job, AI_KINDS[job.kind].dc as string));
  if (typeof dc !== "string") {
    s.aiRoute = "dc";
    return { ...dc, fallback: tried[0]?.why ?? "" };
  }
  tried.push({ route: "dc", why: dc });
  const left = refused ? stuck : await takeOut(ctx, s, job);
  const gone = left === null ? "The last read of the mask table showed this pass's attempts gone (they stay in History)" : `This pass's attempt may still be in the mask table (${left}): lr_list_masks shows it, and lr_end_session revert removes it`;
  throw featureUnavailable(`An AI ${job.kind} mask`, ctx.deps.client.hello(), `the mask table route did not make it, and LrDevelopController did not either or was not tried (routes_tried says why); linear, radial and luminance masks still work. ${gone}; the pass is not used.`, {
    routes_tried: tried,
    waited_ms: ms(started),
  });
}
