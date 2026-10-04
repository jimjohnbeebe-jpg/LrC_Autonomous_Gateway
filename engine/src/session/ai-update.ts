// The table route's wait for an AI mask (GitHub issue #59, PR C steps 2b-2d): update_ai_settings, then the
// table read until Lightroom answers, and nothing written to the photo before it has.
// In Jim's step-2 check, Lightroom's "Update AI Settings Errors" dialog opened inside the update's write gate
// and held it; every later write, the put-backs included, was refused until Jim restarted Lightroom
// [stated: Jim, 2026-10-03, his screenshot and his restart of Lightroom]. In capture 5's row E the engine put
// the photo back after Lightroom's gate was free again; the catalog read back equal, yet Lightroom's screen
// kept the edit until a restart [stated: Jim, 2026-10-04; handle: capture 5's evidence,
// docs\reports\phase6\masks-capture\capture5-* row E]. That the put-back changed the photo under Lightroom's
// still running computation is [inference]: the update's own record says "done" before the computation ends,
// as the digests appeared 0.3-0.5 s after updateAISettings returned [handle:
// docs\reports\phase6\masks-capture\capture3-check.json steps `4_*`]. Jim chose to wait for Lightroom
// [stated: Jim, 2026-10-04, "Wait for Lightroom (Recommended)"], and that nothing writes to the photo while a
// mask it was asked to compute has no result, the engine reverting by itself after a Lightroom restart
// [stated: Jim, 2026-10-04, "Yes: revert after restart (Recommended)"] (D16). So:
//   - the plugin's update runs in its own task and answers at once (plugin 0.14.0) [unverified]; with it goes `watch`
//     (params\mask-ops.ts aiWatch), and plugin 0.16.0 refuses every write to the photo (ai_compute_pending)
//     until the entry shows a result (plugin\LrC-AVG.lrplugin\Pending.lua). The HUD says Lightroom is working
//     (WORKING_NOTE), and the engine reads the table, every POLL_MS doubling to 1 s, for the entry's digest
//     (computed [handle: docs\reports\phase6\masks-capture\check.json `7_sky.new_digests`]) or an ErrorReason
//     other than 0 (nothing to mask: Snow and Water came back with 1 [handle: docs\reports\phase6\
//     masks-capture\capture4-check.json steps `row4_snow`, `row4_water`]), for up to COMPUTE_MS, 5 minutes;
//   - s.aiPending is set meanwhile: the session writes, exports, renders and reverts nothing (io.ts
//     settlePending). It is cleared when the entry computes, answers an ErrorReason or is gone, or when
//     Lightroom reports the update failed; never on a thrown error (a dropped bridge, another photo
//     selected): a later call reads the table again first (settlePending);
//   - after DIALOG_AFTER_MS with nothing in the table, probe_write_gate: "aborted" (the gate is held) means
//     Lightroom is busy or shows a dialog [inference: a cold model holds the gate as long], and the HUD says
//     so (DIALOG_NOTE). The photo is put back (ai-revert.ts autoRevert) [stated: Jim, 2026-10-03, "Also
//     auto-revert"] only when Lightroom reports the update failed after a busy gate, or dropped it
//     (abandoned): then nothing computes [inference]. D13's put-backs 60 s after the gate was free again and
//     after 5 minutes are gone: they could write under a running computation (D16);
//   - no result within COMPUTE_MS, or gate probes unanswered for STUCK_PROBES_MS: LIGHTROOM_STUCK, nothing
//     written, the session open with aiPending kept (`stuck`); the user restarts Lightroom, and the engine
//     puts the photo back once the plugin connects from a new Lightroom process (restart.ts); a result
//     that comes first lets the session go on;
//   - a failed update with the gate never seen busy is a plugin error, after which the LrDevelopController
//     route may run (the lead's review of efffd2e, 2026-10-03);
//   - the reads name the photo by uuid (photo_uuid), so a change of selection does not end the wait.
// Every read checks the user's Abort first. [handle: tests\session-ai-dialog.test.ts,
// tests\session-ai-restart.test.ts, against the Lightroom sim. In Lightroom, capture 4 saw updates compute
// and ErrorReason answers without a dialog (capture4-check.json); the rest is [unverified] until capture 6.]

