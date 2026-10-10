// One Claude Desktop chat in the Phase 5 check (phase5-chats.ts runs the approve chat and the six
// golden-hour chats through it):
//   1. Jim selects the chat's photo; the check reads its settings (the start), takes its own snapshot
//      of it ("AVG P5check before <chat>"), saves both in the state (phase5-state.ts pending_chat), and
//      gives the bridge up, so Claude Desktop's engine can take it at Claude's first tool call [handle:
//      engine\src\mcp\bridge-gate.ts header: the lock is taken on the first tool call that needs it];
//   2. Jim holds the chat and answers y/n here;
//   3. the check reads the chat's logs (phase5-chat-eval.ts);
//   4. it takes the bridge back (decision D2 [stated: Jim, 2026-09-30, "Go with recommendations"]):
//      Claude Desktop's engine gives it back 60 s after its last tool call once no session is open
//      [handle: engine\src\mcp\main.ts IDLE_RELEASE_MS, bridge-gate.ts armIdle; with Claude Desktop
//      [unverified] until this check], so the check waits up to BRIDGE_WAIT_MS, and else asks Jim to
//      quit Claude Desktop;
//   5. it reads back every photo it knows (only the chat's photo may have changed), puts the photo
//      back with its own snapshot, reads it back against the start, and clears the pending chat.
// The check's own snapshot, not the chat session's, puts the photo back: it holds whatever Claude did
// (two sessions, or one left open), and a run that stops mid-chat finds it in the state and puts the
// photo back first thing on the next run (putBackPending).

import type { CanonicalSettings } from "../params/index.js";
import { differingSettings } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import type { ChatLogs } from "./phase2-check.js";
import { settingsOf } from "./phase4-config.js";
import { BRIDGE_WAIT_MS, ROUNDS, pollOf, waitFor, type Answer, type Json, type Phase5Deps, type Photo, type Run } from "./phase5-config.js";
import { chatSessionLog, evaluateChat, type ChatEvaluation } from "./phase5-chat-eval.js";
import { selectPhoto } from "./phase5-part1.js";
import { readBack } from "./phase5-readback.js";
import type { PendingChat } from "./phase5-state.js";
import type { SessionLogData } from "../log/index.js";

export type ChatSpec = {
  /** Its name in the window and the results ("chat 3 of 6", "the approve chat"). */
  label: string;
  /** Names the saved log files and the check's snapshot. */
  tag: string;
  photo: string;
  /** Jim's numbered steps in Claude Desktop, ending before "come back to this window". */
  steps: readonly string[];
  questions: readonly string[];
  /** Saves the chat under way in the state (null once its photo is back). */
  remember: (pending: PendingChat | null) => void;
};

export type ChatRun = {
  /** Input ended: the check stops here and continues on the next run. */
  stopped: boolean;
  photo: Photo | null;
  answers: Answer[];
  evaluation: ChatEvaluation | null;
  sessionLog: SessionLogData | null;
  logs: Json;
  /** The bridge is back, the photo read back and put back exactly. */
  putBack: boolean;
};

export async function holdChat(deps: Phase5Deps, run: Run, spec: ChatSpec): Promise<ChatRun> {
  const none: ChatRun = { stopped: false, photo: null, answers: [], evaluation: null, sessionLog: null, logs: {}, putBack: false };
  deps.say("");
  deps.say(`${spec.label[0]?.toUpperCase() ?? ""}${spec.label.slice(1)}: ${spec.photo}.`);
  const photo = await selectPhoto(deps, run, spec.photo);
  if (!photo) return none;
  const snap = await deps.client.request("create_snapshot", { photo_uuid: photo.uuid, name: `AVG P5check before ${spec.tag}` });
  const pending: PendingChat = { label: spec.label, fixture: spec.photo, uuid: photo.uuid, snapshot_id: snap.snapshot_id, start: photo.start };
  spec.remember(pending);
  await deps.gate.release(); // leave the bridge to Claude Desktop's engine
  for (const line of spec.steps) deps.say(line);
  const since = (deps.now ?? (() => new Date()))();
  const next = Math.max(0, ...spec.steps.map((l) => Number(/^\s*(\d+)\./.exec(l)?.[1] ?? 0))) + 1;
  if ((await deps.prompt(`  ${next}. Come back to this window and press Enter.`)) === null) return { ...none, stopped: true, photo };
  const answers: Answer[] = [];
  for (const q of spec.questions) answers.push(await deps.ask(q));
  const logs = deps.collectChat(since, spec.tag);
  const evaluation = evaluateChat(logs.engine_log.records);
  const { log, error } = chatSessionLog(evaluation);
  deps.say(`  Chat log: Claude Desktop's MCP log ${logs.desktop_log.found ? `found (${logs.desktop_log.lines} lines)` : "NOT found"}; engine tool log ${logs.engine_log.found ? `found (${logs.engine_log.records.length} calls)` : "NOT found"}.`);
  deps.say(`  Session: ${evaluation.session_begun ? `${String(evaluation.intent_id)} on ${String(evaluation.target_filename)}, ${evaluation.passes} pass(es), ended ${evaluation.session_ended ?? "NO"}` : "NONE began"}.`);
  const back = await takeBridgeBack(deps, run, spec.label);
  let putBack = false;
  if (back) {
    await readBack(deps, run, spec.label, { changes: [photo.uuid] });
    putBack = await putBackWith(deps, run, pending);
    if (putBack) spec.remember(null);
  }
  return { stopped: false, photo, answers, evaluation, sessionLog: log, logs: logsSummary(logs, error), putBack };
}

