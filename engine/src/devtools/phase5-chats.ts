// Part 2 of the Phase 5 check (phase5-check.ts): the Claude Desktop chats, resumable (PHASE5_PLAN
// decision 8). Each finished chat is saved in the state (phase5-state.ts), so a run that stops
// continues with the next one.
//   - The approve chat (decision D4 [stated: Jim, 2026-09-30, "Go with recommendations"]): on Part 1's
//     photo, with the page still on "Approve each pass", Jim lets the first wait run out. It records
//     how long Claude Desktop held a waiting lr_step and whether it answered it (PHASE5_PLAN "From row
//     6": Desktop's tool timeout is [unverified]). Recorded, not an acceptance line.
//   - The settings page back to Autonomous (phase5-page.ts).
//   - AC-1's six golden-hour chats, one per fixture (PHASES.md Phase 5, "Inputs from Phase 3"): each
//     with the HUD, judged from the logs and Jim's y/n, its photo put back (phase5-chat-flow.ts). A
//     chat that did not pass may be held once more, at Jim's choice.

import { ENGINE_VERSION } from "../mcp/index.js";
import { APPROVAL_WAIT_MS } from "../session/index.js";
import { FIXTURES } from "./phase3-config.js";
import { CHAT_PROMPT, GO_ON, PHOTO, approvalWait, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { approveChatProblems, chatClip, goldenChatProblems } from "./phase5-chat-eval.js";
import { holdChat, type ChatRun, type ChatSpec } from "./phase5-chat-flow.js";
import { ensurePage } from "./phase5-page.js";
import { readbackMark, unexpectedSince } from "./phase5-readback.js";
import type { CheckState } from "./phase5-state.js";

const START_STEPS = [
  "  1. If Claude Desktop is not running, start it (Start menu > Claude).",
  "  2. Open a new chat, type this sentence and press Enter:",
  `       ${CHAT_PROMPT}`,
  "  3. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it (Always allow).",
];

const APPROVE_STEPS = [
  ...START_STEPS,
  '  4. After Claude\'s pass 1, the HUD\'s button reads "Approve pass 1". Do NOT click it yet.',
  `     Wait until Claude's answer in the chat says pass 1 is waiting for your approval (about ${Math.round(APPROVAL_WAIT_MS / 60000)} minute).`,
  `  5. Then click "Approve pass 1" in the HUD, and type in the chat: ${GO_ON}`,
  "  6. For each later pass, click the HUD's Approve button when it lights up.",
  "  7. Wait until Claude says it has finished and has ended the session.",
];

const GOLDEN_STEPS = [
  ...START_STEPS,
  "  4. Watch the HUD: it opens by itself when Claude begins, and its Stage line follows Claude's work.",
  "  5. Wait until Claude says it has finished and has ended the session.",
];

const GOLDEN_QUESTIONS = [
  '1. While Claude worked, did steps named like "AVG ... pass 1/4" appear in the History panel?',
  "2. Did the HUD open by itself when Claude began, and did its Stage line follow Claude's work?",
  "3. Are Claude's changes visible on the Develop sliders (for example Exposure or Highlights in the Basic panel)?",
  "4. Does the result look like a sensible golden-hour landscape edit to you?",
];

const APPROVE_QUESTIONS = [
  "1. While pass 1 waited for your Approve, did Claude say so in the chat (rather than show an error)?",
  `2. After your Approve and "${GO_ON}", did Claude make the next pass?`,
];

/** Saves the chat under way in the state at once, so a stop mid-chat leaves its photo's snapshot for the next run. */
const rememberIn = (state: CheckState, save: () => void): ChatSpec["remember"] => (pending) => {
  state.pending_chat = pending;
  save();
};

/** The chats still to do, in order; false when input ended or a step that the rest needs failed. */
export async function runChats(deps: Phase5Deps, run: Run, state: CheckState, save: () => void): Promise<boolean> {
  if (!state.approve_chat) {
    if (!(await ensurePage(deps, run, "page_for_approve_chat", "approve_each_pass"))) return false;
    const mark = readbackMark(run);
    const c = await holdChat(deps, run, { label: "the approve chat", tag: "approve", photo: PHOTO, steps: APPROVE_STEPS, questions: APPROVE_QUESTIONS, remember: rememberIn(state, save) });
    if (c.stopped) return false;
    state.approve_chat = { at: new Date().toISOString(), ok: approveOk(deps, c), summary: { ...approveSummary(deps, c), unexpected: unexpectedSince(run, mark) } };
    save();
  }
  if (!state.page_autonomous) {
    deps.say("");
    deps.say('Before the six chats, set the settings page back to "Autonomous":');
    state.page_autonomous = await ensurePage(deps, run, "page_for_chats", "autonomous");
    save();
    if (!state.page_autonomous) return false;
  }
  for (const [i, fixture] of FIXTURES.entries()) {
    if (state.chats.some((c) => c.fixture === fixture)) continue;
    const entry = await goldenChat(deps, run, fixture, i + 1, rememberIn(state, save));
    if (entry === null) return false;
    state.chats.push(entry);
    save();
  }
  return true;
}

/** One fixture's chat, held once more at Jim's choice when it did not pass; null when input ended. */
async function goldenChat(deps: Phase5Deps, run: Run, fixture: string, n: number, remember: ChatSpec["remember"]): Promise<CheckState["chats"][number] | null> {
  const attempts: Json[] = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const label = `chat ${n} of ${FIXTURES.length}${attempt > 1 ? " (again)" : ""}`;
    const mark = readbackMark(run);
    const c = await holdChat(deps, run, { label, tag: `chat${n}${attempt > 1 ? "b" : ""}`, photo: fixture, steps: GOLDEN_STEPS, questions: GOLDEN_QUESTIONS, remember });
    if (c.stopped) return null;
    const problems = goldenProblems(c, fixture);
    const clip = c.evaluation ? chatClip(c.evaluation, `chat ${n}`) : null;
    const unexpected = unexpectedSince(run, mark);
    const ok = problems.length === 0 && clip?.ok === true && unexpected.length === 0;
    attempts.push({ ok, problems, ac4: clip, unexpected, jim: c.answers, evaluation: c.evaluation, logs: c.logs, put_back: c.putBack });
    deps.say(`  ${label}: ${ok ? "PASSED" : `did NOT pass (${[...problems, ...(clip?.ok === false ? ["AC-4: a pass over a clipping limit"] : [])].join("; ")})`}.`);
    if (ok || attempt === 2 || !c.putBack) break;
    if ((await deps.ask(`Hold the chat on ${fixture} once more?`)) !== "y") break;
  }
  const last = attempts.at(-1) as Json;
  if (last["ok"] !== true) run.fail(`AC-1: the chat on ${fixture} did not pass (${(last["problems"] as string[]).join("; ") || "AC-4"})`);
  return { fixture, at: new Date().toISOString(), ok: last["ok"] === true, summary: { attempts } };
}

