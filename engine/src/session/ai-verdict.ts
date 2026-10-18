// What the wait for an AI mask (ai-update.ts) makes of its probes and reads: the verdicts (Update), what a probe says
// about the update (judge) and when the wait is over without a result (decide), and the time shown on the HUD (clock).
// Moved out of ai-update.ts in issue #181 (module size, rule 01). A leaf file on purpose: arch-check fails any new import
// cycle, so the job is written structurally and nothing of the session is imported.

import type { CommandResult } from "../bridge/index.js";
import type { SdkSettings } from "../params/index.js";
import { ownUpdate, type JobRef } from "./ai-reads.js";
import type { AiTimings } from "./ai-timings.js";

export type Update =
  | { kind: "computed"; sdk: SdkSettings; update_ms: number; computed_ms: number; dialog_ms?: number }
  | { kind: "not_found"; reason: number }
  | { kind: "failed"; why: string; fallback: boolean }
  /** Lightroom reported the update failed after a busy gate, or dropped it: put the photo back (nothing computes). */
  | { kind: "dialog"; why: string; dialog_ms: number }
  /** No result in time, or Lightroom not answering: nothing is written, aiPending stays (stuck). `failed`: the update was over with no result (AI_MASK_FAILED). */
  | { kind: "stuck"; why: string; dialog_ms: number; failed?: true };

export const ABANDONED = "Lightroom's catalog stayed busy, so Lightroom dropped the update";

/** "m:ss" of a time in ms (the minutes are not capped: 75 minutes read "75:00"). */
export const clock = (t: number): string => `${Math.floor(t / 60_000)}:${String(Math.floor(t / 1000) % 60).padStart(2, "0")}`;
/** `note` with the time waited, as the HUD's note (issue #181); the notes it is used with are well under HUD_LIMITS.text, 120 bytes. */
export const elapsedNote = (note: string, t: number): string => `${note} (${clock(t)})`;

/** What the probes said so far. `settledAt`: when a probe read the update over and the gate free; no more probes after it. `toldAt`: when the HUD's note last changed. */
export type Watch = { dialogAt: number | null; probed: number; settledAt: number | null; state: string | null; answered: number; toldAt: number };

/** What a probe says about this update: an Update to return, or null to read on (`w` updated). */
export function judge(p: CommandResult<"probe_write_gate"> | null, job: JobRef, w: Watch, now: number, token: string): Update | null {
  if (p) w.answered = now;
  const own = ownUpdate(p, job, token);
  if (own) w.state = own.state;
  const dms = w.dialogAt === null ? 0 : Math.round(now - w.dialogAt);
  if (own?.state === "abandoned") return { kind: "dialog", why: ABANDONED, dialog_ms: dms };
  if (own?.state === "failed") return w.dialogAt === null ? { kind: "failed", why: `updateAISettings raised in Lightroom: ${own.error ?? "no message"}`, fallback: true } : { kind: "dialog", why: `Lightroom reported the update failed: ${own.error ?? "no message"}`, dialog_ms: dms };
  if (p?.status === "aborted") w.dialogAt ??= now;
  else if (p?.status === "executed" && own?.state === "done") w.settledAt ??= now;
  return null;
}

/**
 * Whether the wait is over without a result: the update over with none after settleMs (`answered`: this read
 * showed the entry), no answer to the probes, or no result within computeMs. Nothing is written either way.
 */
export function decide(w: Watch, T: AiTimings, t0: number, now: number, answered: boolean): Update | null {
  const dms = w.dialogAt === null ? 0 : Math.round(now - w.dialogAt);
  if (answered && w.settledAt !== null && now - w.settledAt >= T.settleMs) {
    return { kind: "stuck", failed: true, why: `Lightroom reported the update over with its catalog free, and no result showed ${((now - w.settledAt) / 1000).toFixed(1)} s later`, dialog_ms: dms };
  }
  if (w.probed > 0 && w.settledAt === null && now - Math.max(w.answered, t0 + T.dialogAfterMs) >= T.stuckProbesMs) return { kind: "stuck", why: `Lightroom did not answer the gate probes for ${Math.round((now - w.answered) / 1000)} s`, dialog_ms: dms };
  if (now - t0 < T.computeMs) return null;
  return { kind: "stuck", why: `no result within ${Math.round(T.computeMs / 60_000)} minutes${w.state ? `, Lightroom's update ${w.state}` : ""}`, dialog_ms: dms };
}
