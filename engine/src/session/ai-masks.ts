// AI masks inside a mask pass (masks.ts; GitHub issue #59, PR C step 2): the table route first,
// LrDevelopController after it [stated: Jim, 2026-10-03, "Table + Develop fallback"]; people and
// landscape kinds have the table route only (params\mask-table.ts AI_KINDS).
//   - Table: the entry is written without its digests (masks.ts), then update_ai_settings, then the
//     table is read every AI_POLL_MS until the entry has its digest. In capture 1 the call took 2.8 s
//     and the digests were there 1.2 s later [handle: docs\reports\phase6\masks-capture\check.json
//     `7_sky`]; AI_WAIT_MS leaves room for a slower photo [inference].
//   - The table route fails when update_ai_settings fails in any way but Lightroom going away (or the
//     user's Abort), or the mask does not compute in time. Then this pass's attempt is taken out of
//     the table as it is now ("… mask ai revert"; other masks, the user's changes included, stay) and
//     create_ai_mask_dc makes the mask; the new entry is found by its id, and its name and sliders are
//     written by an AVG table write ("… mask sliders"). The DC step itself keeps Lightroom's History
//     name [stated: Jim, 2026-10-03, "Accept for fallback (Recommended)"]; a DC setValue did not show
//     in an immediate table read [handle: docs\reports\phase6\masks-capture\12_probe_dc.json
//     getDevelopSettings_after_sky], hence the table write. When createNewMask answered but no new mask
//     showed in the plugin's wait, the table is read for a new entry for up to AI_WAIT_MS more.
//   - Neither route: FEATURE_UNAVAILABLE {routes_tried, waited_ms}; the result says whether the last
//     read of the table showed this pass's attempts gone (they stay in History) and the pass is not used.
// The route that worked is kept for the session (s.aiRoute). [handle: tests\session-ai-masks.test.ts,
// against the Lightroom sim; in Lightroom [unverified] until Jim's mask tools check.]

import { featureUnavailable, toToolError } from "../mcp/errors.js";
import { AI_KINDS, computed, correctionIds, firstComponent, named, readTable, type AiKind, type Correction, type SdkSettings } from "../params/index.js";
import { bridge, checkAbort, historyName, ms, readSdk, writeTable } from "./io.js";
import type { Session, SessionContext, Target } from "./types.js";

/** How long a new AI mask may take to compute, per route (SessionDeps.aiWaitMs shortens it in tests). */
export const AI_WAIT_MS = 10000;
export const AI_POLL_MS = 250;
/** update_ai_settings took 2.8 s in capture 1 (check.json `7_sky.update.call_ms`); 30 s leaves room [inference]. */
const UPDATE_TIMEOUT_MS = 30000;
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
};

/**
 * What the AI route needs from the pass: the photo, its pass, the table before it, the new entry's
 * id, name and sliders, and `attempts`: the ids of every entry this pass made (taken out on failure).
 */
export type AiJob = { t: Target; n: number; kind: AiKind; before: Correction[]; id: string; name: string; stored: Record<string, number>; historyNames: string[]; attempts: Set<string> };

const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** A failure that stops the pass rather than the route: Lightroom gone or not answering, another photo selected, the user's Abort. */
const stops = (err: unknown): boolean => ["BRIDGE_DISCONNECTED", "BRIDGE_TIMEOUT", "TARGET_CHANGED", "SESSION_ENDED"].includes(toToolError(err).code);

/** Read the table until the correction `pick` names has computed, or the wait ends; the read and the time waited. */
async function waitComputed(ctx: SessionContext, s: Session, t: Target, pick: (entries: Correction[]) => string | null): Promise<{ sdk: SdkSettings; id: string | null; seen: string | null; ms: number }> {
  const started = performance.now();
  const wait = ctx.deps.aiWaitMs ?? AI_WAIT_MS;
  for (;;) {
    checkAbort(s);
    const { sdk } = await readSdk(ctx, s, t);
    const id = pick(readTable(sdk));
    const done = id !== null && computed(firstComponent(readTable(sdk), id) ?? {});
    if (done || performance.now() - started >= wait) return { sdk, id: done ? id : null, seen: id, ms: ms(started) };
    await new Promise((resolve) => setTimeout(resolve, AI_POLL_MS));
  }
}

/**
 * Take this pass's attempts out of the table as it is now, leaving every other entry; nothing is
 * written when none is there. Returns null when the table no longer holds any, else why it may.
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

async function byTable(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult | string> {
  const t0 = performance.now();
  try {
    await bridge(s, job.t, () => ctx.deps.client.request("update_ai_settings", { photo_uuid: job.t.uuid }, { timeoutMs: UPDATE_TIMEOUT_MS }));
  } catch (err) {
    if (stops(err)) throw err;
    return `update_ai_settings: ${why(err)}`;
  }
  const update = ms(t0);
  const done = await waitComputed(ctx, s, job.t, (entries) => (correctionIds(entries).includes(job.id) ? job.id : null));
  if (done.id === null) return `the mask did not compute within ${Math.round(done.ms)} ms of update_ai_settings`;
  return { sdk: done.sdk, id: job.id, route: "table", update_ms: update, computed_ms: done.ms };
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

async function byDevelop(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult | string> {
  const subtype = AI_KINDS[job.kind].dc;
  if (subtype === null) return "none for this kind: LrDevelopController made no people or landscape mask in capture 2";
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
  const sdk = await writeTable(ctx, s, job.t, named(readTable(done.sdk), done.id, job.name, job.stored), name, false);
  job.historyNames.push(name);
  return { sdk, id: done.id, route: "dc", dc_ms: ms(t0) };
}

/**
 * Make the AI mask of `job`, whose entry the pass has just written (the table route's start). Returns
 * the table after it and how it was made; FEATURE_UNAVAILABLE when neither route made it.
 */
export async function makeAiMask(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult> {
  const started = performance.now();
  const tried: Array<{ route: "table" | "dc"; why: string }> = [];
  if (s.aiRoute !== "dc" || AI_KINDS[job.kind].dc === null) {
    const table = await byTable(ctx, s, job);
    if (typeof table !== "string") {
      s.aiRoute = "table";
      return table;
    }
    tried.push({ route: "table", why: table });
  } else {
    tried.push({ route: "table", why: "skipped: the table route failed earlier in this session" });
  }
  const stuck = await takeOut(ctx, s, job); // a failed take-out is part of the table route's failure; the fallback still runs
  if (stuck !== null && tried[0]) tried[0].why += `; ${stuck}`;
  const dc = await byDevelop(ctx, s, job);
  if (typeof dc !== "string") {
    s.aiRoute = "dc";
    return { ...dc, fallback: tried[0]?.why ?? "" };
  }
  tried.push({ route: "dc", why: dc });
  const left = await takeOut(ctx, s, job);
  const table = left === null ? "The last read of the mask table showed this pass's attempts gone (they stay in History)" : `This pass's attempt may still be in the mask table (${left}): lr_list_masks shows it, and lr_end_session revert removes it`;
  throw featureUnavailable(`An AI ${job.kind} mask`, ctx.deps.client.hello(), `neither the mask table nor Lightroom's Develop controller made it (routes_tried says why); linear, radial and luminance masks still work. ${table}; the pass is not used.`, {
    routes_tried: tried,
    waited_ms: ms(started),
  });
}
