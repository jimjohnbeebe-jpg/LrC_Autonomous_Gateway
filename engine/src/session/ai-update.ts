// The table route's wait for an AI mask (GitHub issue #59, PR C steps 2b-2c, D13): update_ai_settings, then
// the table read until Lightroom answers, without ever leaving the photo stuck.
// In Jim's step-2 check, Lightroom's "Update AI Settings Errors" dialog opened inside the update's
// write gate and held it; every later write, the put-backs included, was refused until Jim restarted
// Lightroom [stated: Jim, 2026-10-03, his screenshot and his restart of Lightroom]. In capture 5 the engine
// put the photo back 20 s after the gate was free again, the catalog read back equal, yet Lightroom's screen
// kept the edit until a restart [stated: Jim, 2026-10-04; handle: the session log of that run, main checkout
// logs\check-masks-capture5-2026-10-04\sessions\20261004-92370f.json]; that the put-back changed the photo
// under Lightroom's still running computation is [inference]. Jim then chose to wait for Lightroom
// [stated: Jim, 2026-10-04, "Wait for Lightroom (Recommended)"]. So:
//   - the plugin's update runs in its own task and answers at once [unverified until capture 5] (plugin
//     0.14.0; 0.13.0's asynchronous gate held the answer for 11 s [handle: docs\reports\phase6\masks-capture\
//     capture4-check.json step `row2_vegetation`]); the HUD says Lightroom is working (WORKING_NOTE), and the
//     engine reads the table, every POLL_MS doubling to 1 s, for the entry's digest (computed [handle:
//     docs\reports\phase6\masks-capture\check.json `7_sky.new_digests`]) or an ErrorReason other than 0
//     (nothing to mask: Snow and Water came back with 1 [handle: capture4-check.json steps `row4_snow`,
//     `row4_water`]), for up to COMPUTE_MS, 5 minutes;
//   - while the update is pending (s.aiPending) the session writes, exports and renders nothing (io.ts
//     checkPending) [unverified: exports made while the gate was held wrote no JPEG in the plugin's log of
//     Jim's step-2 run, which is not committed];
//   - after DIALOG_AFTER_MS with nothing in the table, probe_write_gate: "aborted" (the gate is held) means
//     Lightroom is busy or shows a dialog [inference: a cold model holds the gate as long], and the HUD says
//     so (DIALOG_NOTE). The photo is put back (ai-masks.ts autoRevert) [stated: Jim, 2026-10-03, "Also
//     auto-revert"] only when: Lightroom reports the update failed after a busy gate, or dropped it
//     (abandoned); or the gate was busy and is free again and the mask still has not computed GRACE_MS
//     (60 s) later; or COMPUTE_MS passed. Never while the plugin's record of the update still says started or
//     running: then, and when probes go unanswered for STUCK_PROBES_MS, the result says Lightroom seems stuck
//     and nothing is written (the lead's D13 directive, 2026-10-04);
//   - a failed update with the gate never seen busy is a plugin error, after which the LrDevelopController
//     route may run (the lead's review of efffd2e, 2026-10-03);
//   - the reads name the photo by uuid (photo_uuid), so a change of selection does not end the wait.
// Every read checks the user's Abort first. [handle: tests\session-ai-dialog.test.ts, against the Lightroom
// sim. In Lightroom, capture 4 saw updates compute and ErrorReason answers without a dialog
// (capture4-check.json); the waits above are [unverified] until capture 6.]

import { randomUUID } from "node:crypto";
import type { CommandResult } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiError, computed, firstComponent, readTable, type SdkSettings } from "../params/index.js";
import type { AiJob } from "./ai-masks.js";
import { bridge, checkAbort, ms } from "./io.js";
import type { Session, SessionContext } from "./types.js";

export type AiTimings = {
  /** How long the engine waits for Lightroom's result after update_ai_settings. */
  computeMs: number;
  /** The first wait between reads; it doubles up to pollMaxMs. */
  pollMs: number;
  pollMaxMs: number;
  /** How long update_ai_settings may take to answer (plugin 0.14.0 answers from its own task at once [unverified until capture 5]; 0.13.0 took 11 s, capture4-check.json). */
  replyMs: number;
  /** After this long with nothing in the table, the write gate is probed, every probeEveryMs; each probe waits probeReplyMs. */
  dialogAfterMs: number;
  probeEveryMs: number;
  probeReplyMs: number;
  /** Probes unanswered this long: Lightroom seems stuck. */
  stuckProbesMs: number;
  /** Once the gate is free again after a busy spell, how long the mask may still take to show. */
  graceMs: number;
  /** LrDevelopController's mask: how long it may take to show and compute (ai-masks.ts). */
  dcWaitMs: number;
};
/** Capture 3's updates took 1.0-1.2 s, the digests 0.3-0.5 s after [handle: docs\reports\phase6\masks-capture\capture3-check.json `4_*`]; capture 4's cold model 11 s [handle: capture4-check.json `row2_vegetation`]. */
export const AI_TIMINGS: Readonly<AiTimings> = {
  computeMs: 300_000,
  pollMs: 250,
  pollMaxMs: 1000,
  replyMs: 10_000,
  dialogAfterMs: 10_000,
  probeEveryMs: 2000,
  probeReplyMs: 5000,
  stuckProbesMs: 60_000,
  graceMs: 60_000,
  dcWaitMs: 10_000,
};
export const aiTimings = (ctx: SessionContext): AiTimings => ({ ...AI_TIMINGS, ...ctx.deps.aiTimings });

