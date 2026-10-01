// What a Claude Desktop chat of the Phase 5 check did, from the tool log Claude Desktop's engine
// wrote (phase2-collect.ts) and the session log its lr_begin_session record names in `log_path`
// [handle: engine\src\session\begin.ts runPass0, the begin's log record; read the same way by
// phase3-chat.ts and phase4-chat.ts]. Pure functions, so tests\phase5-chat-eval.test.ts can feed them
// records.
//   - The golden-hour chats (AC-1, PRD section 10): a session on the chat's photo with the golden-hour
//     intent, 1-4 passes, accepted, the HUD shown for it (the tool log's first-taken hud_update record
//     [handle: engine\src\hud\publisher.ts send(), `record` when `ch.taken === null && payload.open`]),
//     autonomous mode, and this engine's version (Claude Desktop runs the repo's engine\dist [handle:
//     engine\src\devtools\desktop-config.ts, the lrc-avg entry's args]).
//   - The approve chat (decision D4): a session in approve_each_pass mode where a waiting lr_step ran
//     its full wait (AWAITING_APPROVAL in the tool log, with how long the call held), and a later pass
//     after the HUD's Approve. How long Claude Desktop keeps a tool call is [unverified] until then.

import { existsSync, readFileSync } from "node:fs";
import { sessionLogSchema, type SessionLogData } from "../log/index.js";
import { APPROVAL_WAIT_MS } from "../session/index.js";
import { clipCheckFile, type SessionClip } from "./clip-check.js";
import { INTENT } from "./phase5-config.js";

type Rec = Record<string, unknown>;

export type ChatEvaluation = {
  tool_calls: Array<{ ts: unknown; tool: unknown; ok: unknown; error_code?: unknown }>;
  session_begun: boolean;
  session_id: string | null;
  intent_id: string | null;
  target_filename: string | null;
  passes: number;
  session_ended: string | null;
  snapshot: { id: string; name: string } | null;
  log_path: string | null;
  hud_shown: boolean;
  /** lr_step calls that came back AWAITING_APPROVAL: how long the call held, and the wait inside it. */
  awaiting: Array<{ duration_ms: number; waited_ms: number | null }>;
};

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** A record of session `sid`: by its own field, its arguments (a failed call logs no result), or its error's details. */
const ofSession = (sid: unknown) => (r: Rec): boolean =>
  sid !== undefined &&
  (r["session_id"] === sid || (r["args"] as Rec | undefined)?.["session_id"] === sid || (r["error"] as { details?: { session_id?: unknown } } | undefined)?.details?.session_id === sid);

/** The chat's session: the one that ended with accept, else the last one begun. */
export function evaluateChat(records: readonly Rec[]): ChatEvaluation {
  const tool_calls = records.filter((r) => r["tool"] !== "hud_update" && r["tool"] !== "hud_event").map((r) => ({ ts: r["ts"], tool: r["tool"], ok: r["ok"], ...(r["error"] ? { error_code: (r["error"] as { code?: unknown }).code } : {}) }));
  const begins = records.filter((r) => r["tool"] === "lr_begin_session" && r["ok"] === true);
  const ended = (sid: unknown, outcome?: string) => (r: Rec): boolean => r["tool"] === "lr_end_session" && r["ok"] === true && r["session_id"] === sid && (outcome === undefined || r["outcome"] === outcome);
  const begin = begins.find((b) => records.some(ended(b["session_id"], "accept"))) ?? begins.at(-1);
  const sid = begin?.["session_id"];
  const mine = records.filter(ofSession(sid));
  const steps = mine.filter((r) => r["tool"] === "lr_step" && r["ok"] === true);
  const awaiting = mine
    .filter((r) => r["tool"] === "lr_step" && r["ok"] === false && (r["error"] as { code?: unknown } | undefined)?.code === "AWAITING_APPROVAL")
    .map((r) => {
      const waited = (r["error"] as { details?: { waited_ms?: unknown } }).details?.waited_ms;
      return { duration_ms: Number(r["duration_ms"] ?? 0), waited_ms: typeof waited === "number" ? waited : null };
    });
  const end = begin ? records.find(ended(sid)) : undefined;
  const snap = begin?.["snapshot"] as { id?: unknown; name?: unknown } | undefined;
  const hud = mine.filter((r) => r["tool"] === "hud_update");
  return {
    tool_calls,
    session_begun: begin !== undefined,
    session_id: text(sid),
    intent_id: text(begin?.["intent_id"]),
    target_filename: text((begin?.["target"] as Rec | undefined)?.["filename"]),
    passes: steps.length,
    session_ended: text(end?.["outcome"]),
    snapshot: typeof snap?.id === "string" ? { id: snap.id, name: String(snap.name ?? "") } : null,
    log_path: text(begin?.["log_path"]),
    hud_shown: hud.some((r) => r["ok"] === true && (r["result"] as { shown?: unknown } | undefined)?.shown === true),
    awaiting,
  };
}

