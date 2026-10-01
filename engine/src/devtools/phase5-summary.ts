// The Phase 5 check's outcome over its whole state (every run of it; phase5-state.ts): the acceptance
// lines, what is recorded without deciding it, and the headlines in the window. A pure function of
// the state (acceptance), so tests\phase5-check-units.test.ts can feed it states.
//   - AC-4 and "no photo changed unexpectedly" count every attempt of a chat held twice, not only the
//     one that passed (Greptile, PR #49): a pass over a limit, or a click that reached another photo,
//     happened whichever attempt it was in. AC-1 counts the last attempt (the hold-again choice).
//   - Recorded, not acceptance lines: the approve chat (decision D4); whether the Plug-in Manager pause
//     was longer than the 6 s heartbeat limit, so that it exercised the session's 60 s allowance (the
//     row 7 plan made that conditional [stated: Jim, 2026-09-30, "Go with recommendations"]; the pause
//     length is Lightroom's, ~3 s in row 5's check [handle: vault PHASE5_PLAN.md row 5 "Plug-in
//     Manager"]); and session C's copies removed, as Phase 4 reported its cleanup without deciding on it
//     [handle: engine\src\devtools\phase4-cleanup.ts header].

import { FIXTURES, yn } from "./phase3-config.js";
import type { Json, Phase5Deps, Run } from "./phase5-config.js";
import type { Part1Lines } from "./phase5-part1.js";
import type { CheckState } from "./phase5-state.js";

type Chat = CheckState["chats"][number];

export type Acceptance = {
  lines: Record<string, boolean>;
  also: Json;
  accepted: boolean;
  headline: "WORKED" | "FAILED" | "NOT FINISHED";
};

const attemptsOf = (c: Chat): Json[] => (c.summary["attempts"] as Json[] | undefined) ?? [];
const lastOf = (c: Chat): Json => attemptsOf(c).at(-1) ?? {};
const clipOk = (v: unknown): boolean => (v as { ok?: unknown } | null | undefined)?.ok === true;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function progress(state: CheckState): string {
  const p1 = state.part1 ? (state.part1.ok ? "Part 1 passed" : "Part 1 failed (run again)") : "Part 1 not run";
  return `${p1}; approve chat ${state.approve_chat ? "done" : "not done"}; ${state.chats.length} of ${FIXTURES.length} chats done`;
}

/** AC-4 over every counted session: Part 1's, the approve chat's (when it began one), every attempt of every chat. */
function ac4All(state: CheckState, approve: Json): boolean {
  const chatsCounted = state.chats.every((c) => clipOk(lastOf(c)["ac4"]) && attemptsOf(c).every((a) => a["ac4"] === null || a["ac4"] === undefined || clipOk(a["ac4"])));
  const approveCounted = approve["ac4"] === null || approve["ac4"] === undefined || clipOk(approve["ac4"]);
  return state.part1?.ok === true && clipOk(state.part1.summary["ac4"]) && state.chats.length === FIXTURES.length && chatsCounted && approveCounted;
}

