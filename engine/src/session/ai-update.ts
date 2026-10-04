// The table route's wait for an AI mask (GitHub issue #59, PR C step 2b): update_ai_settings, then the
// table read until Lightroom answers, without ever leaving the photo stuck.
// In Jim's step-2 check, Lightroom's "Update AI Settings Errors" dialog opened inside the update's
// write gate and held it; every later write, the put-backs included, was refused until Jim restarted
// Lightroom [stated: Jim, 2026-10-03, his screenshot and his restart of Lightroom]. So:
//   - the plugin's update runs in an asynchronous gate and answers at once (plugin\LrC-AVG.lrplugin\
//     Masks.lua); the engine then reads the table, every POLL_MS doubling to 1 s, for the entry's
//     digest (computed [handle: docs\reports\phase6\masks-capture\check.json `7_sky.new_digests`]) or an
//     ErrorReason other than 0 (Lightroom found nothing to mask [unverified until capture 4 row 4]);
//   - while the update is pending (s.aiPending) the session writes, exports and renders nothing
//     (io.ts checkPending): in that run the exports made while the gate was held wrote no JPEG
//     [unverified: seen in the plugin's log of Jim's step-2 run, which is not committed];
//   - after DIALOG_AFTER_MS with nothing in the table, probe_write_gate: "aborted" (the gate is held)
//     means Lightroom is busy or shows a dialog [inference: a cold model could hold the gate as long;
//     then the mask computes once the gate is free and nothing is reverted]. The user is told so on the
//     HUD (the work note, DIALOG_NOTE, true in both cases [stated: the lead, 2026-10-03]) and in the tool result, and the engine keeps probing for up to DIALOG_WAIT_MS. Once the gate is free and
//     the mask still has not computed within GRACE_MS, the caller puts the photo back (ai-masks.ts
//     autoRevert) [stated: Jim, 2026-10-03, "Also auto-revert"];
//   - the probe also reports the update's own state: failed (updateAISettings raised) or abandoned
//     (the gate stayed held and Lightroom dropped it) are gate or plugin errors, after which the
//     LrDevelopController route may run; a mask that does not compute in COMPUTE_MS is not.
// Every read checks the user's Abort first. [handle: tests\session-ai-dialog.test.ts, against the
// Lightroom sim; in Lightroom [unverified] until capture 4.]

import type { CommandResult } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiError, computed, firstComponent, readTable, type SdkSettings } from "../params/index.js";
import type { AiJob } from "./ai-masks.js";
import { bridge, checkAbort, ms, readSdk } from "./io.js";
import type { Session, SessionContext } from "./types.js";

export type AiTimings = {
  /** How long a mask may take to compute while the catalog is free (a cold model [inference]). */
  computeMs: number;
  /** The first wait between reads; it doubles up to pollMaxMs. */
  pollMs: number;
  pollMaxMs: number;
  /** How long update_ai_settings may take to answer (it answers at once from an asynchronous gate). */
  replyMs: number;
  /** After this long with nothing in the table, the write gate is probed, every probeEveryMs. */
  dialogAfterMs: number;
  probeEveryMs: number;
  /** How long the engine waits for the user to close a dialog. */
  dialogWaitMs: number;
  /** Once the gate is free again, how long the mask may still take to show. */
  graceMs: number;
  /** LrDevelopController's mask: how long it may take to show and compute (ai-masks.ts). */
  dcWaitMs: number;
};
/** Capture 3's updates took 1.0-1.2 s, the digests 0.3-0.5 s after [handle: docs\reports\phase6\masks-capture\capture3-check.json `4_*`]; capture 1's 2.8 s and 1.2 s [handle: same folder, check.json `7_sky`]. */
export const AI_TIMINGS: Readonly<AiTimings> = {
  computeMs: 120_000,
  pollMs: 250,
  pollMaxMs: 1000,
  replyMs: 10_000,
  dialogAfterMs: 10_000,
  probeEveryMs: 2000,
  dialogWaitMs: 600_000,
  graceMs: 3000,
  dcWaitMs: 10_000,
};
export const aiTimings = (ctx: SessionContext): AiTimings => ({ ...AI_TIMINGS, ...ctx.deps.aiTimings });

/** True for a dialog and for a slow model alike: both hold the write gate (the header's [inference]). */
export const DIALOG_NOTE = "Lightroom is busy or shows a dialog: if a dialog is open in Lightroom, click OK.";

export type Update =
  | { kind: "computed"; sdk: SdkSettings; update_ms: number; computed_ms: number; dialog_ms?: number }
  | { kind: "not_found"; reason: number }
  | { kind: "failed"; why: string; fallback: boolean }
  | { kind: "dialog"; why: string; dialog_ms: number };

const sleep = (t: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, t));
const STOPS = ["BRIDGE_DISCONNECTED", "TARGET_CHANGED", "SESSION_ENDED"];

/** update_ai_settings; null once it is under way (or may be: no answer in time), else why it failed. */
async function send(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings): Promise<string | null> {
  try {
    const res = await bridge(s, job.t, () => ctx.deps.client.request("update_ai_settings", { photo_uuid: job.t.uuid }, { timeoutMs: T.replyMs }));
    return res.state === "failed" || res.state === "abandoned" ? `update_ai_settings: the update ${res.state}` : null;
  } catch (err) {
    const e = toToolError(err);
    if (e.code === "BRIDGE_TIMEOUT") return null; // a dialog may hold the answer too (Masks.lua): watch the table
    if (STOPS.includes(e.code)) throw err;
    return `update_ai_settings: ${e.message}`;
  }
}

