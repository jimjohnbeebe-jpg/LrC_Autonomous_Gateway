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
//     so (DIALOG_NOTE). From then on the HUD's note shows the time waited, once a second (tick, issue #181).
//     The photo is put back (ai-revert.ts autoRevert) [stated: Jim, 2026-10-03, "Also auto-revert"] only when
//     Lightroom reports the update failed after a busy gate, or dropped it (abandoned): then nothing computes
//     [inference]. D13's put-backs 60 s after the gate was free again and after 5 minutes are gone: they could
//     write under a running computation (D16);
//   - no result within COMPUTE_MS, or gate probes unanswered for STUCK_PROBES_MS: LIGHTROOM_STUCK, nothing
//     written, the session open with aiPending kept (`stuck`). Each later write, render and revert reads the table
//     first (settlePending): a result that came meanwhile lets the session go on. Otherwise the session ends only by
//     the user's Abort or lr_end_session "abandon" (abandon.ts: nothing written, the photo NOT put back), or by a
//     Lightroom restart, after which the engine puts the photo back (restart.ts). Jim kept D16 here [stated: Jim,
//     2026-10-18, "Keep D16 (Recommended)"; docs\reports\phase9\issue181.md "Decisions for Jim" 1]: a "done" record
//     without a digest frees nothing, as capture 5's row E (above) is the evidence against writing then. In the
//     2026-10-18 session Lightroom's update was still "running" when the wait ended at 5 minutes [handle:
//     logs\20261018-441ee2.json:1360-1368, 1573-1581; the 40 probes kept all read "aborted" with the update
//     "running"], and the Abort (an abandon) ended the session without a restart [stated: Jim, 2026-10-18, GitHub issue #181];
//   - a probe that reads the gate free with the update "done", then a read SETTLE_MS (2 s) or more after it
//     with neither a digest nor an ErrorReason: Lightroom's computation failed, AI_MASK_FAILED (issue #123). On
//     2026-10-10 Lightroom's update was over with no result after an NVIDIA driver error, and the engine read on
//     for 150 s before Lightroom crashed; where Lightroom had a result, it showed 0.02-0.5 s after "done"
//     [handle: docs\reports\phase8.5\ai-vegetation.md "Analysis (Claude Code)"]. The 2 s, and that the engine then stops
//     reading and writes nothing, the user asked to save their work and restart Lightroom, are Jim's [stated:
//     Jim, 2026-10-11, "Go with recommendations"]. aiPending stays (`stuck`, `failed`): restart.ts puts the
//     photo back after the restart; later calls are refused without reading (settlePending);
//   - a failed update with the gate never seen busy is a plugin error, after which the LrDevelopController
//     route may run (the lead's review of efffd2e, 2026-10-03);
//   - the reads name the photo by uuid (photo_uuid), so a change of selection does not end the wait;
//   - what the wait saw (the update's answer, each probe, the reads summed up) is kept as s.aiTrace and goes
//     on the log's failure entry when the wait ends without a result (io.ts failed): the 2026-10-11 hang
//     left no record of what the probes answered (issue #123) [handle: repo logs\20261010-45ea50.json].
// Every read checks the user's Abort first, so an Abort ends the wait at the next read, within a poll (POLL_MS up to 1 s) and the
// read or probe in flight [inference: from watch below]: the call fails with SESSION_ENDED (io.ts abortError), aiPending stays,
// and the Abort's revert goes ahead if the result has shown, else it abandons the edit (hud-actions.ts finishAbort) [stated: Jim,
// 2026-10-18, "Abort ends the wait now"; docs\reports\phase9\issue181.md "Decisions for Jim" 2]. [handle: tests\session-ai-dialog.test.ts,
// tests\session-ai-restart.test.ts, tests\session-ai-stuck.test.ts, tests\session-ai-abort-wait.test.ts, against the Lightroom sim. In Lightroom,
// capture 4 saw updates compute and ErrorReason answers without a dialog (capture4-check.json); the rest is
// [unverified] until capture 6 and Jim's run of issue #181.]

import { randomUUID } from "node:crypto";
import type { AiTrace } from "../log/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiError, aiWatch, computed } from "../params/index.js";
import type { AiJob } from "./ai-masks.js";
import { look, ownUpdate, probe } from "./ai-reads.js";
import { aiTimings, type AiTimings } from "./ai-timings.js";
import { newTrace, noteProbe, noteRead } from "./ai-trace.js";
import { ABANDONED, decide, elapsedNote, judge, type Update, type Watch } from "./ai-verdict.js";
import { bridge, checkAbort, ms } from "./io.js";
import type { AiPending, Session, SessionContext } from "./types.js";

// types.ts and the callers import the timings' type from here: the edge was theirs before the timings moved to ai-timings.ts,
// and the import cycles arch-check allows (the baseline) are those with this file in them.
export type { AiTimings } from "./ai-timings.js";

