// The AI mask wait's timings (ai-update.ts), moved out of it in issue #181 (module size, rule 01). A leaf file on
// purpose: arch-check fails any new import cycle, and the files that read these (types.ts, ai-guard.ts) are
// reached from ai-update.ts, so this one imports nothing of the session.

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
  /** After a probe reads the update over and the gate free, how long a result may take to show: a read this long after with none is a failure (ai-update.ts header). */
  settleMs: number;
  /** From dialogAfterMs on, the HUD's note shows the time waited, changed at most this often (issue #181). */
  noteEveryMs: number;
  /** LrDevelopController's mask: how long it may take to show and compute (ai-masks.ts). */
  dcWaitMs: number;
  /** An abandon's clear_pending_ai: a hard deadline, not extended while the plugin is paused (ai-guard.ts; Greptile, PR #134). */
  clearMs: number;
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
  settleMs: 2000,
  noteEveryMs: 1000,
  dcWaitMs: 10_000,
  clearMs: 5000,
};
/** `ctx`: a SessionContext, written structurally so that this file imports nothing. */
export const aiTimings = (ctx: { deps: { aiTimings?: Partial<AiTimings> } }): AiTimings => ({ ...AI_TIMINGS, ...ctx.deps.aiTimings });
