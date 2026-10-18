// What the wait for an AI mask saw, kept for the log's failure entry (AiTrace; issue #123), moved out of ai-update.ts in
// issue #181 (module size, rule 01). A leaf file on purpose (arch-check fails any new import cycle): the times are
// io.ts `ms` written out here, as io.ts reaches ai-update.ts.

import type { CommandResult } from "../bridge/index.js";
import type { AiTrace } from "../log/index.js";
import { aiError, computed } from "../params/index.js";
import type { UpdateRecord } from "./ai-reads.js";

const ms = (since: number): number => Math.round((performance.now() - since) * 10) / 10;

export const newTrace = (kind: string): AiTrace => ({ kind, sent: "not sent", probes: [], probes_dropped: 0, reads: { count: 0, unanswered: 0, slowest_ms: 0, last_t_ms: 0, last_entry: "none" } });
/**
 * The first KEEP probes and the last KEEP are kept, those between only counted (probes_dropped): a gate held for 5 minutes,
 * probed every 2 s, would log 150, and with only the first 40 the end of the run was not recorded (issue #181) [handle:
 * logs\20261018-441ee2.json:1368-1581, 40 kept, `probes_dropped` 74].
 */
const KEEP = 20;

/** One read of the wait, summed up in the trace: when it ended, how long it took, what the entry showed. */
export function noteRead(trace: AiTrace, seen: { m: Record<string, unknown> | null } | null, t0: number, r0: number, failure?: string): void {
  const r = trace.reads;
  r.count++;
  r.slowest_ms = Math.max(r.slowest_ms, ms(r0));
  r.last_t_ms = ms(t0);
  if (!seen) r.unanswered++;
  const reason = seen?.m ? aiError(seen.m) : null;
  r.last_entry = failure ?? (!seen ? "no answer" : !seen.m ? "gone" : reason !== null ? `ErrorReason ${reason}` : computed(seen.m) ? "computed" : "no result yet");
}

export function noteProbe(trace: AiTrace, p: CommandResult<"probe_write_gate"> | null, own: UpdateRecord | null, t0: number, failure?: string): void {
  if (trace.probes.length >= 2 * KEEP) {
    trace.probes.splice(KEEP, 1); // the oldest of the last KEEP
    trace.probes_dropped++;
  }
  trace.probes.push({ t_ms: ms(t0), status: failure ?? p?.status ?? "no answer", ...(own ? { update: own.state } : {}), ...(own?.error ? { error: own.error } : {}) });
}
