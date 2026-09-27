// Phase 3 acceptance check (PHASES.md Phase 3; plan and four decisions approved by Jim 2026-09-26
// [stated: "go with recommendations"]). The command-line entry is phase3-check-cli.ts
// (`npm run phase3:check`); this module runs the steps, so tests/phase3-check.test.ts can run them
// against a simulated plugin. The fixed values are in phase3-config.ts.
//
// Part 1 is scripted (no Claude) and runs through the same Tools class as the MCP server. For each
// of the six fixtures, which Jim selects in Lightroom when asked (decision 4), phase3-fixture.ts:
//   1. the photo's context, and a golden JPEG of the photo as it is (1600 px), saved with its hash
//      and metrics (decision 3: the JPEG stays on disk; only its hash and metrics are committed);
//   2. session A, landscape_golden_hour (AC-1's intent): pass 0, up to four scripted passes (SCRIPT),
//      accept. Checked: the History names, the session log and recipe against their schemas, and
//      AC-5 as decided for Phase 3 (decision 1): the recipe replayed onto the same photo after the
//      pre-session snapshot reads back as the final settings. The snapshot is applied again at the
//      end, so the photo is left as it was;
//   3. session B, neutral_technical_correction (the intent that allows probing): a probe of exposure
//      and whites, one pass, revert. Checked: AC-2 (the revert's time and exactness).
//   On the first fixture also: a region crop (effective_scale, and the context's width/height), and
//   the selection guard (PRD 6.13): Jim selects another photo, a pass is refused, he selects it back.
// Two y/n questions (Jim's choice for Phases 1-2: y/n in this window).
// Part 2 is AC-1's chat on one fixture (phase3-chat.ts).
// AC-4 counts every pass of every session: A and B on each photo, and the chat's (clip-check.ts,
// PHASE4_PLAN decision 1) [handle: tests\phase3-check.test.ts "counts AC-4 on session B too ..."
// and "counts AC-4 on the chat's session ..."]. Until Phase 4 session 2 it counted session A only
// [handle: docs\reports\phase3\PHASE3.md "AC-4, what happened"].

import type { SessionClip } from "./clip-check.js";
import { describeError, median } from "./phase1-check.js";
import { runChat, type ChatOutcome } from "./phase3-chat.js";
import { FIXTURES, PASS_BUDGET_MS, REQUIRED_PLUGIN_VERSION, errorBody, yn, type Json, type Phase3Deps } from "./phase3-config.js";
import { runFixture } from "./phase3-fixture.js";

export type { Answer, Phase3Deps } from "./phase3-config.js";

/** The run's record: the results file, its errors and fixtures, and the pass times. */
type Run = { results: Json; errors: string[]; fixtures: Json[]; passDurations: number[]; fail: (message: string) => void };
/** Part 1's acceptance lines over the photos done. */
type Part1 = { allSix: boolean; scripted: boolean; ac2: boolean; ac4: boolean; ac5: boolean; putBack: boolean; probes: boolean; region: boolean; guard: boolean };

export async function runPhase3Check(deps: Phase3Deps): Promise<{ accepted: boolean; results: Json }> {
  const now = deps.now ?? (() => new Date());
  const errors: string[] = [];
  const fixtures: Json[] = [];
  const results: Json = { check: "phase3", started_at: now().toISOString(), errors, fixtures };
  const fail = (message: string): void => {
    errors.push(message);
    deps.say(`FAILED: ${message}`);
  };
  const run: Run = { results, errors, fixtures, passDurations: [], fail };

  deps.say("LrC-AVG Phase 3 check");
  deps.say("Part 1: the engine runs scripted sessions on the six fixtures. Connecting...");
  if (!(await connect(deps, run))) return { accepted: false, results };
  const lastHistory = await runPart1(deps, run);
  const done = fixtures.filter((f) => f["status"] === "done");
  const part1Jim = await askPart1(deps, run, done, lastHistory);
  const part1 = part1Lines(done);

  let chat: ChatOutcome = { ok: false, putBack: false, ac4: null };
  if (errors.length === 0 && part1.allSix && part1.scripted && part1.putBack) {
    chat = await runChat(deps, results, errors, now);
  } else {
    deps.say("");
    deps.say("Part 2 (the chat) was skipped because Part 1 did not pass on all six photos. Tell Claude Code what this window says.");
  }
  return finish(deps, run, now, done.length, part1, part1Jim, chat);
}