export function acceptance(state: CheckState): Acceptance {
  const p1 = (state.part1?.summary["lines"] ?? {}) as Partial<Part1Lines>;
  const chats = state.chats;
  const all6 = chats.length === FIXTURES.length;
  const approve = state.approve_chat?.summary ?? {};
  const unexpected = [...strings(state.part1?.summary["unexpected"]), ...strings(approve["unexpected"]), ...chats.flatMap((c) => attemptsOf(c).flatMap((a) => strings(a["unexpected"])))];
  const lines = {
    page_setting_reaches_engine: p1.page_setting_reaches_engine === true,
    session_rides_out_plugin_manager: p1.session_rides_out_plugin_manager === true,
    hud_tracks_stages: p1.hud_tracks_stages === true && all6 && chats.every((c) => c.ok),
    ac2_hud_abort: p1.ac2_hud_abort === true,
    approve_blocks_until_pressed: p1.approve_blocks_until_pressed === true,
    ac3_hud_pick: p1.ac3_hud_pick === true,
    menu_items: p1.menu_items === true,
    ac1_six_chats: all6 && chats.every((c) => c.ok),
    ac4_clipping: ac4All(state, approve),
    no_unexpected_change: state.part1 !== null && unexpected.length === 0,
    photos_put_back: p1.photo_put_back === true && all6 && chats.every((c) => lastOf(c)["put_back"] === true) && approve["put_back"] === true,
  };
  const pause = (state.part1?.summary["pause"] ?? null) as { silence_ms?: unknown; longer_than_heartbeat?: unknown } | null;
  const copies = (state.part1?.summary["copies"] ?? null) as { copies?: Array<{ state?: unknown }>; all_gone?: unknown } | null;
  const longest = approve["longest_call_held_ms"];
  const also: Json = {
    approve_chat_ok: state.approve_chat?.ok ?? null,
    approve_chat_longest_call_held_ms: typeof longest === "number" ? longest : null,
    plugin_manager_silence_ms: typeof pause?.silence_ms === "number" ? pause.silence_ms : null,
    session_allowance_exercised: pause?.longer_than_heartbeat === true,
    copies_removed: copies?.copies ? `${copies.copies.filter((c) => c.state === "gone").length} of ${copies.copies.length}` : null,
    unexpected,
  };
  const accepted = state.finished && Object.values(lines).every(Boolean);
  // A failed Part 1 stops the check (the chats wait for a Part 1 that passes): FAILED, not unfinished.
  const headline = accepted ? "WORKED" : state.finished || state.part1?.ok === false ? "FAILED" : "NOT FINISHED";
  return { lines, also, accepted, headline };
}

/** The summary in the run's results, and the headlines in the window. */
export function finish(deps: Pick<Phase5Deps, "say">, run: Run, state: CheckState, save: () => void, now: () => Date): { accepted: boolean; finished: boolean; results: Json } {
  const { lines, also, accepted, headline } = acceptance(state);
  run.results["summary"] = { acceptance_suggestion: headline, ...lines, ...also, progress: progress(state) };
  run.results["state"] = state;
  run.results["finished_at"] = now().toISOString();
  save();
  const say = deps.say;
  const chatsOk = state.chats.filter((c) => c.ok).length;
  say("");
  say(`Phase 5 acceptance: ${headline}${headline === "NOT FINISHED" ? ` (${progress(state)}; run the command again to continue)` : ""}`);
  say(`  Settings page reaches the engine: ${yn(lines["page_setting_reaches_engine"] === true)}; session rides out Plug-in Manager: ${yn(lines["session_rides_out_plugin_manager"] === true)}; HUD tracks stages (Part 1 and every chat): ${yn(lines["hud_tracks_stages"] === true)}`);
  say(`  AC-2 via the HUD's Abort: ${yn(lines["ac2_hud_abort"] === true)}; approve_each_pass blocks until Approve: ${yn(lines["approve_blocks_until_pressed"] === true)}; AC-3 with the HUD's Pick: ${yn(lines["ac3_hud_pick"] === true)}; menu items: ${yn(lines["menu_items"] === true)}`);
  say(`  AC-1, six golden-hour chats with the HUD: ${chatsOk} of ${FIXTURES.length}; AC-4 on every pass of every session: ${yn(lines["ac4_clipping"] === true)}; no photo changed unexpectedly: ${yn(lines["no_unexpected_change"] === true)}; photos put back: ${yn(lines["photos_put_back"] === true)}`);
  const held = also["approve_chat_longest_call_held_ms"];
  const silence = also["plugin_manager_silence_ms"];
  say(`Also recorded: the approve chat ${also["approve_chat_ok"] === null ? "not held" : `went as planned: ${yn(also["approve_chat_ok"] === true)}`}${typeof held === "number" ? `; its longest waiting lr_step took ${(held / 1000).toFixed(1)} s in the engine` : ""}.`);
  say(`  Plug-in Manager pause: ${typeof silence === "number" ? `${(silence / 1000).toFixed(1)} s` : "not seen"}; longer than the 6 s heartbeat limit, so the session's 60 s allowance was exercised: ${yn(also["session_allowance_exercised"] === true)}.`);
  say(`Cleanup: session C's copies removed: ${String(also["copies_removed"] ?? "not run")}.`);
  return { accepted, finished: state.finished, results: run.results };
}
