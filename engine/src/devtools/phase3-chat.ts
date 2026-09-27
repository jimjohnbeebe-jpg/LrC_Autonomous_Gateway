// Part 2 of the Phase 3 check (phase3-check.ts): AC-1's chat on one fixture (decision 2: one chat
// now; the HUD and the six-fixture chat part close in Phase 5). The engine's tool log shows the
// session; Jim answers y/n; then he puts the photo back with the session's snapshot.
// The chat's AC-4 (clip-check.ts, PHASE4_PLAN decision 1) reads the session log that the
// lr_begin_session record of the tool log names in `log_path` [handle: engine\src\session\begin.ts
// runPass0 puts `log_path` in the call's log record, engine\src\mcp\tools-shared.ts:163 appends it to the
// tool log; seen in docs\reports\phase3\P3\p3_chat_tool_log_2026-09-27T14-00-37-507Z.jsonl, the
// lr_begin_session record; tests\phase3-check.test.ts "counts AC-4 on the chat's session ..."].

import { clipCheckAll, clipCheckFile, describeClip, type SessionClip } from "./clip-check.js";
import { CHAT_FIXTURE, CHAT_PROMPT, INTENT_A, type Json, type Phase3Deps } from "./phase3-config.js";

/** What Part 2 found: the chat (AC-1), the photo put back, and the chat session's AC-4 (null when no session began). */
export type ChatOutcome = { ok: boolean; putBack: boolean; ac4: SessionClip | null };

type ChatEvaluation = {
  tool_calls: Array<{ ts: unknown; tool: unknown; ok: unknown; error_code?: unknown }>;
  session_begun: boolean;
  intent_id: string | null;
  passes: number;
  session_ended: string | null;
  snapshot_name: string | null;
  /** The photo the session edited (the begin record's target), to check it is the chat's fixture. */
  target_filename: string | null;
  /** The session's log (the begin record's log_path), for its AC-4. */
  log_path: string | null;
};

/** What the chat's tool log shows: a session on the golden-hour intent, 1-4 passes, accepted. */
export function evaluateChat(records: Array<Record<string, unknown>>): ChatEvaluation {
  const tool_calls = records.map((r) => ({
    ts: r["ts"],
    tool: r["tool"],
    ok: r["ok"],
    ...(r["error"] ? { error_code: (r["error"] as { code?: unknown }).code } : {}),
  }));
  const begin = records.find((r) => r["tool"] === "lr_begin_session" && r["ok"] === true);
  const sessionId = begin?.["session_id"];
  const steps = records.filter((r) => r["tool"] === "lr_step" && r["ok"] === true && r["session_id"] === sessionId);
  const end = records.find((r) => r["tool"] === "lr_end_session" && r["ok"] === true && r["session_id"] === sessionId);
  const snapshot = begin?.["snapshot"] as { name?: unknown } | undefined;
  const target = begin?.["target"] as { filename?: unknown } | undefined;
  const text = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    target_filename: text(target?.filename),
    tool_calls,
    session_begun: begin !== undefined,
    intent_id: text(begin?.["intent_id"]),
    passes: steps.length,
    session_ended: text(end?.["outcome"]),
    snapshot_name: text(snapshot?.name),
    log_path: text(begin?.["log_path"]),
  };
}

/** The chat session's AC-4, from the log its begin record names; null when no session began. */
export function chatClip(evaluation: ChatEvaluation): SessionClip | null {
  if (!evaluation.session_begun) return null;
  if (evaluation.log_path === null) return { session: "chat", log_path: "", ok: false, passes: [], error: "the chat's lr_begin_session record names no log_path" };
  return clipCheckFile("chat", evaluation.log_path);
}

/** Part 2: Jim runs the chat in Claude Desktop; the tool log and his answers say whether it worked. */
export async function runChat(deps: Phase3Deps, results: Json, errors: string[], now: () => Date): Promise<ChatOutcome> {
  const { ask, say } = deps;
  say("");
  say("Part 2: the chat in Claude Desktop.");
  say(`  1. In Lightroom's Filmstrip, click ${CHAT_FIXTURE} (stay in the Develop module).`);
  say("  2. Start Claude Desktop (Start menu > Claude).");
  say("  3. Open a new chat, type this sentence and press Enter:");
  say(`       ${CHAT_PROMPT}`);
  say("  4. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it (Always allow).");
  say("  5. Wait until Claude says it has finished and has ended the session.");
  const chatStart = now();
  results["chat_started_at"] = chatStart.toISOString();
  const entered = await deps.prompt("  6. Come back to this window and press Enter.");
  if (entered === null) {
    errors.push("input ended before the chat was done");
    return { ok: false, putBack: false, ac4: null };
  }
  const steps = await ask("3. While Claude worked, did steps named like \"AVG ... pass 1/4\" appear in the History panel?");
  const sliders = await ask("4. Are Claude's changes visible on the Develop sliders (for example Exposure or Highlights in the Basic panel)?");
  const look = await ask("5. Does the result look like a sensible golden-hour landscape edit to you?");
  results["jim_part2"] = { history_steps_seen: steps, settings_on_sliders: sliders, looks_golden_hour: look };
  const { evaluation, ac4 } = readChat(deps, results, chatStart);
  // The session must be on the chat's fixture, not on whatever photo was selected (Greptile, PR #24).
  const ok =
    steps === "y" && sliders === "y" && evaluation.session_begun && evaluation.intent_id === INTENT_A &&
    evaluation.target_filename === CHAT_FIXTURE && evaluation.passes >= 1 && evaluation.passes <= 4 && evaluation.session_ended === "accept";
  const snapshotName = evaluation.snapshot_name ?? "AVG pre-session ... (the newest one)";
  say("");
  say(`Last step: in the Snapshots panel (left side of Develop), click "${snapshotName}". That puts the photo back as it was before the chat.`);
  const putBack = (await ask(`6. Did you click "${snapshotName}", and does the photo now look as before the chat?`)) === "y";
  results["jim_part2"] = { ...(results["jim_part2"] as Json), photo_put_back_after_chat: putBack ? "y" : "n" };
  return { ok, putBack, ac4 };
}

/** The chat's logs, its evaluation and its AC-4, recorded in the results and summed up in the window. */
function readChat(deps: Phase3Deps, results: Json, since: Date): { evaluation: ChatEvaluation; ac4: SessionClip | null } {
  const logs = deps.collectChat(since);
  const evaluation = evaluateChat(logs.engine_log.records);
  const ac4 = chatClip(evaluation);
  results["chat"] = {
    desktop_log: logs.desktop_log,
    engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as, records: logs.engine_log.records.length },
    ...evaluation,
    ac4,
  };
  deps.say(`Chat log: Claude Desktop's MCP log ${logs.desktop_log.found ? `found (${logs.desktop_log.lines} lines)` : "NOT found"}; ` +
    `engine tool log ${logs.engine_log.found ? `found (${logs.engine_log.records.length} calls)` : "NOT found"}.`);
  deps.say(`  session begun: ${evaluation.session_begun ? `YES (${String(evaluation.intent_id)} on ${String(evaluation.target_filename)})` : "NO"}; ` +
    `passes: ${evaluation.passes}; ended: ${evaluation.session_ended ?? "NO"}`);
  deps.say(`  AC-4, clipping within the limits on every pass of the chat's session: ${ac4 ? describeClip(clipCheckAll([ac4])) : "not counted (no session began)"}`);
  return { evaluation, ac4 };
}