/** True for a dialog and for a slow model alike: both hold the write gate (the header's [inference]). */
export const DIALOG_NOTE = "Lightroom is busy or shows a dialog: if a dialog is open in Lightroom, click OK.";
export const WORKING_NOTE = "Lightroom is computing the AI mask; this can take a few minutes.";
/** WORKING_NOTE once the wait is long (tick): with the time waited it shows the HUD is not frozen (issue #181). */
export const STILL_NOTE = "Lightroom's AI mask is still computing";

const sleep = (t: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, t));
const STOPS = ["BRIDGE_DISCONNECTED", "TARGET_CHANGED", "SESSION_ENDED"];

/** update_ai_settings; null once it is under way (or may be: no answer in time), else what ended it. */
async function send(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings, token: string, trace: AiTrace): Promise<Update | null> {
  try {
    const res = await bridge(s, job.t, () => ctx.deps.client.request("update_ai_settings", { photo_uuid: job.t.uuid, request_id: token, watch: aiWatch([job.id]) }, { timeoutMs: T.replyMs }));
    trace.sent = res.state ?? res.status ?? "answered";
    if (res.state === "abandoned") return { kind: "dialog", why: ABANDONED, dialog_ms: 0 };
    return res.state === "failed" ? { kind: "failed", why: "update_ai_settings: the update failed", fallback: true } : null;
  } catch (err) {
    const e = toToolError(err);
    trace.sent = e.code === "BRIDGE_TIMEOUT" ? "no answer" : e.code;
    if (e.code === "BRIDGE_TIMEOUT") return null; // a dialog may hold the answer too (Masks.lua): watch the table
    if (STOPS.includes(e.code)) throw err;
    return { kind: "failed", why: `update_ai_settings: ${e.message}`, fallback: true };
  }
}

/** The user, told on the HUD; the note stays while the operation runs. */
function tell(ctx: SessionContext, s: Session, note: string): void {
  if (s.work) s.work.note = note;
  ctx.deps.hud?.stage(s, "applying");
}

/** From dialogAfterMs on, the HUD's note shows the time waited ("m:ss"), changed at most every noteEveryMs (issue #181). */
function tick(ctx: SessionContext, s: Session, w: Watch, T: AiTimings, t0: number, now: number): void {
  if (now - t0 < T.dialogAfterMs || now - w.toldAt < T.noteEveryMs) return;
  w.toldAt = now;
  tell(ctx, s, elapsedNote(w.dialogAt === null ? STILL_NOTE : DIALOG_NOTE, now - t0));
}