function logsSummary(logs: ChatLogs & { desktop_errors?: string[] }, sessionLogError: string | null): Json {
  return {
    desktop_log: logs.desktop_log,
    desktop_errors: logs.desktop_errors ?? [],
    engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as, records: logs.engine_log.records.length },
    session_log_error: sessionLogError,
  };
}

/** The bridge back from Claude Desktop's engine: by its idle release, else after Jim quits Claude Desktop. */
export async function takeBridgeBack(deps: Pick<Phase5Deps, "gate" | "client" | "prompt" | "say" | "bridgeWaitMs" | "pollMs" | "connectTimeoutMs">, run: Pick<Run, "results" | "fail">, label: string): Promise<boolean> {
  const waitMs = deps.bridgeWaitMs ?? BRIDGE_WAIT_MS;
  const started = Date.now();
  deps.say(`  Waiting for Claude Desktop to give the Lightroom bridge back (a minute after Claude's last call; at most ${Math.round(waitMs / 1000)} s). Leave Claude Desktop open.`);
  let held = await waitFor(() => deps.gate.start(), waitMs, Math.max(pollOf(deps), 50));
  const record: Json = { idle_release: held, waited_ms: Date.now() - started };
  for (let round = 1; !held && round <= ROUNDS; round++) {
    const line = await deps.prompt("  Claude Desktop still holds the bridge. Quit it: right-click the Claude icon in the Windows system tray > Quit. Then press Enter here.");
    if (line === null) break;
    held = await deps.gate.start();
    record["quit_rounds"] = round;
  }
  if (held) {
    try {
      await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
    } catch (err) {
      held = false;
      record["connect_error"] = describeError(err);
    }
  }
  record["ok"] = held;
  ((run.results["bridge_back"] ??= []) as Json[]).push({ chat: label, ...record });
  if (!held) run.fail(`after ${label}, the check could not take the Lightroom bridge back to check and put back the photo`);
  return held;
}

/** The chat's photo put back with the check's snapshot, and read back against its start. */
async function putBackWith(deps: Phase5Deps, run: Run, p: PendingChat): Promise<boolean> {
  try {
    await deps.client.request("apply_snapshot", { photo_uuid: p.uuid, snapshot_id: p.snapshot_id }, { timeoutMs: 30000 });
  } catch (err) {
    run.fail(`after ${p.label}, the check's snapshot could not be applied to ${p.fixture} (${describeError(err)})`);
    return false;
  }
  const back = await readBack(deps, run, `the check's put-back after ${p.label}`, { expect: [{ uuid: p.uuid, settings: p.start as CanonicalSettings }] });
  deps.say(`  ${p.fixture} put back as before the chat: ${back ? "YES" : "NO"}.`);
  return back;
}

/** A run that stopped during a chat left its photo edited: put it back with the check's snapshot before anything else. */
export async function putBackPending(deps: Phase5Deps, run: Run, p: PendingChat): Promise<boolean> {
  deps.say("");
  deps.say(`The last run stopped during ${p.label}; putting ${p.fixture} back first.`);
  try {
    await deps.client.request("apply_snapshot", { photo_uuid: p.uuid, snapshot_id: p.snapshot_id }, { timeoutMs: 30000 });
    const differing = differingSettings((await settingsOf(deps, p.uuid)).settings, p.start as CanonicalSettings);
    run.results["pending_put_back"] = { chat: p.label, fixture: p.fixture, differing };
    deps.say(`  ${p.fixture} put back as before that chat: ${differing.length === 0 ? "YES" : `NO (${differing.join(", ")} differ)`}.`);
    if (differing.length > 0) run.fail(`${p.fixture} is not back as before ${p.label}`);
    return differing.length === 0;
  } catch (err) {
    run.fail(`${p.fixture} could not be put back after the stopped ${p.label}: ${describeError(err)}`);
    return false;
  }
}
