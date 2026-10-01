// Session B of the Phase 5 check (phase5-part1.ts): a Converge session in approve_each_pass mode,
// which Jim set on the settings page during session A (phase5-pause.ts).
//   - The page reached the engine: the begin's `session_settings` give the mode, from "page"
//     [handle: engine\src\session\begin.ts settingsJson; settings\session.ts resolveSessionSettings].
//   - PHASES.md Phase 5: "approve_each_pass mode blocks lr_step until the button is pressed". Pass 1
//     needs no approval; pass 2's lr_step waits until Jim clicks Approve pass 1 (the result's
//     `approval`: by "hud", how long it waited) [handle: engine\src\session\approval.ts awaitApproval].
//   - A wait in vain (PHASE5_PLAN "From row 6"): Jim clicks nothing, and after the full 60 s
//     (decision D3 [stated: Jim, 2026-09-30, "Go with recommendations"]: the value that ships,
//     APPROVAL_WAIT_MS) lr_step returns AWAITING_APPROVAL, recoverable, with nothing written: the
//     read-back finds the photo as after pass 2.
//   - An Abort while pass 3 waits: lr_step returns SESSION_ENDED at once, and the photo is back
//     (AC-2 from a waiting step).

import { toToolError } from "../mcp/index.js";
import { yn } from "./phase3-config.js";
import { closeOpenSession, errorBody, failLine, type Photo } from "./phase4-config.js";
import { INTENT, STEPS, approvalWait, waitSessionEnded, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { judgeAbort } from "./phase5-session-a.js";
import { readBack, sync } from "./phase5-readback.js";

/** Jim is told to wait about this long before his Approve, so the step is seen to block [inference]. */
const MIN_BLOCKED_MS = 1000;

export type SessionBOutcome = { ok: boolean; pageReached: boolean; blocks: boolean; waitInVain: boolean; abortWhileWaiting: boolean };

export async function sessionB(deps: Phase5Deps, run: Run, photo: Photo): Promise<SessionBOutcome> {
  const out: Json = { ok: false };
  run.results["session_b"] = out;
  let pageReached = false; // kept when a later step fails
  deps.say("");
  deps.say("Session B (Approve each pass): each of Claude's passes waits for your Approve in the HUD.");
  try {
    const begin = (await deps.tools.beginSession({ intent_id: INTENT, return_image: "none" })).json;
    const sid = String(begin["session_id"]);
    run.sessions.push({ name: "B", session_id: sid });
    const ss = (begin["session_settings"] ?? {}) as { approval?: unknown; from?: { approval?: unknown } };
    pageReached = ss.approval === "approve_each_pass" && ss.from?.approval === "page";
    out["begin"] = { session_id: sid, session_settings: ss };
    deps.say(`  The engine read Mode "Approve each pass" from the settings page: ${yn(pageReached)}.`);
    if (!pageReached) run.fail("the settings page's Mode did not reach the engine (session_b.begin.session_settings)");
    const p1 = (await deps.tools.step({ session_id: sid, settings: STEPS[0].settings, rationale: STEPS[0].rationale, return_image: "none" })).json;
    out["pass_1"] = { pass: p1["pass"], approval: p1["approval"] ?? null };
    const blocks = await approveBlocks(deps, run, photo, sid, out);
    const waitInVain = await waitAlone(deps, run, sid, out);
    const abortWhileWaiting = await abortWhileWaitingFor(deps, run, photo, sid, out);
    const jim = await deps.ask('4. In session B, did the HUD\'s Approve button read "Approve pass 1", and did the check go on only after you clicked it?');
    out["jim"] = { approve_button: jim };
    const ok = pageReached && blocks && waitInVain && abortWhileWaiting && jim === "y";
    out["ok"] = ok;
    deps.say(`  Session B: Approve blocks the next pass ${yn(blocks)}; nothing written without it ${yn(waitInVain)}; Abort while a pass waited ${yn(abortWhileWaiting)}.`);
    return { ok, pageReached, blocks, waitInVain, abortWhileWaiting };
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("session B", err));
    await closeOpenSession(deps, out);
    return { ok: false, pageReached, blocks: false, waitInVain: false, abortWhileWaiting: false };
  }
}