async function watch(ctx: SessionContext, s: Session, job: AiJob, T: AiTimings, t0: number, note: string | undefined, token: string, trace: AiTrace): Promise<Update> {
  const w: Watch = { dialogAt: null, probed: 0, settledAt: null, state: null, answered: t0, toldAt: t0 };
  for (let wait = T.pollMs; ; wait = Math.min(wait * 2, T.pollMaxMs)) {
    checkAbort(s);
    const r0 = performance.now();
    const seen = await look(ctx, job).catch((err: unknown) => {
      noteRead(trace, null, t0, r0, toToolError(err).code); // the last read before a dropped bridge counts too (Greptile, PR #132)
      throw err;
    });
    noteRead(trace, seen, t0, r0);
    if (seen && !seen.m) return { kind: "failed", why: "the mask's entry is no longer in the table (removed in Lightroom?)", fallback: false };
    const reason = seen?.m ? aiError(seen.m) : null;
    if (reason !== null) return { kind: "not_found", reason };
    const now = performance.now();
    if (seen?.m && computed(seen.m)) {
      tell(ctx, s, note ?? "Lightroom finished the mask.");
      return { kind: "computed", sdk: seen.sdk, update_ms: 0, computed_ms: ms(t0), ...(w.dialogAt !== null ? { dialog_ms: Math.round(now - w.dialogAt) } : {}) };
    }
    const out = decide(w, T, t0, now, seen !== null);
    if (out) return out;
    if (now - t0 >= T.dialogAfterMs && w.settledAt === null && now - w.probed >= T.probeEveryMs) {
      w.probed = now;
      const seenDialog = w.dialogAt !== null;
      const p = await probe(ctx, T).catch((err: unknown) => {
        noteProbe(trace, null, null, t0, toToolError(err).code);
        throw err;
      });
      noteProbe(trace, p, ownUpdate(p, job, token), t0);
      const judged = judge(p, job, w, now, token);
      if (judged) return judged;
      if (!seenDialog && w.dialogAt !== null) {
        w.toldAt = now;
        tell(ctx, s, DIALOG_NOTE);
      }
    }
    tick(ctx, s, w, T, t0, now);
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
  const token = randomUUID();
  s.aiPending = { since: ctx.now().toISOString(), kind: job.kind, job, process: hello.process_started_at ?? null, stuck: false };
  const trace = newTrace(job.kind);
  s.aiTrace = trace;
  let out: Update | null = null;
  try {
    const ended = await send(ctx, s, job, T, token, trace);
    const sent = ms(t0);
    if (!ended) tell(ctx, s, WORKING_NOTE);
    out = ended ?? (await watch(ctx, s, job, T, t0, note, token, trace));
    if (out.kind === "computed") out.update_ms = sent;
    return out;
  } finally {
    if (out?.kind === "computed") s.aiTrace = null; // a result: nothing to explain
    if (out?.kind === "computed" || out?.kind === "not_found" || out?.kind === "failed") s.aiPending = null;
    else if (out?.kind === "stuck" && s.aiPending) {
      s.aiPending.stuck = true;
      if (out.failed) s.aiPending.failed = true;
    }
  }
}

/** The way out without a restart (abandon.ts, issue #124), named in every error that leaves the session stuck. */
export const ABANDON_HINT = ' If the user would rather stop now without a restart, lr_end_session "abandon" ends the session and leaves the photo as it is.';

/** How the user puts the photo back by hand once an edit was left as it is (abandon.ts): the pre-session snapshot, in Develop. */
export const putBackByHand = (snapshot: string): string => `To put it back, the user selects it in Develop and clicks the snapshot "${snapshot}" in the Snapshots panel.`;

/**
 * What Claude is told while an AI mask has no result (issue #181): the session goes on once Lightroom's result shows, but only
 * a call checks (nothing notifies), and not the same AI mask again; Abort in the Deck puts the photo back if the result has
 * shown, else ends the edit as it is (abandon.ts) and names the snapshot. Only that, an abandon or a restart end it otherwise (D16).
 */
export const waitAdvice = (s: Session): string =>
  ` The session goes on when Lightroom's result shows: each call checks, and nothing else frees it. ` +
  `Lightroom does not notify you: when the user says to go on, call lr_step, lr_end_session or lr_create_mask with a linear or radial kind to check, and not the same AI mask again (it would add a second one). ` +
  `Tell the user to wait, or to press Abort in the Deck: it puts the photo back as it was before the session if Lightroom's result has shown, and otherwise ends the edit as it is, the photo NOT put back, and names the snapshot "${s.snapshot.name}" that puts it back.`;

/** What a restart does (restart.ts), as the other way out, and what to do with AI masks meanwhile. */
export const restartAdvice = (id: string): string =>
  ` Restarting Lightroom (File > Exit, then start it again) also ends the wait: once it is back, the engine notices the restart, puts the photo back as it was before the session (checked) and ends session ${id} by itself; nothing to call.` +
  ` For the rest of the session prefer linear or radial masks to AI masks.`;

/** The error for a write, export, render or revert while an AI update has no result (io.ts settlePending). */
export function pendingError(s: Session): ToolError {
  const p = s.aiPending;
  const restart = `the user restarts Lightroom (File > Exit, then start it again); once it is back, the engine puts the photo back as it was before the session by itself and ends session ${s.id}`;
  const message = p?.failed
    ? `Lightroom's AI ${p.kind} mask computation failed (asked for at ${p.since}): nothing more is read, written, rendered or reverted in session ${s.id} while Lightroom may be unstable. Tell the user: save your work, then ${restart}.`
    : p?.stuck
    ? `Lightroom's AI ${p.kind} mask is still computing (asked for at ${p.since}): nothing more is written, rendered or reverted in session ${s.id}, so nothing is written under it.${waitAdvice(s)}${restartAdvice(s.id)}`
    : `Lightroom has not finished the AI ${p?.kind ?? ""} mask asked for at ${p?.since ?? "?"}: nothing more is written, rendered or reverted in session ${s.id} until its result shows (each call checks again). If it seems stuck, ${restart}.`;
  return new ToolError("AI_UPDATE_PENDING", p?.stuck ? message + ABANDON_HINT : message, !p?.stuck, { session_id: s.id, stuck: p?.stuck ?? false });
}

/** Whether the entry of `p` shows Lightroom's answer: its digest or an ErrorReason, or the entry is gone. */
async function answered(ctx: SessionContext, p: AiPending): Promise<boolean> {
  const seen = await look(ctx, p.job).catch(() => null);
  return seen !== null && (!seen.m || computed(seen.m) || aiError(seen.m) !== null);
}

/**
 * Before a write, export or render (io.ts) and a revert (end.ts): refused (AI_UPDATE_PENDING) while the AI
 * update has no result. A read that shows the entry's digest or ErrorReason, or the entry gone, clears
 * s.aiPending first; a read Lightroom does not answer leaves it set, and so does a "done" record with no digest (D16,
 * kept for issue #181). After AI_MASK_FAILED nothing is read: only a restart ends it (or an abandon).
 */
export async function settlePending(ctx: SessionContext, s: Session): Promise<void> {
  const p = s.aiPending;
  if (!p) return;
  if (p.failed || !(await answered(ctx, p))) throw pendingError(s);
  s.aiPending = null;
}