import { randomUUID } from "node:crypto";
import type { CommandResult } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiError, aiWatch, computed, firstComponent, readTable, type SdkSettings } from "../params/index.js";
import type { AiJob } from "./ai-masks.js";
import { bridge, checkAbort, ms } from "./io.js";
import type { Session, SessionContext } from "./types.js";

export type AiTimings = {
  /** How long the engine waits for Lightroom's result after update_ai_settings. */
  computeMs: number;
  /** The first wait between reads; it doubles up to pollMaxMs. */
  pollMs: number;
  pollMaxMs: number;
  /** How long update_ai_settings may take to answer (plugin 0.14.0 answers from its own task [unverified]; 0.13.0 held the answer 11 s in its gate [handle: capture4-check.json `row2_vegetation`]). */
  replyMs: number;
  /** After this long with nothing in the table, the write gate is probed, every probeEveryMs; each probe waits probeReplyMs [inference]. */
  dialogAfterMs: number;
  probeEveryMs: number;
  probeReplyMs: number;
  /** Probes unanswered this long: Lightroom seems stuck [inference]. */
  stuckProbesMs: number;
  /** LrDevelopController's mask: how long it may take to show and compute (ai-masks.ts). */
  dcWaitMs: number;
};
/**
 * Capture 3's updates took 1.0-1.2 s, the digests 0.3-0.5 s after [handle: docs\reports\phase6\masks-capture\capture3-check.json
 * `4_*`]. Capture 4's 11 s was plugin 0.13.0's gate holding the answer while the update ran, not a compute time [handle:
 * capture4-check.json `row2_vegetation` `update`]. COMPUTE_MS, 5 minutes, is Jim's [stated: Jim, 2026-10-04, "Wait for Lightroom (Recommended)"].
 */
export const AI_TIMINGS: Readonly<AiTimings> = {
  computeMs: 300_000,
  pollMs: 250,
  pollMaxMs: 1000,
  replyMs: 10_000,
  dialogAfterMs: 10_000,
  probeEveryMs: 2000,
  probeReplyMs: 5000,
  stuckProbesMs: 60_000,
  dcWaitMs: 10_000,
};
export const aiTimings = (ctx: SessionContext): AiTimings => ({ ...AI_TIMINGS, ...ctx.deps.aiTimings });

/** True for a dialog and for a slow model alike: both hold the write gate (the header's [inference]). */
export const DIALOG_NOTE = "Lightroom is busy or shows a dialog: if a dialog is open in Lightroom, click OK.";
export const WORKING_NOTE = "Lightroom is computing the AI mask; this can take a few minutes.";

export type Update =
  | { kind: "computed"; sdk: SdkSettings; update_ms: number; computed_ms: number; dialog_ms?: number }
  | { kind: "not_found"; reason: number }
  | { kind: "failed"; why: string; fallback: boolean }
  /** Lightroom reported the update failed after a busy gate, or dropped it: put the photo back (nothing computes). */
  | { kind: "dialog"; why: string; dialog_ms: number }
  /** No result in time, or Lightroom not answering: nothing is written, aiPending stays (stuck). */
  | { kind: "stuck"; why: string; dialog_ms: number };

const sleep = (t: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, t));
const STOPS = ["BRIDGE_DISCONNECTED", "TARGET_CHANGED", "SESSION_ENDED"];

const ABANDONED = "Lightroom's catalog stayed busy, so Lightroom dropped the update";
/** The probe's record of an update: this request's (its token), or of the photo when the plugin sent no token. */
const ownUpdate = (p: CommandResult<"probe_write_gate"> | null, job: AiJob, token: string) => {
  const u = p?.update;
  if (!u) return null;
  return (u.request_id !== undefined ? u.request_id === token : u.uuid === undefined || u.uuid === job.t.uuid) ? u : null;
};