/** Pass 2 waits for Jim's Approve of pass 1, then goes ahead; read back, the photo may change (the pass). */
async function approveBlocks(deps: Phase5Deps, run: Run, photo: Photo, sid: string, out: Json): Promise<boolean> {
  await sync(deps, run);
  deps.say('  Claude\'s pass 2 now waits for you. The HUD\'s Approve button reads "Approve pass 1".');
  deps.say('  Wait about 10 seconds, then click "Approve pass 1" in the HUD.');
  const p2 = (await deps.tools.step({ session_id: sid, settings: STEPS[1].settings, rationale: STEPS[1].rationale, return_image: "none" })).json;
  const approval = (p2["approval"] ?? null) as { pass?: unknown; by?: unknown; waited_ms?: unknown } | null;
  const back = await readBack(deps, run, "your Approve (session B)", { changes: [photo.uuid] });
  const waited = typeof approval?.waited_ms === "number" ? approval.waited_ms : 0;
  const ok = approval?.by === "hud" && approval.pass === 1 && waited >= MIN_BLOCKED_MS && back;
  out["approve"] = { ok, pass: p2["pass"], history_names: p2["history_names"], approval };
  deps.say(`  Pass 2 waited ${(waited / 1000).toFixed(1)} s for your Approve (by ${String(approval?.by ?? "nobody")}), then went ahead: ${yn(ok)}.`);
  if (!ok) run.fail(`pass 2 did not wait for the HUD's Approve of pass 1 (session_b.approve.approval: ${JSON.stringify(approval)})`);
  return ok;
}

/** No click: pass 3's lr_step returns AWAITING_APPROVAL after the full wait, with nothing written. */
async function waitAlone(deps: Phase5Deps, run: Run, sid: string, out: Json): Promise<boolean> {
  await sync(deps, run);
  deps.say("");
  deps.say(`  Now do NOT click anything in the HUD for ${Math.round(approvalWait(deps) / 1000)} seconds: the check shows that Claude's pass 3 is not written without your Approve.`);
  const rec: Json = { ok: false };
  out["wait_in_vain"] = rec;
  try {
    const p3 = (await deps.tools.step({ session_id: sid, settings: STEPS[2].settings, rationale: STEPS[2].rationale, return_image: "none" })).json;
    rec["error"] = `pass 3 was made without an Approve (${String(p3["pass"])})`;
  } catch (err) {
    const e = toToolError(err);
    const waited = Number((e.details as { waited_ms?: unknown } | undefined)?.waited_ms ?? 0);
    Object.assign(rec, { code: e.code, recoverable: e.recoverable, waited_ms: waited });
    rec["ok"] = e.code === "AWAITING_APPROVAL" && e.recoverable && waited >= approvalWait(deps) - 1000;
  }
  const nothing = await readBack(deps, run, `the ${Math.round(approvalWait(deps) / 1000)} s without a click (session B)`);
  rec["nothing_written"] = nothing;
  const ok = rec["ok"] === true && nothing;
  rec["ok"] = ok;
  deps.say(`  After ${Math.round(Number(rec["waited_ms"] ?? 0) / 1000)} s without a click, Claude's pass 3 came back "${String(rec["code"] ?? "made")}" and nothing was written: ${yn(ok)}.`);
  if (!ok) run.fail(`a pass waiting in vain did not return AWAITING_APPROVAL with nothing written (session_b.wait_in_vain)`);
  return ok;
}

/** Jim's Abort while pass 3 waits: SESSION_ENDED at once, the photo back (AC-2 from a waiting step). */
async function abortWhileWaitingFor(deps: Phase5Deps, run: Run, photo: Photo, sid: string, out: Json): Promise<boolean> {
  await sync(deps, run);
  deps.say("");
  deps.say("  Claude's pass 3 now waits again. This time click Abort in the HUD (not Approve).");
  const rec: Json = {};
  out["abort_while_waiting"] = rec;
  try {
    const p3 = (await deps.tools.step({ session_id: sid, settings: STEPS[2].settings, rationale: STEPS[2].rationale, return_image: "none" })).json;
    rec["step"] = { error: `pass 3 was made (${String(p3["pass"])})` };
  } catch (err) {
    rec["step"] = errorBody(err);
  }
  const stopped = (rec["step"] as { code?: unknown }).code === "SESSION_ENDED";
  if (!stopped || !(await waitSessionEnded(deps, sid))) {
    run.fail(`the Abort while pass 3 waited did not end the step with SESSION_ENDED (session_b.abort_while_waiting)`);
    await closeOpenSession(deps, rec);
    return false;
  }
  const end = await judgeAbort(deps, run, photo, sid, "your Abort while pass 3 waited (session B)", "hud");
  const interrupted = typeof end.interrupted === "string" && end.interrupted.includes("waiting for approval");
  Object.assign(rec, { end, interrupted_wait: interrupted });
  return end.ok && interrupted;
}