/** True for a dialog and for a slow model alike: both hold the write gate (the header's [inference]). */
export const DIALOG_NOTE = "Lightroom is busy or shows a dialog: if a dialog is open in Lightroom, click OK.";
export const WORKING_NOTE = "Lightroom is computing the AI mask; this can take a few minutes.";
/** The lead's words (D13, 2026-10-04) for a stuck Lightroom after the photo was put back. */
export const STUCK_REVERTED = "Lightroom's AI mask computation seems stuck. Your photo's settings are back to before the edit in the catalog; if Lightroom's screen still shows the edit, restart Lightroom.";

export type Update =
  | { kind: "computed"; sdk: SdkSettings; update_ms: number; computed_ms: number; dialog_ms?: number }
  | { kind: "not_found"; reason: number }
  | { kind: "failed"; why: string; fallback: boolean }
  /** Put the photo back; `stuck`: no result in COMPUTE_MS (the result says Lightroom seems stuck). */
  | { kind: "dialog"; why: string; dialog_ms: number; stuck?: boolean }
  /** Lightroom seems stuck with its update still running (or not answering): nothing is written. */
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
    const res = await bridge(s, job.t, () => ctx.deps.client.request("update_ai_settings", { photo_uuid: job.t.uuid, request_id: token }, { timeoutMs: T.replyMs }));
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
type Watch = { dialogAt: number | null; freeAt: number | null; probed: number; settled: boolean; state: string | null; answered: number };

/** What a probe says about this update: an Update to return, or null to read on (`w` updated). */
function judge(p: CommandResult<"probe_write_gate"> | null, job: AiJob, w: Watch, now: number, token: string): Update | null {
  if (p) w.answered = now;
  const own = ownUpdate(p, job, token);
  if (own) w.state = own.state;
  const dms = w.dialogAt === null ? 0 : Math.round(now - w.dialogAt);
  if (own?.state === "abandoned") return { kind: "dialog", why: ABANDONED, dialog_ms: dms };
  if (own?.state === "failed") return w.dialogAt === null ? { kind: "failed", why: `updateAISettings raised in Lightroom: ${own.error ?? "no message"}`, fallback: true } : { kind: "dialog", why: `Lightroom reported the update failed: ${own.error ?? "no message"}`, dialog_ms: dms };
  if (p?.status === "aborted") [w.dialogAt, w.freeAt] = [w.dialogAt ?? now, null];
  else if (p?.status === "executed" && w.dialogAt !== null) w.freeAt ??= now;
  else if (p?.status === "executed" && own?.state === "done") w.settled = true;
  return null;
}

/** Whether the time is up (or Lightroom stopped answering) and what to do: put back, or say it seems stuck. */
function decide(w: Watch, T: AiTimings, t0: number, now: number): Update | null {
  const running = w.state === "started" || w.state === "running";
  const dms = w.dialogAt === null ? 0 : Math.round(now - w.dialogAt);
  const probing = w.probed > 0 && !w.settled && w.freeAt === null;
  if (probing && now - Math.max(w.answered, t0 + T.dialogAfterMs) >= T.stuckProbesMs) return { kind: "stuck", why: `Lightroom did not answer the gate probes for ${Math.round((now - w.answered) / 1000)} s`, dialog_ms: dms };
  if (w.freeAt !== null && now - w.freeAt >= T.graceMs && !running) return { kind: "dialog", why: `Lightroom was free again and the mask still had not computed ${Math.round(T.graceMs / 1000)} s later`, dialog_ms: dms };
  if (now - t0 < T.computeMs) return null;
  const mins = Math.round(T.computeMs / 60_000);
  return running ? { kind: "stuck", why: `no result within ${mins} minutes, and Lightroom's update still ${w.state}`, dialog_ms: dms } : { kind: "dialog", why: `no result within ${mins} minutes`, dialog_ms: dms, stuck: true };
}

async function watch(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings, t0: number, note: string | undefined, token: string): Promise<Update> {
  const w: Watch = { dialogAt: null, freeAt: null, probed: 0, settled: false, state: null, answered: t0 };
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
    if (now - t0 >= T.dialogAfterMs && w.freeAt === null && !w.settled && now - w.probed >= T.probeEveryMs) {
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
 * Ask Lightroom to compute the entry `job.id` and wait for its answer (Update). s.aiPending is set
 * meanwhile; it stays set after a put-back verdict or a stuck Lightroom, for the caller to clear.
 */
export async function updateAndWait(ctx: SessionContext, s: Session, job: AiJob): Promise<Update> {
  const T = aiTimings(ctx);
  const t0 = performance.now();
  const note = s.work?.note;
  s.aiPending = { since: ctx.now().toISOString(), kind: job.kind };
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
    if (out?.kind !== "dialog" && out?.kind !== "stuck") s.aiPending = null;
  }
}

/** The error for a write, export or render while an AI update is pending (io.ts). */
export function pendingError(s: Session): ToolError {
  const p = s.aiPending;
  return new ToolError(
    "AI_UPDATE_PENDING",
    `Lightroom has not finished the AI ${p?.kind ?? ""} mask asked for at ${p?.since ?? "?"}, and may show a dialog or seem stuck: the user clicks OK in Lightroom if a dialog is open, or restarts Lightroom. Nothing more is written or rendered in session ${s.id} until then; lr_end_session with outcome "revert" puts the photo back.`,
    true,
    { session_id: s.id },
  );
}