/** The chat session's own log (its engine version, mode and approvals), or why it could not be read. */
export function chatSessionLog(e: ChatEvaluation): { log: SessionLogData | null; error: string | null } {
  if (!e.log_path) return { log: null, error: e.session_begun ? "the chat's lr_begin_session record names no log_path" : "no session began" };
  if (!existsSync(e.log_path)) return { log: null, error: `the session log ${e.log_path} is not there` };
  const parsed = sessionLogSchema.safeParse(JSON.parse(readFileSync(e.log_path, "utf8")));
  return parsed.success ? { log: parsed.data, error: null } : { log: null, error: `the session log does not validate: ${parsed.error.message}` };
}

/** The chat session's AC-4 (clip-check.ts), or null when no session began. */
export function chatClip(e: ChatEvaluation, name: string): SessionClip | null {
  if (!e.session_begun) return null;
  return e.log_path ? clipCheckFile(name, e.log_path) : { session: name, log_path: "", ok: false, passes: [], error: "the chat's lr_begin_session record names no log_path" };
}

/** Why a golden-hour chat on `fixture` does not meet AC-1 as the logs show it; empty when it does. */
export function goldenChatProblems(e: ChatEvaluation, log: SessionLogData | null, fixture: string, engineVersion: string): string[] {
  const p: string[] = [];
  if (!e.session_begun) return ["no session began"];
  if (e.target_filename !== fixture) p.push(`the session was on ${String(e.target_filename)}, not ${fixture}`);
  if (e.intent_id !== INTENT) p.push(`the intent was ${String(e.intent_id)}, not ${INTENT}`);
  if (e.passes < 1 || e.passes > 4) p.push(`${e.passes} passes, not 1-4`);
  if (e.session_ended !== "accept") p.push(`the session ended as ${String(e.session_ended ?? "still open")}, not accept`);
  if (!e.hud_shown) p.push("the tool log shows no HUD update taken with the HUD open");
  if (!log) p.push("its session log could not be read");
  else {
    if (log.settings?.approval !== "autonomous") p.push(`the session ran in ${String(log.settings?.approval ?? "an unknown")} mode, not autonomous`);
    if (log.engine_version !== engineVersion) p.push(`Claude Desktop ran engine ${log.engine_version}, not ${engineVersion}: restart Claude Desktop`);
  }
  return p;
}

/** Why the approve chat did not show a full wait and a pass after the HUD's Approve; empty when it did. */
export function approveChatProblems(e: ChatEvaluation, log: SessionLogData | null, photo: string, waitMs: number = APPROVAL_WAIT_MS): string[] {
  const p: string[] = [];
  if (!e.session_begun) return ["no session began"];
  if (e.target_filename !== photo) p.push(`the session was on ${String(e.target_filename)}, not ${photo}`);
  if (!e.awaiting.some((a) => (a.waited_ms ?? 0) >= waitMs - 1000)) p.push(`no lr_step ran its full ${waitMs / 1000} s wait (AWAITING_APPROVAL)`);
  if (!log) p.push("its session log could not be read");
  else {
    if (log.settings?.approval !== "approve_each_pass") p.push(`the session ran in ${String(log.settings?.approval ?? "an unknown")} mode, not approve_each_pass`);
    if (!(log.approvals ?? []).some((a) => a.by === "hud")) p.push("no pass was approved in the HUD");
  }
  if (e.passes < 2) p.push(`${e.passes} pass(es): no pass followed an Approve`);
  if (e.session_ended !== "accept") p.push(`the session ended as ${String(e.session_ended ?? "still open")}, not accept`);
  return p;
}
