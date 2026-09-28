// Part 2 of the Phase 4 check (phase4-check.ts): Variants in a Claude Desktop chat, with the contact
// sheet (Phase 0, P-10: "not inline in the Desktop answer; test its delivery and readability") and
// the pick in chat (PHASE4_PLAN decision 3). Claude Desktop's engine writes the tool log; the check
// reads the chat's records from it (phase2-collect.ts), as Phase 3's chat did (phase3-chat.ts), and
// Jim answers y/n. A Variants session does not edit the master [handle: engine\src\session\variants.ts header;
// tests\session-variants.test.ts], so the photo
// needs no putting back; the chat's copies join the cleanup. The chat session's AC-4 reads the log
// its begin record names in `log_path` [handle: engine\src\session\variants.ts runVariants, the
// begin's log record].

import { clipCheckAll, clipCheckFile, describeClip, type SessionClip } from "./clip-check.js";
import { CHAT_PROMPT, PHOTO, type Json, type Phase4Deps, type Run } from "./phase4-config.js";

type Rec = Record<string, unknown>;

export type VariantsChat = {
  tool_calls: Array<{ ts: unknown; tool: unknown; ok: unknown; error_code?: unknown }>;
  session_begun: boolean;
  session_id: string | null;
  mode: string | null;
  intent_id: string | null;
  /** The photo the session began on (the begin record's target). */
  target_filename: string | null;
  copies: Array<{ id: string; uuid: string }>;
  /** The copies that had a pass before the pick. */
  refined_before_pick: string[];
  picked: string | null;
  steps_after_pick: number;
  session_ended: string | null;
  log_path: string | null;
};

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** What the chat's tool log shows of its Variants session: the begin, the passes, the pick, the end. */
export function evaluateVariantsChat(records: readonly Rec[]): VariantsChat {
  const tool_calls = records.map((r) => ({ ts: r["ts"], tool: r["tool"], ok: r["ok"], ...(r["error"] ? { error_code: (r["error"] as { code?: unknown }).code } : {}) }));
  const begin = records.find((r) => r["tool"] === "lr_begin_session" && r["ok"] === true && r["mode"] === "variants");
  const sid = begin?.["session_id"];
  const mine = (tool: string) => (r: Rec): boolean => r["tool"] === tool && r["ok"] === true && r["session_id"] === sid;
  const pickAt = begin ? records.findIndex(mine("lr_select_variant")) : -1;
  const steps = records.map((r, i) => ({ r, i })).filter(({ r }) => begin !== undefined && mine("lr_step")(r));
  const before = steps.filter(({ i }) => pickAt < 0 || i < pickAt).map(({ r }) => text(r["target"])).filter((t): t is string => t !== null);
  const end = begin ? records.find(mine("lr_end_session")) : undefined;
  const copies = ((begin?.["variants"] as Rec[] | undefined) ?? []).map((v) => ({ id: String(v["id"]), uuid: String(v["uuid"]) }));
  return {
    tool_calls,
    session_begun: begin !== undefined,
    session_id: text(sid),
    mode: text(begin?.["mode"]),
    intent_id: text(begin?.["intent_id"]),
    target_filename: text((begin?.["target"] as Rec | undefined)?.["filename"]),
    copies,
    refined_before_pick: [...new Set(before)].sort(),
    picked: pickAt >= 0 ? text((records[pickAt] as Rec)["picked"]) : null,
    steps_after_pick: pickAt < 0 ? 0 : steps.filter(({ i }) => i > pickAt).length,
    session_ended: text(end?.["outcome"]),
    log_path: text(begin?.["log_path"]),
  };
}

/** Copies a failed Variants begin made: its error names them (session\copies.ts makeCopies, VARIANTS_INCOMPLETE `details.copies`). */
export function failedBeginCopies(records: readonly Rec[]): Array<{ uuid: string; copy_name: string }> {
  return records
    .filter((r) => r["tool"] === "lr_begin_session" && r["ok"] === false)
    .flatMap((r) => ((((r["error"] as Rec | undefined)?.["details"] as Rec | undefined)?.["copies"] as Rec[] | undefined) ?? []))
    .flatMap((c) => (typeof c["uuid"] === "string" ? [{ uuid: c["uuid"], copy_name: typeof c["copy_name"] === "string" ? c["copy_name"] : "?" }] : []));
}