/** update_ai_settings; null once it is under way (or may be: no answer in time), else what ended it. */
async function send(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings, token: string): Promise<Update | null> {
  try {
    const res = await bridge(s, job.t, () => ctx.deps.client.request("update_ai_settings", { photo_uuid: job.t.uuid, request_id: token, watch: aiWatch([job.id]) }, { timeoutMs: T.replyMs }));
    if (res.state === "abandoned") return { kind: "dialog", why: ABANDONED, dialog_ms: 0 };
    return res.state === "failed" ? { kind: "failed", why: "update_ai_settings: the update failed", fallback: true } : null;
  } catch (err) {
    const e = toToolError(err);
    if (e.code === "BRIDGE_TIMEOUT") return null; // a dialog may hold the answer too (Masks.lua): watch the table
    if (STOPS.includes(e.code)) throw err;
    return { kind: "failed", why: `update_ai_settings: ${e.message}`, fallback: true };
  }
}

/** The table and the entry's component; null when Lightroom did not answer the read in time. */
async function look(ctx: SessionContext, job: AiJob): Promise<{ sdk: SdkSettings; m: Record<string, unknown> | null } | null> {
  try {
    const sdk = (await ctx.deps.client.request("get_settings", { photo_uuid: job.t.uuid })).settings;
    return { sdk, m: firstComponent(readTable(sdk), job.id) };
  } catch (err) {
    if (toToolError(err).code === "BRIDGE_TIMEOUT") return null;
    throw err;
  }
}

/** probe_write_gate; null when the plugin lacks it or did not answer. */
async function probe(ctx: SessionContext, T: AiTimings): Promise<CommandResult<"probe_write_gate"> | null> {
  try {
    return await ctx.deps.client.request("probe_write_gate", {}, { timeoutMs: T.probeReplyMs });
  } catch (err) {
    if (toToolError(err).code === "BRIDGE_DISCONNECTED") throw err;
    return null;
  }
}

/** The user, told on the HUD; the note stays while the operation runs. */
function tell(ctx: SessionContext, s: Session, note: string): void {
  if (s.work) s.work.note = note;
  ctx.deps.hud?.stage(s, "applying");
}

/** What the probes said so far. `settled`: the update is over and the gate read free, so no more probes. */
type Watch = { dialogAt: number | null; probed: number; settled: boolean; state: string | null; answered: number };

/** What a probe says about this update: an Update to return, or null to read on (`w` updated). */
function judge(p: CommandResult<"probe_write_gate"> | null, job: AiJob, w: Watch, now: number, token: string): Update | null {
  if (p) w.answered = now;
  const own = ownUpdate(p, job, token);
  if (own) w.state = own.state;
  const dms = w.dialogAt === null ? 0 : Math.round(now - w.dialogAt);
  if (own?.state === "abandoned") return { kind: "dialog", why: ABANDONED, dialog_ms: dms };
  if (own?.state === "failed") return w.dialogAt === null ? { kind: "failed", why: `updateAISettings raised in Lightroom: ${own.error ?? "no message"}`, fallback: true } : { kind: "dialog", why: `Lightroom reported the update failed: ${own.error ?? "no message"}`, dialog_ms: dms };
  if (p?.status === "aborted") w.dialogAt ??= now;
  else if (p?.status === "executed" && own?.state === "done") w.settled = true;
  return null;
}

