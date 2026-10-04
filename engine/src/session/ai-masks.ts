// AI masks inside a mask pass (masks.ts; GitHub issue #59, PR C step 2): the table route first,
// LrDevelopController after it [stated: Jim, 2026-10-03, "Table + Develop fallback"]; people and
// landscape kinds have the table route only (params\mask-table.ts AI_KINDS).
//   - Table: the entry is written without its digests (masks.ts), then update_ai_settings, then the
//     table is read every AI_POLL_MS until the entry has its digest. In capture 1 the call took 2.8 s
//     and the digests were there 1.2 s later [handle: docs\reports\phase6\masks-capture\check.json
//     `7_sky`]; AI_WAIT_MS leaves room for a slower photo [inference].
//   - The table route fails when the plugin lacks the call (feature_unavailable, unknown_command), the
//     call fails, or the mask does not compute in time. Then the entry is taken out again ("… mask ai
//     revert") and create_ai_mask_dc makes the mask; the new entry is found by its id, and its name
//     and sliders are written by an AVG table write ("… mask sliders"). The DC step itself keeps
//     Lightroom's History name [stated: Jim, 2026-10-03, "Accept for fallback (Recommended)"]; a
//     DC setValue did not show in an immediate table read [handle: docs\reports\phase6\masks-capture\12_probe_dc.json
//     getDevelopSettings_after_sky], hence the table write.
//   - Neither route: FEATURE_UNAVAILABLE {routes_tried, waited_ms}, the table as before the pass (the
//     attempts stay in History) and the pass not used.
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
/** create_ai_mask_dc bounds itself at 15 s (plugin\LrC-AVG.lrplugin\Masks.lua COMMAND_SECONDS). */
const DC_TIMEOUT_MS = 25000;

export type AiResult = {
  sdk: SdkSettings;
  id: string;
  route: "table" | "dc";
  fallback?: string;
  update_ms?: number;
  computed_ms?: number;
  dc_ms?: number;
};

/** What the AI route needs from the pass: the photo, its pass, the table before it, and the new entry's id, name and sliders. */
export type AiJob = { t: Target; n: number; kind: AiKind; before: Correction[]; id: string; name: string; stored: Record<string, number>; historyNames: string[] };

const why = (err: unknown): string => (err instanceof Error ? err.message : String(err));
/** A route that is not there or failed in the plugin (io.ts bridge() has turned the plugin's error into a ToolError). */
const missing = (err: unknown): boolean => ["FEATURE_UNAVAILABLE", "UPDATE_FAILED"].includes(toToolError(err).code);
/** A failure that stops the pass rather than the route: Lightroom gone or not answering, another photo selected, the user's Abort. */
const stops = (err: unknown): boolean => ["BRIDGE_DISCONNECTED", "BRIDGE_TIMEOUT", "TARGET_CHANGED", "SESSION_ENDED"].includes(toToolError(err).code);

/** Read the table until the correction `pick` names has computed, or the wait ends; the read and the time waited. */
async function waitComputed(ctx: SessionContext, s: Session, t: Target, pick: (entries: Correction[]) => string | null): Promise<{ sdk: SdkSettings; id: string | null; ms: number }> {
  const started = performance.now();
  const wait = ctx.deps.aiWaitMs ?? AI_WAIT_MS;
  for (;;) {
    checkAbort(s);
    const { sdk } = await readSdk(ctx, s, t);
    const id = pick(readTable(sdk));
    const done = id !== null && computed(firstComponent(readTable(sdk), id) ?? {});
    if (done || performance.now() - started >= wait) return { sdk, id: done ? id : null, ms: ms(started) };
    await new Promise((resolve) => setTimeout(resolve, AI_POLL_MS));
  }
}

/** Put the table back as it was before the pass, when anything of the attempt is still in it. */
async function takeOut(ctx: SessionContext, s: Session, job: AiJob): Promise<void> {
  const now = readTable((await readSdk(ctx, s, job.t)).sdk);
  if (correctionIds(now).join() === correctionIds(job.before).join()) return;
  const name = historyName(s, job.t, job.n, "mask ai revert");
  await writeTable(ctx, s, job.t, job.before, name, true);
  job.historyNames.push(name);
}

async function byTable(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult | string> {
  const t0 = performance.now();
  try {
    await bridge(s, job.t, () => ctx.deps.client.request("update_ai_settings", { photo_uuid: job.t.uuid }, { timeoutMs: UPDATE_TIMEOUT_MS }));
  } catch (err) {
    if (!missing(err)) throw err;
    return `update_ai_settings: ${why(err)}`;
  }
  const update = ms(t0);
  const done = await waitComputed(ctx, s, job.t, (entries) => (correctionIds(entries).includes(job.id) ? job.id : null));
  if (done.id === null) return `the mask did not compute within ${Math.round(done.ms)} ms of update_ai_settings`;
  return { sdk: done.sdk, id: job.id, route: "table", update_ms: update, computed_ms: done.ms };
}

async function byDevelop(ctx: SessionContext, s: Session, job: AiJob): Promise<AiResult | string> {
  const subtype = AI_KINDS[job.kind].dc;
  if (subtype === null) return "none for this kind: LrDevelopController made no people or landscape mask in capture 2";
  checkAbort(s);
  const t0 = performance.now();
  let made: string[];
  try {
    const res = await bridge(s, job.t, () => ctx.deps.client.request("create_ai_mask_dc", { target_uuid: job.t.uuid, subtype }, { timeoutMs: DC_TIMEOUT_MS }));
    made = res.new_ids;
    if (made.length === 0) return `create_ai_mask_dc made no mask within ${Math.round(res.waited_ms)} ms${res.stopped ? ` (${res.stopped})` : ""}`;
  } catch (err) {
    if (stops(err)) throw err;
    return `create_ai_mask_dc: ${why(err)}`;
  }
  const old = new Set(correctionIds(job.before));
  const done = await waitComputed(ctx, s, job.t, (entries) => correctionIds(entries).find((id) => made.includes(id) && !old.has(id)) ?? null);
  if (done.id === null) return `the mask create_ai_mask_dc made did not compute within ${Math.round(done.ms)} ms`;
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
  await takeOut(ctx, s, job);
  const dc = await byDevelop(ctx, s, job);
  if (typeof dc !== "string") {
    s.aiRoute = "dc";
    return { ...dc, fallback: tried[0]?.why ?? "" };
  }
  tried.push({ route: "dc", why: dc });
  await takeOut(ctx, s, job);
  throw featureUnavailable(`An AI ${job.kind} mask`, ctx.deps.client.hello(), "neither the mask table nor Lightroom's Develop controller made it (routes_tried says why); linear, radial and luminance masks still work. The mask table is as before the call (its attempts stay in History); the pass is not used.", {
    routes_tried: tried,
    waited_ms: ms(started),
  });
}