/** The chat's Variants session met AC-3 as the tool log shows it: three copies of the photo, a pick, a pass on it, accept. */
export function chatSessionOk(e: VariantsChat): boolean {
  return e.session_begun && e.target_filename === PHOTO && e.copies.length === 3 && e.picked !== null && e.steps_after_pick >= 1 && e.session_ended === "accept";
}

/** The chat outcome: AC-3 in chat (tool log + Jim), P-10's two questions, and the session's AC-4 (null when none began). */
export type ChatOutcome = { ok: boolean; sheetReadable: boolean; ac4: SessionClip | null };

/** Part 2: Jim holds the chat in Claude Desktop; the tool log and his answers say whether it worked. */
export async function runChat(deps: Phase4Deps, run: Run): Promise<ChatOutcome> {
  const { say } = deps;
  say("");
  say("Part 2: the chat in Claude Desktop.");
  say(`  Lightroom shows ${PHOTO} (the check selected it). Stay in the Develop module.`);
  say("  1. Start Claude Desktop (Start menu > Claude).");
  say("  2. Open a new chat, type this sentence and press Enter:");
  say(`       ${CHAT_PROMPT}`);
  say("  3. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it (Always allow).");
  say("  4. The contact sheet (the copies side by side) is inside Claude's tool step: click the step in Claude's answer to open it.");
  say("  5. When Claude asks which copy you want, answer with its letter.");
  say("  6. Wait until Claude says it has finished and has ended the session.");
  const since = (deps.now ?? (() => new Date()))();
  run.results["chat_started_at"] = since.toISOString();
  if ((await deps.prompt("  7. Come back to this window and press Enter.")) === null) {
    run.fail("input ended before the chat was done");
    return { ok: false, sheetReadable: false, ac4: null };
  }
  const sheet = await deps.ask("3. Did you see the contact sheet, the copies side by side?");
  const readable = await deps.ask("4. Could you tell on it which copy is A, B and C?");
  const pick = await deps.ask("5. Did Claude ask you to pick, and then carry on with the copy you picked?");
  run.results["jim_chat"] = { contact_sheet_seen: sheet, letters_readable: readable, pick_asked_and_followed: pick };
  const { evaluation, ac4 } = readChat(deps, run, since);
  const ok = sheet === "y" && pick === "y" && chatSessionOk(evaluation);
  return { ok, sheetReadable: readable === "y", ac4 };
}

/** The chat's logs, its evaluation and AC-4, recorded and summed up; its copies join the cleanup. */
function readChat(deps: Phase4Deps, run: Run, since: Date): { evaluation: VariantsChat; ac4: SessionClip | null } {
  const logs = deps.collectChat(since);
  const evaluation = evaluateVariantsChat(logs.engine_log.records);
  // The begin record names each copy by letter and uuid; its copy name is "AVG <intent> <letter>" (session\copies.ts copyName).
  for (const c of evaluation.copies) run.copies.push({ uuid: c.uuid, copy_name: `AVG ${evaluation.intent_id ?? "?"} ${c.id}`, made_by: "chat" });
  for (const c of failedBeginCopies(logs.engine_log.records)) if (!run.copies.some((k) => k.uuid === c.uuid)) run.copies.push({ ...c, made_by: "chat" });
  const ac4 = !evaluation.session_begun ? null : evaluation.log_path ? clipCheckFile("chat", evaluation.log_path) : { session: "chat", log_path: "", ok: false, passes: [], error: "the chat's lr_begin_session record names no log_path" };
  const chat: Json = { desktop_log: logs.desktop_log, engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as, records: logs.engine_log.records.length }, ...evaluation, ac4 };
  run.results["chat"] = chat;
  deps.say(`Chat log: Claude Desktop's MCP log ${logs.desktop_log.found ? `found (${logs.desktop_log.lines} lines)` : "NOT found"}; engine tool log ${logs.engine_log.found ? `found (${logs.engine_log.records.length} calls)` : "NOT found"}.`);
  deps.say(`  Variants session: ${evaluation.session_begun ? `YES (${String(evaluation.intent_id)} on ${String(evaluation.target_filename)}, ${evaluation.copies.length} copies)` : "NO"}; ` +
    `picked: ${evaluation.picked ?? "NO"}; passes after the pick: ${evaluation.steps_after_pick}; ended: ${evaluation.session_ended ?? "NO"}`);
  deps.say(`  AC-4 on every pass of the chat's session: ${ac4 ? describeClip(clipCheckAll([ac4])) : "not counted (no session began)"}`);
  return { evaluation, ac4 };
}
