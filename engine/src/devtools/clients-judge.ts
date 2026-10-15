// What one client run of the clients check did (issue #155 R6), from the tool log its engine wrote and
// the session log its lr_begin_session record names in `log_path` [handle: engine\src\devtools\
// phase5-chat-eval.ts header, the same records]. Pure functions, so tests\clients-check.test.ts can feed
// them records.
// Only finished calls count: a record with `ok`. A pending line (issue #155 R3, log\tool-log.ts
// ToolLogPendingRecord: `pending`, no `ok`) is counted on its own and never taken for a begin or a pass.

import { z } from "zod";
import { sessionLogSchema, type ClientIdentity, type SessionLogData } from "../log/index.js";
import { displayModel, displayName } from "../session/index.js";

const finishedSchema = z.looseObject({
  ts: z.string(),
  tool: z.string(),
  ok: z.boolean(),
  session_id: z.string().optional(),
  args: z.looseObject({ session_id: z.string().optional() }).optional(),
  client: z.looseObject({ name: z.string(), version: z.string().optional() }).optional(),
});
type Finished = z.infer<typeof finishedSchema>;
const pendingSchema = z.looseObject({ ts: z.string(), tool: z.string(), pending: z.string() });
const beginSchema = finishedSchema.extend({ ok: z.literal(true), session_id: z.string(), log_path: z.string() });
const endSchema = finishedSchema.extend({ ok: z.literal(true), session_id: z.string(), outcome: z.string() });

export type RunJudgement = {
  /** A successful lr_begin_session after `since`. */
  begun: boolean;
  session_id: string | null;
  log_path: string | null;
  /** The client named on the begin record (mcp\call-context.ts callLogFields). */
  client_logged: string | null;
  /** Successful lr_step calls of that session. */
  passes: number;
  /** lr_end_session's outcome for that session, or null. */
  ended: string | null;
  /** Pending lines (no `ok`), counted apart. */
  pending_lines: number;
  /** Lines that are neither a finished call nor a pending line. */
  invalid: number;
  calls: number;
};

/** The records at or after `sinceMs`, split into finished calls and pending lines. */
export function splitRecords(raw: readonly unknown[], sinceMs: number): { finished: Finished[]; pending: number; invalid: number } {
  const finished: Finished[] = [];
  let pending = 0;
  let invalid = 0;
  for (const r of raw) {
    const f = finishedSchema.safeParse(r);
    const p = f.success ? null : pendingSchema.safeParse(r);
    const ts = f.success ? f.data.ts : p?.success ? p.data.ts : null;
    if (ts === null) invalid++;
    else if (Date.parse(ts) < sinceMs) continue;
    else if (f.success) finished.push(f.data);
    else pending++;
  }
  return { finished, pending, invalid };
}

/** The run's first session begun after `sinceMs`: its passes and how it ended. */
export function judgeRun(raw: readonly unknown[], sinceMs: number): RunJudgement {
  const { finished, pending, invalid } = splitRecords(raw, sinceMs);
  const begin = finished.map((r) => beginSchema.safeParse(r)).find((p) => p.success)?.data;
  const sid = begin?.session_id;
  const mine = (r: Finished): boolean => sid !== undefined && (r.session_id === sid || r.args?.session_id === sid);
  const end = finished.map((r) => (r.tool === "lr_end_session" ? endSchema.safeParse(r) : null)).find((p) => p?.success && p.data.session_id === sid)?.data;
  return {
    begun: begin !== undefined,
    session_id: sid ?? null,
    log_path: begin?.log_path ?? null,
    client_logged: begin?.client?.name ?? null,
    passes: finished.filter((r) => r.tool === "lr_step" && r.ok && mine(r)).length,
    ended: end?.outcome ?? null,
    pending_lines: pending,
    invalid,
    calls: finished.length,
  };
}

/** T7's trigger: a successful lr_begin_session and one successful lr_step after `sinceMs`. */
export function begunAndStepped(raw: readonly unknown[], sinceMs: number): boolean {
  const j = judgeRun(raw, sinceMs);
  return j.begun && j.passes >= 1;
}

/** A session log's text, checked; null with the reason when it does not validate. */
export function parseSessionLog(text: string): { log: SessionLogData | null; error: string | null } {
  try {
    const parsed = sessionLogSchema.safeParse(JSON.parse(text));
    return parsed.success ? { log: parsed.data, error: null } : { log: null, error: `the session log does not validate: ${parsed.error.message}` };
  } catch (err) {
    return { log: null, error: `the session log is not JSON: ${(err as Error).message}` };
  }
}

export type SessionFacts = {
  client: ClientIdentity | null;
  model: string | null;
  /** What the Deck should show: "name · model" (U+00B7), or the name alone without a model. */
  deck_line: string;
  outcome: string | null;
  ended_by: string | null;
  approvals_by_hud: number;
  passes: number;
};

export function sessionFacts(log: SessionLogData | null): SessionFacts {
  const client = log?.client ?? null;
  const model = displayModel(log?.model);
  return {
    client,
    model: log?.model ?? null,
    deck_line: model ? `${displayName(client)} · ${model}` : displayName(client),
    outcome: log?.outcome ?? null,
    ended_by: log?.ended_by?.source ?? null,
    approvals_by_hud: (log?.approvals ?? []).filter((a) => a.by === "hud").length,
    passes: log?.passes.length ?? 0,
  };
}

/** T2's log side: the client and the model are both in the session log. */
export const identityLogged = (f: SessionFacts): boolean => f.client !== null && f.model !== null;
/** T4's log side: at least one pass and the session ended. */
export const editDone = (j: RunJudgement): boolean => j.begun && j.passes >= 1 && j.ended !== null;
/** T6's log side: a pass approved on the Deck, and a pass after it. */
export const approvedOnDeck = (j: RunJudgement, f: SessionFacts): boolean => j.begun && f.approvals_by_hud >= 1 && j.passes >= 2;
/** T7's log side: the session the killed client left open was reverted by a later engine. */
export const recovered = (first: SessionFacts): boolean => first.ended_by === "recovery" && first.outcome === "revert";
