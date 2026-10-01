// How Jim's click ended a session, from the session's log and the plugin's log (phase5-trace.ts):
// the outcome, who ended it, the operation an Abort interrupted, and AC-2's time from the click to the
// photo back. The session log's `ended_by` holds the event's click id, when the engine received it
// and `done_ms` from then to the end [handle: engine\src\log\session-log.ts endedBySchema]; the
// plugin's "hud: <event> <click_id> from the <source>: sent" line gives the click [handle:
// plugin\LrC-AVG.lrplugin\Hud.lua finish()]. Click to photo back = (received - sent) + done_ms, as
// row 5's live check measured it [handle: vault PHASE5_PLAN.md row 5, "Abort (AC-2)"].

import { readFileSync } from "node:fs";
import { sessionLogSchema, type SessionLogData as SessionLog } from "../log/index.js";
import { describeError } from "./phase1-check.js";
import type { Json, Phase5Deps } from "./phase5-config.js";

export type UserEndReport = Json & {
  ok: boolean;
  outcome: string | null;
  source: string | null;
  click_to_end_ms: number | null;
  interrupted: string | null;
  log_path: string | null;
};

/** The session's log, as the engine wrote it (it searches its folder for a session that ended). */
export function sessionLogOf(deps: Pick<Phase5Deps, "tools">, sid: string): { log: SessionLog; log_path: string } {
  const manager = deps.tools.sessionManager();
  if (!manager) throw new Error("the check's engine has no session manager");
  const logPath = String(manager.getLog({ session_id: sid }).json["log_path"]);
  return { log: sessionLogSchema.parse(JSON.parse(readFileSync(logPath, "utf8"))), log_path: logPath };
}

/** Whether session `sid` ended as `want` says (the outcome and the click's source), with AC-2's time. */
export function userEndOf(deps: Pick<Phase5Deps, "tools" | "pluginLog">, sid: string, want: { outcome: "aborted" | "accept"; source: "hud" | "menu" }): UserEndReport {
  let read: { log: SessionLog; log_path: string };
  try {
    read = sessionLogOf(deps, sid);
  } catch (err) {
    return { ok: false, outcome: null, source: null, click_to_end_ms: null, interrupted: null, log_path: null, error: describeError(err) };
  }
  const { log, log_path } = read;
  const by = log.ended_by;
  const sent = by?.click_id ? deps.pluginLog.clickSent(by.click_id) : null;
  const received = by?.received ? Date.parse(by.received) : Number.NaN;
  const clickToEnd = sent !== null && Number.isFinite(received) && by?.done_ms !== undefined ? Math.round(received - sent + by.done_ms) : null;
  const ok = log.outcome === want.outcome && by?.source === want.source;
  return {
    ok,
    outcome: log.outcome,
    source: by?.source ?? null,
    click_id: by?.click_id ?? null,
    click_sent: sent === null ? null : new Date(sent).toISOString(),
    received: by?.received ?? null,
    done_ms: by?.done_ms ?? null,
    click_to_end_ms: clickToEnd,
    interrupted: by?.interrupted ?? null,
    revert: log.revert,
    hud_events: log.hud_events ?? [],
    log_path,
    ...(sent === null && by?.click_id ? { note: `the plugin's "sent" line for click ${by.click_id} is not in its log` } : {}),
  };
}