/** Take the bridge and connect to Lightroom's plugin (Phase 2's version). False, with the reason said, when it cannot. */
async function connect(deps: Phase3Deps, run: Run): Promise<boolean> {
  const { client, gate, say } = deps;
  if (!(await gate.start())) {
    run.results["summary"] = { acceptance_suggestion: "FAILED", lock: "busy" };
    run.fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return false;
  }
  const t0 = Date.now();
  try {
    run.results["hello"] = await client.waitConnected(deps.connectTimeoutMs ?? 20000);
    run.results["connect_ms"] = Date.now() - t0;
  } catch (err) {
    await gate.release();
    run.results["summary"] = { acceptance_suggestion: "FAILED", connected: false };
    run.fail(`could not connect to Lightroom (${client.stats.last_drop_reason ?? client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return false;
  }
  const pluginVersion = (run.results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (pluginVersion !== REQUIRED_PLUGIN_VERSION) {
    await gate.release();
    run.results["summary"] = { acceptance_suggestion: "FAILED", plugin_version: pluginVersion };
    run.fail(`Lightroom is running LrC-AVG plugin ${String(pluginVersion)}, not ${REQUIRED_PLUGIN_VERSION}. Restart Lightroom and run the command again.`);
    return false;
  }
  say(`Connected (${String(run.results["connect_ms"])} ms, plugin ${REQUIRED_PLUGIN_VERSION}).`);
  return true;
}

/** Part 1: each fixture in turn, then the bridge is left to Claude Desktop's engine. Returns the last photo's History names. */
async function runPart1(deps: Phase3Deps, run: Run): Promise<string[]> {
  let firstDone = false;
  let lastHistory: string[] = [];
  try {
    for (const [index, name] of FIXTURES.entries()) {
      const fx: Json = { name, status: "not run" };
      run.fixtures.push(fx);
      deps.say("");
      deps.say(`Photo ${index + 1} of ${FIXTURES.length}: ${name}`);
      if (!(await selectFixture(deps, name, fx))) continue;
      try {
        await runFixture(deps, name, fx, !firstDone, run.passDurations);
        firstDone = true;
        lastHistory = (fx["history_names"] as string[] | undefined) ?? lastHistory;
      } catch (err) {
        fx["status"] = "error";
        fx["error"] = errorBody(err);
        run.fail(`${name}: ${describeError(err)}`);
        await closeOpenSession(deps, fx);
      }
    }
  } finally {
    run.results["bridge_stats"] = { ...deps.client.stats };
    await deps.gate.release(); // leave the bridge to Claude Desktop's engine for Part 2
  }
  return lastHistory;
}

/** Ask Jim to select the fixture, and check that he did. False when he skipped it or it never matched. */
async function selectFixture(deps: Phase3Deps, name: string, fx: Json): Promise<boolean> {
  const { tools, say } = deps;
  let text = `  In Lightroom's Filmstrip, click ${name} (stay in the Develop module). Then press Enter here. If this photo is not in your catalog, type skip and press Enter.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const line = await deps.prompt(text);
    if (line === null) {
      fx["status"] = "skipped";
      fx["reason"] = "input ended";
      return false;
    }
    if (line.toLowerCase() === "skip") {
      fx["status"] = "skipped";
      fx["reason"] = "Jim typed skip";
      say("  Skipped.");
      return false;
    }
    const ctx = (await tools.getActivePhotoContext()).json;
    if (ctx["filename"] === name) {
      fx["photo"] = {
        uuid: ctx["uuid"],
        filename: ctx["filename"],
        file_format: ctx["file_format"],
        process_version: ctx["process_version"],
        camera_profile: ctx["camera_profile"],
        width: ctx["width"],
        height: ctx["height"],
        ...(ctx["settings_error"] ? { settings_error: ctx["settings_error"] } : {}),
      };
      fx["start_settings"] = ctx["settings"]; // the photo before the check, to confirm it is put back
      return true;
    }
    text = `  The selected photo is ${String(ctx["filename"])}, not ${name}. Click ${name}, then press Enter (or type skip).`;
  }
  fx["status"] = "skipped";
  fx["reason"] = "the selected photo never matched";
  say(`  Skipped: ${name} was not selected after three tries.`);
  return false;
}

/**
 * After an error, end a session the fixture left open with revert, so the photo is put back and the
 * next fixture can start a session [handle: Claude Code, 2026-09-26, the first run of
 * tests\phase3-check.test.ts against the simulated plugin: session B stayed open after an error, and
 * the five later fixtures failed with SESSION_ALREADY_ACTIVE].
 */
async function closeOpenSession(deps: Phase3Deps, fx: Json): Promise<void> {
  const open = deps.tools.sessionManager()?.current();
  if (!open) return;
  try {
    const end = await deps.tools.endSession({ session_id: open.id, outcome: "revert" });
    fx["closed_after_error"] = { session_id: open.id, revert: end.json["revert"] };
    deps.say(`  The open session was ended with revert (photo put back: ${yn((end.json["revert"] as { differing: string[] }).differing.length === 0)}).`);
  } catch (err) {
    fx["closed_after_error"] = { session_id: open.id, error: errorBody(err) };
    deps.say(`  The open session could not be ended: ${describeError(err)}. Tell Claude Code.`);
  }
}

/** The two questions about Part 1; true when Jim answered yes to both. */
async function askPart1(deps: Phase3Deps, run: Run, done: Json[], lastHistory: string[]): Promise<boolean> {
  if (done.length === 0) return false;
  deps.say("");
  deps.say("Two questions. Look at Lightroom's Develop module.");
  const example = lastHistory.find((h) => / pass 1\//.test(h)) ?? "AVG <6 letters and digits> pass 1/4";
  const history = await deps.ask(`1. In the History panel (left side) of the photo on screen, are there steps named like "${example}", "... pass 2/4" and so on?`);
  const restored = await deps.ask("2. Click through the six photos in the Filmstrip. Does each one look as it did before the check?");
  run.results["jim_part1"] = { history_steps_seen: history, photos_look_as_before: restored };
  return history === "y" && restored === "y";
}

/**
 * Part 1's acceptance lines. The other checks the harness runs count too, so a failed one cannot
 * hide behind WORKED (Greptile, PR #24): the probe on every photo; the region crop and selection
 * guard on the first.
 */
function part1Lines(done: Json[]): Part1 {
  const all = <T>(key: string, test: (v: T) => boolean): boolean => done.length > 0 && done.every((f) => test(f[key] as T));
  const ok = (v: { ok: boolean } | undefined): boolean => v?.ok === true;
  const firstPhoto = done[0];
  const noError = (v: unknown): boolean => typeof v === "object" && v !== null && !("error" in (v as Json));
  return {
    allSix: done.length === FIXTURES.length,
    scripted: all("session_a", ok),
    ac2: all("ac2", ok),
    ac4: all("ac4", ok),
    ac5: all("ac5", ok),
    putBack: all("put_back", ok),
    probes: all<Json | undefined>("session_b", (v) => v !== undefined && noError(v["probe"])),
    region: firstPhoto !== undefined && noError(firstPhoto["region"]),
    guard: firstPhoto !== undefined && ((firstPhoto["session_b"] as Json | undefined)?.["selection_guard"] as Json | undefined)?.["ok"] === true,
  };
}

/** The summary in the results and the headline in the window. AC-4 counts the chat's session when one began. */
function finish(deps: Phase3Deps, run: Run, now: () => Date, doneCount: number, p: Part1, part1Jim: boolean, chat: ChatOutcome): { accepted: boolean; results: Json } {
  const { passDurations, results, fixtures } = run;
  const chatClip: SessionClip | null = chat.ac4;
  const ac4 = p.ac4 && (chatClip === null || chatClip.ok);
  const extras = p.probes && p.region && p.guard;
  const ac1 = p.scripted && p.allSix && part1Jim && chat.ok;
  const accepted = ac1 && p.ac2 && ac4 && p.ac5 && p.putBack && chat.putBack && extras;
  const within = passDurations.filter((d) => d <= PASS_BUDGET_MS).length;
  results["summary"] = {
    acceptance_suggestion: accepted ? "WORKED" : "FAILED",
    fixtures_done: doneCount,
    fixtures_skipped: fixtures.filter((f) => f["status"] === "skipped").map((f) => f["name"]),
    ac1_scripted_sessions: p.scripted,
    ac1_chat: chat.ok,
    ac2_revert: p.ac2,
    ac4_clipping: ac4,
    ac4_chat_session: chatClip === null ? null : chatClip.ok,
    ac5_log_and_replay: p.ac5,
    probes_ok: p.probes,
    region_crop_ok: p.region,
    selection_guard_ok: p.guard,
    photos_put_back: p.putBack,
    jim_part1_confirmed: part1Jim,
    photo_put_back_after_chat: chat.putBack,
    pass_ms: { n: passDurations.length, median: Math.round(median(passDurations)), within_budget: within },
  };
  results["finished_at"] = now().toISOString();
  const { say } = deps;
  say("");
  say(`Phase 3 acceptance: ${accepted ? "WORKED" : "FAILED"}`);
  say(`  photos done: ${doneCount} of ${FIXTURES.length}; scripted sessions: ${yn(p.scripted)}; AC-2 revert within 1 s and exact: ${yn(p.ac2)}; ` +
    `AC-4 clipping within limits on every pass of every session (A, B, chat): ${yn(ac4)}; AC-5 log, recipe and replay: ${yn(p.ac5)}`);
  say(`  probes: ${yn(p.probes)}; region crop: ${yn(p.region)}; selection guard: ${yn(p.guard)}; photos put back after the check: ${yn(p.putBack)}; ` +
    `your answers in part 1: ${part1Jim ? "both yes" : "not both yes"}; chat (AC-1): ${yn(chat.ok)}; photo put back after the chat: ${yn(chat.putBack)}`);
  // The pass budget is a measurement, not part of the acceptance lines, so it has its own headline.
  say(`Pass budget: ${within} of ${passDurations.length} passes within ~${PASS_BUDGET_MS / 1000} s (median ${Math.round(median(passDurations))} ms).`);
  return { accepted, results };
}
