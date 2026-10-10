// Part 5 of the Phase 8 check (phase8-check.ts): one Claude Desktop chat on the JPEG (PHASE8_PLAN
// row 6). The check holds the photo back with its own snapshot (saved in the state), gives the bridge
// up for Claude Desktop's engine, and Jim holds the chat and answers y/n here. The chat is judged from
// the tool log Claude Desktop's engine wrote (phase5-chat-eval.ts): a session on the JPEG, at least
// one pass, ended, on the rendered pipeline, by this engine's version (Claude Desktop restarted, so it
// runs the repo's engine\dist [handle: engine\src\devtools\install-desktop-config-cli.ts]). Then the
// check takes the bridge back (phase5-chat-flow.ts takeBridgeBack) and puts the photo back.

import { ENGINE_VERSION } from "../mcp/index.js";
import { describeError } from "./phase1-check.js";
import { errorBody } from "./phase4-config.js";
import { chatSessionLog, evaluateChat } from "./phase5-chat-eval.js";
import { takeBridgeBack } from "./phase5-chat-flow.js";
import { BRIDGE_WAIT_MS, CHAT_PROMPT, JPEG, holdBack, putBack, selectSettled, yes, type Answer, type Fixture, type Json, type Phase8Deps, type Run } from "./phase8-config.js";
import { partOf } from "./phase8-state.js";

const STEPS = [
  "  1. If Claude Desktop is running, quit it: right-click the Claude icon in the Windows system tray > Quit.",
  "  2. Start Claude Desktop (Start menu > Claude), so it runs the engine this check was built with.",
  "  3. Open a new chat, type this sentence and press Enter:",
  `       ${CHAT_PROMPT}`,
  "  4. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it (Always allow).",
  "  5. Wait until Claude says it has finished and has ended the session.",
];

const QUESTIONS = [
  "1. Did Claude finish without an error message in the chat?",
  "2. Are Claude's changes visible on the Develop sliders (for example in the Basic panel)?",
  `3. Does the result look like a sensible natural-light portrait edit of ${JPEG.filename} to you?`,
];

/** False when input ended mid-chat: the photo stays pending and the next run puts it back and asks again. */
export async function chatPart(deps: Phase8Deps, run: Run, jpeg: Fixture): Promise<boolean> {
  const out: Json = {};
  run.results["chat"] = out;
  deps.say("");
  deps.say(`Part 5: one Claude Desktop chat on ${jpeg.label}.`);
  let ok = false;
  try {
    await selectSettled(deps, jpeg.uuid);
    const held = await holdBack(deps, run, jpeg.uuid, jpeg.label);
    await deps.gate.release(); // leave the bridge to Claude Desktop's engine
    for (const line of STEPS) deps.say(line);
    const since = (deps.now ?? (() => new Date()))();
    if ((await deps.prompt("  6. Come back to this window and press Enter.")) === null) return false; // the next run asks again
    const answers: Answer[] = [];
    for (const q of QUESTIONS) answers.push(await deps.ask(q));
    const judged = judge(deps, since, answers, out);
    const back = await takeBridgeBack({ ...deps, bridgeWaitMs: deps.bridgeWaitMs ?? BRIDGE_WAIT_MS }, run, "the chat");
    const differing = back ? await putBack(deps, run, held) : ["the bridge"];
    out["put_back_differing"] = differing;
    deps.say(`  ${jpeg.label} put back as before the chat: ${yes(differing.length === 0)}.`);
    ok = judged && differing.length === 0;
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(`Part 5: ${describeError(err)}`);
  }
  out["ok"] = ok;
  run.state.chat = partOf(ok, out);
  run.save();
  deps.say(`Part 5, the Claude Desktop chat: ${ok ? "WORKED" : "FAILED"}`);
  return true;
}

/** The chat from its logs and Jim's answers. */
function judge(deps: Phase8Deps, since: Date, answers: Answer[], out: Json): boolean {
  const logs = deps.collectChat(since, "chat");
  const e = evaluateChat(logs.engine_log.records);
  const { log, error } = chatSessionLog(e);
  const lines = {
    session_on_the_jpeg: e.session_begun && e.target_filename === JPEG.filename,
    passes: e.passes >= 1,
    ended: e.session_ended === "accept" || e.session_ended === "revert",
    rendered_pipeline: log?.target.pipeline === "rendered",
    engine_version: log?.engine_version === ENGINE_VERSION,
    jim: answers.every((a) => a === "y"),
  };
  Object.assign(out, { lines, answers, evaluation: { ...e, tool_calls: e.tool_calls.length }, session_log_error: error, engine_version: log?.engine_version ?? null, logs: { desktop_log: logs.desktop_log, engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as } } });
  deps.say(`  Chat: ${e.session_begun ? `${String(e.intent_id)} on ${String(e.target_filename)}, ${e.passes} pass(es), ended ${e.session_ended ?? "NO"}` : "no session began"}; pipeline ${log?.target.pipeline ?? "?"}; engine ${log?.engine_version ?? "?"} (this check: ${ENGINE_VERSION}).`);
  if (log && !lines.engine_version) deps.say("  Claude Desktop ran another engine version: it was not restarted after the build.");
  return Object.values(lines).every(Boolean);
}