/** The table and the entry's component; null when Lightroom did not answer the read in time. */
async function look(ctx: SessionContext, s: Session, job: AiJob): Promise<{ sdk: SdkSettings; m: Record<string, unknown> | null } | null> {
  try {
    const { sdk } = await readSdk(ctx, s, job.t);
    return { sdk, m: firstComponent(readTable(sdk), job.id) };
  } catch (err) {
    if (toToolError(err).code === "BRIDGE_TIMEOUT") return null;
    throw err;
  }
}

/** probe_write_gate; null when the plugin lacks it or did not answer. */
async function probe(ctx: SessionContext): Promise<CommandResult<"probe_write_gate"> | null> {
  try {
    return await ctx.deps.client.request("probe_write_gate", {}, { timeoutMs: 5000 });
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

type Watch = { dialogAt: number | null; freeAt: number | null; probed: number };

/** What a probe says about this update: an Update to return, or null to read on (`w` updated). */
function judge(p: CommandResult<"probe_write_gate"> | null, job: AiJob, w: Watch, now: number): Update | null {
  const own = p?.update && (p.update.uuid === undefined || p.update.uuid === job.t.uuid) ? p.update : null;
  if (own?.state === "failed") return { kind: "failed", why: `updateAISettings raised in Lightroom: ${own.error ?? "no message"}`, fallback: true };
  if (own?.state === "abandoned") return { kind: "failed", why: "Lightroom's catalog stayed busy, so Lightroom dropped the update", fallback: true };
  if (p?.status === "aborted") w.dialogAt ??= now;
  else if (p?.status === "executed" && w.dialogAt !== null) w.freeAt = now;
  return null;
}

async function watch(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings, t0: number, note: string | undefined): Promise<Update> {
  const w: Watch = { dialogAt: null, freeAt: null, probed: 0 };
  const dialogMs = (): number => (w.dialogAt === null ? 0 : Math.round(performance.now() - w.dialogAt));
  for (let wait = T.pollMs; ; wait = Math.min(wait * 2, T.pollMaxMs)) {
    checkAbort(s);
    const seen = await look(ctx, s, job);
    if (seen && !seen.m) return { kind: "failed", why: "the mask's entry is no longer in the table (removed in Lightroom?)", fallback: false };
    const reason = seen?.m ? aiError(seen.m) : null;
    if (reason !== null) return { kind: "not_found", reason };
    if (seen?.m && computed(seen.m)) {
      if (w.dialogAt !== null) tell(ctx, s, note ?? "Lightroom finished the mask.");
      return { kind: "computed", sdk: seen.sdk, update_ms: 0, computed_ms: ms(t0), ...(w.dialogAt !== null ? { dialog_ms: dialogMs() } : {}) };
    }
    const now = performance.now();
    if (w.freeAt !== null && now - w.freeAt >= T.graceMs) return { kind: "dialog", why: "Lightroom was free again and the mask had not computed", dialog_ms: dialogMs() };
    if (w.dialogAt !== null && now - w.dialogAt >= T.dialogWaitMs) return { kind: "dialog", why: `Lightroom was still busy after ${Math.round(T.dialogWaitMs / 60_000)} minutes`, dialog_ms: dialogMs() };
    if (w.dialogAt === null && now - t0 >= T.computeMs) return { kind: "failed", why: `the mask did not compute within ${Math.round(now - t0)} ms of update_ai_settings`, fallback: false };
    if (now - t0 >= T.dialogAfterMs && w.freeAt === null && now - w.probed >= T.probeEveryMs) {
      w.probed = now;
      const seenDialog = w.dialogAt !== null;
      const out = judge(await probe(ctx), job, w, now);
      if (out) return out;
      if (!seenDialog && w.dialogAt !== null) tell(ctx, s, DIALOG_NOTE);
    }
    await sleep(wait);
  }
}

/**
 * Ask Lightroom to compute the entry `job.id` and wait for its answer (Update). s.aiPending is set
 * meanwhile; it stays set only after a dialog, for the caller's put-back to clear.
 */
export async function updateAndWait(ctx: SessionContext, s: Session, job: AiJob): Promise<Update> {
  const T = aiTimings(ctx);
  const t0 = performance.now();
  const note = s.work?.note;
  s.aiPending = { since: ctx.now().toISOString(), kind: job.kind };
  let out: Update | null = null;
  try {
    const failed = await send(ctx, s, job, T);
    const sent = ms(t0);
    out = failed !== null ? { kind: "failed", why: failed, fallback: true } : await watch(ctx, s, job, T, t0, note);
    if (out.kind === "computed") out.update_ms = sent;
    return out;
  } finally {
    if (out?.kind !== "dialog") s.aiPending = null;
  }
}

/** The error for a write, export or render while an AI update is pending (io.ts). */
export function pendingError(s: Session): ToolError {
  const p = s.aiPending;
  return new ToolError(
    "AI_UPDATE_PENDING",
    `Lightroom has not finished the AI ${p?.kind ?? ""} mask asked for at ${p?.since ?? "?"}, and may show a dialog: the user clicks OK in Lightroom if it does. Nothing more is written or rendered in session ${s.id} until then; lr_end_session with outcome "revert" puts the photo back.`,
    true,
    { session_id: s.id },
  );
}
