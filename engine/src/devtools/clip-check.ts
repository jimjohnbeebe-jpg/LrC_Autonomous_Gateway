// AC-4 (PRD section 10: no pass leaves clipping over the session's limits), counted on every
// session an acceptance check runs, not only the first one (PHASE4_PLAN decision 1; Phase 3's check
// counted session A only [handle: docs\reports\phase3\PHASE3.md "AC-4, what happened"]). Shared by
// the Phase 3 check and, from PHASE4_PLAN row 10, Phase 4's.

import { readFileSync } from "node:fs";
import { anySessionLogSchema, type AnySessionLog } from "../log/index.js";

/** `target` names a Variants session's copy (each counts its own passes); a master's pass has none. */
export type ClipPass = { n: number; target?: string; clip_high_pct: number; clip_low_pct: number; ok: boolean };
export type ClipResult = { ok: boolean; passes: ClipPass[] };
/** One session's AC-4: which session, its log, and why it could not be counted, if so. */
export type SessionClip = ClipResult & { session: string; log_path: string; error?: string };
export type ClipSummary = { ok: boolean; sessions: SessionClip[]; over: Array<{ session: string } & ClipPass> };

/**
 * AC-4 on every pass of a session log: clipping within the session's limits after the pass. A log
 * with no pass fails: nothing was measured (Greptile, PR #27). Such a log exists when pass 0 fails
 * [handle: engine\src\session\begin.ts runPass0 saves the log before pass 0 runs;
 * tests\session-begin.test.ts "keeps the session open when pass 0 fails after the snapshot ..."].
 */
export function clipCheck(log: Pick<AnySessionLog, "guardrails" | "passes">): ClipResult {
  const passes = log.passes.map((p) => {
    const m = p.metrics_after;
    const ok = m.clip_high_pct <= log.guardrails.clip_high_pct && m.clip_low_pct <= log.guardrails.clip_low_pct;
    return { n: p.n, ...(p.target && p.target !== "master" ? { target: p.target } : {}), clip_high_pct: m.clip_high_pct, clip_low_pct: m.clip_low_pct, ok };
  });
  return { ok: passes.length > 0 && passes.every((p) => p.ok), passes };
}

/**
 * AC-4 on one session's log file, of schema v2 or v1 (the Phase 3 run's logs). A log that cannot be
 * read or is not a valid session log fails.
 */
export function clipCheckFile(session: string, logPath: string): SessionClip {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(logPath, "utf8"));
  } catch (err) {
    return { session, log_path: logPath, ok: false, passes: [], error: `cannot read the session log: ${(err as Error).message}` };
  }
  const parsed = anySessionLogSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`);
    return { session, log_path: logPath, ok: false, passes: [], error: `not a valid session log (${issues.join("; ")})` };
  }
  return { session, log_path: logPath, ...clipCheck(parsed.data) };
}

/** AC-4 over several sessions: met when there is at least one and every one meets it. */
export function clipCheckAll(sessions: readonly SessionClip[]): ClipSummary {
  const over = sessions.flatMap((s) => s.passes.filter((p) => !p.ok).map((p) => ({ session: s.session, ...p })));
  return { ok: sessions.length > 0 && sessions.every((s) => s.ok), sessions: [...sessions], over };
}

/** One line for the check's window: "YES", or the sessions and passes over a limit. */
export function describeClip(summary: ClipSummary): string {
  if (summary.ok) return "YES";
  const reasons = [
    ...summary.over.map((p) => `session ${p.session} pass ${p.n}: ${p.clip_high_pct} % / ${p.clip_low_pct} %`),
    ...summary.sessions.filter((s) => s.error).map((s) => `session ${s.session}: ${s.error}`),
  ];
  return `NO (${reasons.join("; ") || "no session counted"})`;
}