function goldenProblems(c: ChatRun, fixture: string): string[] {
  const problems = c.evaluation ? goldenChatProblems(c.evaluation, c.sessionLog, fixture, ENGINE_VERSION) : ["the chat's logs could not be read"];
  GOLDEN_QUESTIONS.forEach((q, i) => {
    if (c.answers[i] !== "y") problems.push(`Jim answered ${String(c.answers[i])} to "${q}"`);
  });
  if (!c.putBack) problems.push("the photo was not put back after the chat");
  return problems;
}

/** Why the approve chat did not go as planned: the logs, Claude Desktop's error lines, Jim's answers, the put-back. */
function approveProblems(deps: Phase5Deps, c: ChatRun): string[] {
  const problems = c.evaluation ? approveChatProblems(c.evaluation, c.sessionLog, PHOTO, approvalWait(deps)) : ["the chat's logs could not be read"];
  const errors = (c.logs["desktop_errors"] as string[] | undefined) ?? [];
  if (errors.length > 0) problems.push(`Claude Desktop's log has ${errors.length} error or time-out line(s)`);
  APPROVE_QUESTIONS.forEach((q, i) => {
    if (c.answers[i] !== "y") problems.push(`Jim answered ${String(c.answers[i])} to "${q}"`);
  });
  if (!c.putBack) problems.push("the photo was not put back after the chat");
  return problems;
}

function approveOk(deps: Phase5Deps, c: ChatRun): boolean {
  const problems = approveProblems(deps, c);
  const ok = problems.length === 0;
  deps.say(`  The approve chat: ${ok ? "a waiting lr_step ran its full wait, Claude told you so with no error, and the session went on after your Approve" : `did NOT go as planned (${problems.join("; ")})`}.`);
  return ok;
}

function approveSummary(deps: Phase5Deps, c: ChatRun): Json {
  const held = (c.evaluation?.awaiting ?? []).map((a) => a.duration_ms);
  return {
    jim: c.answers,
    problems: approveProblems(deps, c),
    awaiting: c.evaluation?.awaiting ?? [],
    longest_call_held_ms: held.length ? Math.max(...held) : null,
    approvals: c.sessionLog?.approvals ?? [],
    ac4: c.evaluation ? chatClip(c.evaluation, "approve chat") : null,
    evaluation: c.evaluation,
    logs: c.logs,
    put_back: c.putBack,
  };
}
