// A scripted session of the Phase 8 check (Parts 1-3): lr_begin_session on the selected photo, the
// scripted lr_step passes, the photo's settings read as the session left them, then lr_end_session,
// all through the same Tools class as the MCP server. A session that stops on an error is ended with
// revert (phase4-config.ts closeOpenSession), so the next one can begin.

import { differingSettings, type CanonicalSettings } from "../params/index.js";
import { closeOpenSession, settingsOf } from "./phase4-config.js";
import type { Json, Phase8Deps } from "./phase8-config.js";

export type Scripted = { sid: string; begin: Json; steps: Json[]; edited: CanonicalSettings; end: Json };
type Step = { settings: Record<string, number>; rationale: string };

/** The parts of a result the check keeps (no image). */
const kept = (json: Json, keys: readonly string[]): Json => Object.fromEntries(keys.filter((k) => k in json).map((k) => [k, json[k]]));

export async function scriptedSession(deps: Phase8Deps, out: Json, uuid: string, intent: string, steps: readonly Step[], outcome: "accept" | "revert"): Promise<Scripted> {
  try {
    const begin = (await deps.tools.beginSession({ intent_id: intent, max_passes: Math.max(1, steps.length), return_image: "none" })).json;
    const sid = String(begin["session_id"]);
    out["begin"] = kept(begin, ["session_id", "pipeline", "process_version", "camera_profile", "snapshot", "pass0", "history_names", "refused"]);
    const done: Json[] = [];
    for (const s of steps) {
      const res = (await deps.tools.step({ session_id: sid, settings: s.settings, rationale: s.rationale, return_image: "none" })).json;
      done.push({ asked: s.settings, ...kept(res, ["pass", "history_names", "applied", "refused", "undone", "guardrail_actions", "converged"]) });
    }
    out["steps"] = done;
    const edited = (await settingsOf(deps, uuid)).settings;
    const end = (await deps.tools.endSession({ session_id: sid, outcome })).json;
    out["end"] = kept(end, ["outcome", "passes", "log_path", "recipe_path", "revert"]);
    return { sid, begin, steps: done, edited, end };
  } catch (err) {
    await closeOpenSession(deps, out);
    throw err;
  }
}

/** A revert that put every setting back: lr_end_session's own comparison with the start. */
export const revertExact = (s: Scripted): boolean => ((s.end["revert"] as { differing?: unknown } | undefined)?.differing as unknown[] | undefined)?.length === 0;

/** The settings the session changed, with the values it left them at. */
export function changedBy(start: Readonly<CanonicalSettings>, s: Scripted): CanonicalSettings {
  return Object.fromEntries(differingSettings(start, s.edited).filter((n) => n in s.edited).map((n) => [n, s.edited[n]])) as CanonicalSettings;
}

/** The scripted passes Lightroom kept: each answered with its pass ("n/N") and not undone by a guardrail. */
export const passesMade = (s: Scripted): number => s.steps.filter((x) => typeof x["pass"] === "string" && x["undone"] === undefined).length;
