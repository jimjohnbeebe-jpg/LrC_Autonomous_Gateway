// Phase 5 acceptance check (PHASES.md Phase 5; PHASE5_PLAN row 7; plan approved by Jim 2026-09-30
// with decisions D1-D4 as recommended [stated: "Go with recommendations"]). The command-line entry is
// phase5-check-cli.ts (`npm run phase5:check`); this module runs the parts, so tests\phase5-check*.test.ts
// can run them against the simulated plugin. Fixed values are in phase5-config.ts.
//
// Part 1 (phase5-part1.ts) is scripted, through the same Tools class as the MCP server, on one photo,
// with Jim clicking in the HUD and the menu: the settings page reaching the engine, the HUD tracking
// stages, a session riding out a Plug-in Manager visit, AC-2 via the HUD's Abort, approve_each_pass
// blocking until Approve, AC-3 with the HUD's Pick, the menu items; every photo read back after each
// of Jim's clicks (phase5-readback.ts). Part 2 (phase5-chats.ts) is the Claude Desktop chats: the
// approve chat (recorded), then AC-1's six golden-hour chats with the HUD. The check resumes
// (phase5-state.ts): run again after a stop, it continues where it stopped. AC-4 counts every pass of
// every session (clip-check.ts). Jim answers y/n in this window, as in Phases 1-4 (rule 04's choice,
// recorded in docs\reports\phase5\PHASE5.md "Purpose").

import { pluginVersionAtLeast } from "../bridge/index.js";
import { clipCheckAll, clipCheckFile, describeClip, type SessionClip } from "./clip-check.js";
import { describeError } from "./phase1-check.js";
import { FIXTURES, yn } from "./phase3-config.js";
import { closeOpenSession } from "./phase4-config.js";
import { MIN_PLUGIN_VERSION, type Json, type Phase5Deps, type Run } from "./phase5-config.js";
import { putBackPending } from "./phase5-chat-flow.js";
import { runChats } from "./phase5-chats.js";
import { runPart1, type Part1Lines } from "./phase5-part1.js";
import { Known, readbackMark, unexpectedSince } from "./phase5-readback.js";
import { stateToContinue, type CheckState } from "./phase5-state.js";

export type CheckOutcome = { accepted: boolean; finished: boolean; results: Json };