/** Whether the wait is over without a result: no answer to the probes, or no result within computeMs. Nothing is written either way. */
function decide(w: Watch, T: AiTimings, t0: number, now: number): Update | null {
  const dms = w.dialogAt === null ? 0 : Math.round(now - w.dialogAt);
  if (w.probed > 0 && !w.settled && now - Math.max(w.answered, t0 + T.dialogAfterMs) >= T.stuckProbesMs) return { kind: "stuck", why: `Lightroom did not answer the gate probes for ${Math.round((now - w.answered) / 1000)} s`, dialog_ms: dms };
  if (now - t0 < T.computeMs) return null;
  return { kind: "stuck", why: `no result within ${Math.round(T.computeMs / 60_000)} minutes${w.state ? `, Lightroom's update ${w.state}` : ""}`, dialog_ms: dms };
}

async function watch(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings, t0: number, note: string | undefined, token: string): Promise<Update> {
  const w: Watch = { dialogAt: null, probed: 0, settled: false, state: null, answered: t0 };
  for (let wait = T.pollMs; ; wait = Math.min(wait * 2, T.pollMaxMs)) {
    checkAbort(s);
    const seen = await look(ctx, job);
    if (seen && !seen.m) return { kind: "failed", why: "the mask's entry is no longer in the table (removed in Lightroom?)", fallback: false };
    const reason = seen?.m ? aiError(seen.m) : null;
    if (reason !== null) return { kind: "not_found", reason };
    const now = performance.now();
    if (seen?.m && computed(seen.m)) {
      tell(ctx, s, note ?? "Lightroom finished the mask.");
      return { kind: "computed", sdk: seen.sdk, update_ms: 0, computed_ms: ms(t0), ...(w.dialogAt !== null ? { dialog_ms: Math.round(now - w.dialogAt) } : {}) };
    }
    const out = decide(w, T, t0, now);
    if (out) return out;
    if (now - t0 >= T.dialogAfterMs && !w.settled && now - w.probed >= T.probeEveryMs) {
      w.probed = now;
      const seenDialog = w.dialogAt !== null;
      const judged = judge(await probe(ctx, T), job, w, now, token);
      if (judged) return judged;
      if (!seenDialog && w.dialogAt !== null) tell(ctx, s, DIALOG_NOTE);
    }
    await sleep(wait);
  }
}

/**
 * Ask Lightroom to compute the entry `job.id` and wait for its answer (Update). s.aiPending is set meanwhile
 * and cleared on a result (computed, nothing found, a failure Lightroom or the plugin reported); after a
 * dialog verdict autoRevert clears it; after a stuck one, or a thrown error, it stays (D16).
 */
export async function updateAndWait(ctx: SessionContext, s: Session, job: AiJob): Promise<Update> {
  const T = aiTimings(ctx);
  const t0 = performance.now();
  const note = s.work?.note;
  checkAbort(s); // an Abort clicked during the table write stops here, before the update goes out
  const hello = ctx.deps.client.hello();
  // No connection: the update is not sent, so nothing is pending (else the session could never be put back).
  if (!hello) throw new ToolError("BRIDGE_DISCONNECTED", "Lightroom is not connected; the AI update was not sent.", true);
  s.aiPending = { since: ctx.now().toISOString(), kind: job.kind, job, process: hello.process_started_at ?? null, stuck: false };
  let out: Update | null = null;
  try {
    const token = randomUUID();
    const ended = await send(ctx, s, job, T, token);
    const sent = ms(t0);
    if (!ended) tell(ctx, s, WORKING_NOTE);
    out = ended ?? (await watch(ctx, s, job, T, t0, note, token));
    if (out.kind === "computed") out.update_ms = sent;
    return out;
  } finally {
    if (out?.kind === "computed" || out?.kind === "not_found" || out?.kind === "failed") s.aiPending = null;
    else if (out?.kind === "stuck" && s.aiPending) s.aiPending.stuck = true;
  }
}

/** The error for a write, export, render or revert while an AI update has no result (io.ts settlePending). */
export function pendingError(s: Session): ToolError {
  const p = s.aiPending;
  const restart = `the user restarts Lightroom (File > Exit, then start it again); once it is back, the engine puts the photo back as it was before the session by itself and ends session ${s.id}`;
  const message = p?.stuck
    ? `Lightroom's AI ${p.kind} mask computation seems stuck (asked for at ${p.since}): nothing more is written, rendered or reverted in session ${s.id}, so nothing is written under it. Tell the user: ${restart}. If Lightroom finishes the mask first, the session goes on.`
    : `Lightroom has not finished the AI ${p?.kind ?? ""} mask asked for at ${p?.since ?? "?"}: nothing more is written, rendered or reverted in session ${s.id} until its result shows (each call checks again). If it seems stuck, ${restart}.`;
  return new ToolError("AI_UPDATE_PENDING", message, !p?.stuck, { session_id: s.id, stuck: p?.stuck ?? false });
}

/**
 * Before a write, export or render (io.ts) and a revert (end.ts): refused (AI_UPDATE_PENDING) while the AI
 * update has no result. A read that shows the entry's digest or ErrorReason, or the entry gone, clears
 * s.aiPending first; a read Lightroom does not answer leaves it set.
 */
export async function settlePending(ctx: SessionContext, s: Session): Promise<void> {
  const p = s.aiPending;
  if (!p) return;
  const seen = await look(ctx, p.job).catch(() => null);
  if (seen && (!seen.m || computed(seen.m) || aiError(seen.m) !== null)) {
    s.aiPending = null;
    return;
  }
  throw pendingError(s);
}