export async function runPhase5Check(deps: Phase5Deps, options: { fresh?: boolean } = {}): Promise<CheckOutcome> {
  const now = deps.now ?? (() => new Date());
  const { state, resumed } = stateToContinue(deps.state, now().toISOString(), options.fresh === true);
  state.runs.push(deps.stamp);
  const save = (): void => deps.state.save(state);
  save();
  const errors: string[] = [];
  const results: Json = { check: "phase5", started_at: now().toISOString(), resumed, state_started_at: state.started_at, errors };
  const run: Run = { results, errors, known: new Known(), copies: [], unconfirmedCopies: [], sessions: [], fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG Phase 5 check");
  if (resumed) deps.say(`Continuing the check begun ${state.started_at}: ${progress(state)}.`);
  if (await connect(deps, run)) {
    try {
      await parts(deps, run, state, save);
    } catch (err) {
      run.fail(`the check stopped: ${describeError(err)}`);
      await closeOpenSession(deps, results); // a session left open would keep the photo edited
    }
  }
  results["bridge_stats"] = { ...deps.client.stats };
  results["hud_stats"] = deps.tools.hud()?.stats ?? null;
  results["hud_trace"] = deps.hudTrace;
  await deps.gate.release();
  return finish(deps, run, state, save, now);
}

async function parts(deps: Phase5Deps, run: Run, state: CheckState, save: () => void): Promise<void> {
  if (state.pending_chat) {
    if (!(await putBackPending(deps, run, state.pending_chat))) {
      deps.say("  The check stops here: tell Claude Code.");
      return;
    }
    state.pending_chat = null;
    save();
  }
  if (!state.part1?.ok) {
    const mark = readbackMark(run);
    const p1 = await runPart1(deps, run);
    const ac4 = part1Clip(deps, run);
    const unexpected = unexpectedSince(run, mark);
    state.part1 = { at: new Date().toISOString(), ok: p1.ok && ac4.ok && unexpected.length === 0, summary: { lines: p1.lines, ac4, unexpected, errors: [...run.errors] } };
    save();
    if (!state.part1.ok) {
      deps.say("");
      deps.say("Part 1 did not pass, so the chats were not started. Tell Claude Code; the next run starts Part 1 again.");
      return;
    }
  }
  deps.say("");
  deps.say("Part 2: the chats in Claude Desktop. The check hands the Lightroom bridge to Claude Desktop for each chat, and takes it back after.");
  if (await runChats(deps, run, state, save)) state.finished = true;
  save();
}

/** AC-4 on every pass of every Part 1 session (clip-check.ts), from the logs the check's engine wrote. */
function part1Clip(deps: Phase5Deps, run: Run): { ok: boolean; sessions: SessionClip[] } {
  const sessions = run.sessions.map(({ name, session_id }) => {
    try {
      const logPath = String(deps.tools.sessionManager()?.getLog({ session_id }).json["log_path"]);
      return clipCheckFile(name, logPath);
    } catch (err) {
      return { session: name, log_path: "", ok: false, passes: [], error: describeError(err) };
    }
  });
  const summary = clipCheckAll(sessions);
  deps.say(`  AC-4 on every pass of Part 1's sessions (${sessions.map((s) => s.session).join(", ") || "none"}): ${describeClip(summary)}`);
  return { ok: summary.ok && sessions.length > 0, sessions };
}

/** Take the bridge and connect (as phase4-check.ts); false, with the reason said, when it cannot. */
async function connect(deps: Phase5Deps, run: Run): Promise<boolean> {
  if (!(await deps.gate.start())) {
    run.fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return false;
  }
  const started = Date.now();
  try {
    run.results["hello"] = await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
    run.results["connect_ms"] = Date.now() - started;
  } catch (err) {
    run.fail(`could not connect to Lightroom (${deps.client.stats.last_drop_reason ?? deps.client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return false;
  }
  const version = (run.results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (!pluginVersionAtLeast(version, MIN_PLUGIN_VERSION)) {
    run.fail(`Lightroom is running LrC-AVG plugin ${String(version)}, not ${MIN_PLUGIN_VERSION} or later. Restart Lightroom and run the command again.`);
    return false;
  }
  deps.say(`Connected (${String(run.results["connect_ms"])} ms, plugin ${String(version)}).`);
  return true;
}

function progress(state: CheckState): string {
  const p1 = state.part1 ? (state.part1.ok ? "Part 1 passed" : "Part 1 failed (run again)") : "Part 1 not run";
  return `${p1}; approve chat ${state.approve_chat ? "done" : "not done"}; ${state.chats.length} of ${FIXTURES.length} chats done`;
}

/** The acceptance lines over the whole state (every run of this check), the headlines, and the summary. */
function finish(deps: Phase5Deps, run: Run, state: CheckState, save: () => void, now: () => Date): CheckOutcome {
  const p1 = (state.part1?.summary["lines"] ?? {}) as Partial<Part1Lines>;
  const p1Ok = state.part1?.ok === true;
  const chats = state.chats;
  const attemptsOf = (c: CheckState["chats"][number]): Json[] => (c.summary["attempts"] as Json[] | undefined) ?? [];
  const lastOf = (c: CheckState["chats"][number]): Json => attemptsOf(c).at(-1) ?? {};
  const approve = state.approve_chat?.summary ?? {};
  const unexpectedAll = [
    ...((state.part1?.summary["unexpected"] as string[] | undefined) ?? []),
    ...((approve["unexpected"] as string[] | undefined) ?? []),
    ...chats.flatMap((c) => (lastOf(c)["unexpected"] as string[] | undefined) ?? []),
  ];
  const lines = {
    page_setting_reaches_engine: p1.page_setting_reaches_engine === true,
    session_rides_out_plugin_manager: p1.session_rides_out_plugin_manager === true,
    hud_tracks_stages: p1.hud_tracks_stages === true && chats.length === FIXTURES.length && chats.every((c) => c.ok),
    ac2_hud_abort: p1.ac2_hud_abort === true,
    approve_blocks_until_pressed: p1.approve_blocks_until_pressed === true,
    ac3_hud_pick: p1.ac3_hud_pick === true,
    menu_items: p1.menu_items === true,
    ac1_six_chats: chats.length === FIXTURES.length && chats.every((c) => c.ok),
    ac4_clipping: p1Ok && (state.part1?.summary["ac4"] as { ok?: unknown } | undefined)?.ok === true && chats.length === FIXTURES.length && chats.every((c) => (lastOf(c)["ac4"] as { ok?: unknown } | null)?.ok === true),
    no_unexpected_change: state.part1 !== null && unexpectedAll.length === 0,
    photos_put_back: p1.photo_put_back === true && chats.length === FIXTURES.length && chats.every((c) => lastOf(c)["put_back"] === true) && approve["put_back"] === true,
  };
  const finished = state.finished;
  const accepted = finished && Object.values(lines).every(Boolean);
  const longest = approve["longest_call_held_ms"];
  const also = { approve_chat_ok: state.approve_chat?.ok ?? null, approve_chat_longest_call_held_ms: typeof longest === "number" ? longest : null, unexpected: unexpectedAll };
  // A failed Part 1 stops the check (the chats wait for a Part 1 that passes): FAILED, not unfinished.
  const headline = accepted ? "WORKED" : finished || state.part1?.ok === false ? "FAILED" : "NOT FINISHED";
  run.results["summary"] = { acceptance_suggestion: headline, ...lines, ...also, progress: progress(state) };
  run.results["state"] = state;
  run.results["finished_at"] = now().toISOString();
  save();
  const { say } = deps;
  say("");
  say(`Phase 5 acceptance: ${headline}${headline === "NOT FINISHED" ? ` (${progress(state)}; run the command again to continue)` : ""}`);
  say(`  Settings page reaches the engine: ${yn(lines.page_setting_reaches_engine)}; session rides out Plug-in Manager: ${yn(lines.session_rides_out_plugin_manager)}; HUD tracks stages (Part 1 and every chat): ${yn(lines.hud_tracks_stages)}`);
  say(`  AC-2 via the HUD's Abort: ${yn(lines.ac2_hud_abort)}; approve_each_pass blocks until Approve: ${yn(lines.approve_blocks_until_pressed)}; AC-3 with the HUD's Pick: ${yn(lines.ac3_hud_pick)}; menu items: ${yn(lines.menu_items)}`);
  say(`  AC-1, six golden-hour chats with the HUD: ${chats.filter((c) => c.ok).length} of ${FIXTURES.length}; AC-4 on every pass of every session: ${yn(lines.ac4_clipping)}; no photo changed unexpectedly: ${yn(lines.no_unexpected_change)}; photos put back: ${yn(lines.photos_put_back)}`);
  const held = also.approve_chat_longest_call_held_ms;
  say(`Also recorded: the approve chat ${also.approve_chat_ok === null ? "not held" : `went as planned: ${yn(also.approve_chat_ok)}`}${held === null ? "" : `; its longest waiting lr_step took ${(held / 1000).toFixed(1)} s in the engine`}.`);
  return { accepted, finished, results: run.results };
}
