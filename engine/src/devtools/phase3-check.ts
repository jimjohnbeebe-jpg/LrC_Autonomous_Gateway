// Phase 3 acceptance check (PHASES.md Phase 3; plan and four decisions approved by Jim 2026-09-26
// [stated: "go with recommendations"]). The command-line entry is phase3-check-cli.ts
// (`npm run phase3:check`); this module holds the steps, so tests/phase3-check.test.ts can run them
// against a simulated plugin.
//
// Part 1 is scripted (no Claude) and runs through the same Tools class as the MCP server. For each
// of the six fixtures, which Jim selects in Lightroom when asked (decision 4):
//   1. the photo's context, and a golden JPEG of the photo as it is (1600 px), saved with its hash
//      and metrics (decision 3: the JPEG stays on disk; only its hash and metrics are committed);
//   2. session A, landscape_golden_hour (AC-1's intent): pass 0, up to four scripted passes (SCRIPT),
//      accept. Checked: the History names, AC-4 on every pass, the session log and recipe against
//      their schemas, and AC-5 as decided for Phase 3 (decision 1): the recipe replayed onto the
//      same photo after the pre-session snapshot reads back as the final settings. The snapshot is
//      applied again at the end, so the photo is left as it was;
//   3. session B, neutral_technical_correction (the intent that allows probing): a probe of exposure
//      and whites, one pass, revert. Checked: AC-2 (the revert's time and exactness).
//   On the first fixture also: a region crop (effective_scale, and the context's width/height), and
//   the selection guard (PRD 6.13): Jim selects another photo, a pass is refused, he selects it back.
// Two y/n questions (Jim's choice for Phases 1-2: y/n in this window).
// Part 2 is AC-1's chat on one fixture (decision 2: one chat now; the HUD and the six-fixture chat
// part close in Phase 5). The engine's tool log shows the session; Jim answers y/n; then he puts the
// photo back with the session's snapshot.

import { readFileSync } from "node:fs";
import type { BridgeClient } from "../bridge/index.js";
import { recipeSchema, sessionLogSchema, type SessionLogData } from "../log/index.js";
import type { BridgeGate, Tools } from "../mcp/index.js";
import { ToolError } from "../mcp/index.js";
import type { ParamMap } from "../params/index.js";
import type { Answer } from "./phase1-check.js";
import { describeError, median } from "./phase1-check.js";
import type { ChatLogs } from "./phase2-check.js";

export type { Answer };

/**
 * The six fixtures (PHASES.md Phase 3 "on all six fixtures") [handle: the repo's fixtures\ folder,
 * listed by Claude Code on 2026-09-26; the files are gitignored].
 */
export const FIXTURES = [
  "20250413-_OZ81430.NEF",
  "20260110-_Z8A0138-DxO_DeepPRIME XD3.dng",
  "20260110-_Z8A0173.NEF",
  "20260906-_OZ80005.NEF",
  "20260907-_OZ80093.NEF",
  "20260907-_OZ80099.NEF",
] as const;
/** The chat's photo: the Phase 2 photo. */
export const CHAT_FIXTURE = "20260907-_OZ80093.NEF";
/** AC-1's words (PRD section 10). */
export const CHAT_PROMPT = "Tune the active photo for golden hour landscape.";
export const INTENT_A = "landscape_golden_hour";
export const INTENT_B = "neutral_technical_correction";
export const REPLAY_HISTORY_NAME = "AVG P3check replay";
/** The plugin Phase 3 needs: Phase 2's, unchanged (Bridge.lua PLUGIN_VERSION). */
export const REQUIRED_PLUGIN_VERSION = "0.2.0";
/** AC-2: the snapshot restores within 1 s. */
export const REVERT_BUDGET_MS = 1000;
/** About 3.5 s per pass (Jim, 2026-09-26) [handle: docs\reports\phase2\PHASE2.md "Verdict"]. */
export const PASS_BUDGET_MS = 3500;
/** The region crop on the first fixture: the middle fifth, at 800 px. */
export const REGION = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 } as const;

/** Session A's scripted passes: ordinary moves, one that pushes the highlights, one too small to move the metrics. */
export const SCRIPT: ReadonlyArray<{ settings: Record<string, number>; rationale: string }> = [
  { settings: { exposure: 0.3, shadows: 15 }, rationale: "scripted pass: lift the midtones and open the shadows" },
  { settings: { whites: 40, exposure: 0.5 }, rationale: "scripted pass: push the highlights, to exercise the guardrails" },
  { settings: { vibrance: 10, clarity: 5 }, rationale: "scripted pass: a little colour and local contrast" },
  { settings: { exposure: 0.02 }, rationale: "scripted pass: a step too small to move the metrics (convergence by metrics)" },
];

const WRITE_TIMEOUT_MS = 30000;

export type Phase3Deps = {
  client: BridgeClient;
  gate: BridgeGate;
  tools: Tools;
  map: ParamMap;
  ask: (question: string) => Promise<Answer>;
  /** Show the prompt and return the line typed (trimmed), or null if input ended. */
  prompt: (text: string) => Promise<string | null>;
  say: (line: string) => void;
  collectChat: (since: Date) => ChatLogs;
  /** Save a golden JPEG; returns the saved file's name. */
  saveGolden: (fixture: string, jpeg: Buffer) => string;
  connectTimeoutMs?: number;
  now?: () => Date;
};

type Json = Record<string, unknown>;
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const errorBody = (err: unknown): Json => (err instanceof ToolError ? err.body() : { message: describeError(err) });

/** AC-4 on every pass of a session log: clipping within the session's limits after the pass. */
export function clipCheck(log: SessionLogData): { ok: boolean; passes: Array<{ n: number; clip_high_pct: number; clip_low_pct: number; ok: boolean }> } {
  const passes = log.passes.map((p) => {
    const m = p.metrics_after;
    return { n: p.n, clip_high_pct: m.clip_high_pct, clip_low_pct: m.clip_low_pct, ok: m.clip_high_pct <= log.guardrails.clip_high_pct && m.clip_low_pct <= log.guardrails.clip_low_pct };
  });
  return { ok: passes.every((p) => p.ok), passes };
}

/** What the chat's tool log shows: a session on the golden-hour intent, 1-4 passes, accepted. */
export function evaluateChat(records: Array<Record<string, unknown>>): {
  tool_calls: Array<{ ts: unknown; tool: unknown; ok: unknown; error_code?: unknown }>;
  session_begun: boolean;
  intent_id: string | null;
  passes: number;
  session_ended: string | null;
  snapshot_name: string | null;
} {
  const tool_calls = records.map((r) => ({
    ts: r["ts"],
    tool: r["tool"],
    ok: r["ok"],
    ...(r["error"] ? { error_code: (r["error"] as { code?: unknown }).code } : {}),
  }));
  const begin = records.find((r) => r["tool"] === "lr_begin_session" && r["ok"] === true);
  const sessionId = begin?.["session_id"];
  const steps = records.filter((r) => r["tool"] === "lr_step" && r["ok"] === true && r["session_id"] === sessionId);
  const end = records.find((r) => r["tool"] === "lr_end_session" && r["ok"] === true && r["session_id"] === sessionId);
  const snapshot = begin?.["snapshot"] as { name?: unknown } | undefined;
  return {
    tool_calls,
    session_begun: begin !== undefined,
    intent_id: typeof begin?.["intent_id"] === "string" ? begin["intent_id"] : null,
    passes: steps.length,
    session_ended: typeof end?.["outcome"] === "string" ? end["outcome"] : null,
    snapshot_name: typeof snapshot?.name === "string" ? snapshot.name : null,
  };
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

export async function runPhase3Check(deps: Phase3Deps): Promise<{ accepted: boolean; results: Json }> {
  const { client, gate, tools, map, ask, say } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();
  const errors: string[] = [];
  const fixtures: Json[] = [];
  const results: Json = { check: "phase3", started_at: startedAt.toISOString(), errors, fixtures };
  const passDurations: number[] = [];
  const fail = (message: string): void => {
    errors.push(message);
    say(`FAILED: ${message}`);
  };

  say("LrC-AVG Phase 3 check");
  say("Part 1: the engine runs scripted sessions on the six fixtures. Connecting...");
  if (!(await gate.start())) {
    results["summary"] = { acceptance_suggestion: "FAILED", lock: "busy" };
    fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return { accepted: false, results };
  }
  const t0 = Date.now();
  try {
    results["hello"] = await client.waitConnected(deps.connectTimeoutMs ?? 20000);
    results["connect_ms"] = Date.now() - t0;
  } catch (err) {
    await gate.release();
    results["summary"] = { acceptance_suggestion: "FAILED", connected: false };
    fail(`could not connect to Lightroom (${client.stats.last_drop_reason ?? client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return { accepted: false, results };
  }
  const pluginVersion = (results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (pluginVersion !== REQUIRED_PLUGIN_VERSION) {
    await gate.release();
    results["summary"] = { acceptance_suggestion: "FAILED", plugin_version: pluginVersion };
    fail(`Lightroom is running LrC-AVG plugin ${String(pluginVersion)}, not ${REQUIRED_PLUGIN_VERSION}. Restart Lightroom and run the command again.`);
    return { accepted: false, results };
  }
  say(`Connected (${String(results["connect_ms"])} ms, plugin ${REQUIRED_PLUGIN_VERSION}).`);

  let firstDone = false;
  let lastHistory: string[] = [];
  try {
    for (const [index, name] of FIXTURES.entries()) {
      const fx: Json = { name, status: "not run" };
      fixtures.push(fx);
      say("");
      say(`Photo ${index + 1} of ${FIXTURES.length}: ${name}`);
      const selected = await selectFixture(deps, name, fx);
      if (!selected) continue;
      try {
        await runFixture(deps, name, fx, !firstDone, passDurations);
        firstDone = true;
        lastHistory = (fx["history_names"] as string[] | undefined) ?? lastHistory;
      } catch (err) {
        fx["status"] = "error";
        fx["error"] = errorBody(err);
        fail(`${name}: ${describeError(err)}`);
        await closeOpenSession(deps, fx);
      }
    }
  } finally {
    results["bridge_stats"] = { ...client.stats };
    await gate.release(); // leave the bridge to Claude Desktop's engine for Part 2
  }

  // The questions about Part 1.
  const done = fixtures.filter((f) => f["status"] === "done");
  let part1Jim = false;
  if (done.length > 0) {
    say("");
    say("Two questions. Look at Lightroom's Develop module.");
    const example = lastHistory.find((h) => / pass 1\//.test(h)) ?? "AVG <6 letters and digits> pass 1/4";
    const history = await ask(`1. In the History panel (left side) of the photo on screen, are there steps named like "${example}", "... pass 2/4" and so on?`);
    const restored = await ask("2. Click through the six photos in the Filmstrip. Does each one look as it did before the check?");
    results["jim_part1"] = { history_steps_seen: history, photos_look_as_before: restored };
    part1Jim = history === "y" && restored === "y";
  }

  const all = <T>(key: string, test: (v: T) => boolean): boolean => done.length > 0 && done.every((f) => test(f[key] as T));
  const ac2 = all<{ ok: boolean }>("ac2", (v) => v?.ok === true);
  const ac4 = all<{ ok: boolean }>("ac4", (v) => v?.ok === true);
  const ac5 = all<{ ok: boolean }>("ac5", (v) => v?.ok === true);
  const scripted = all<{ ok: boolean }>("session_a", (v) => v?.ok === true);
  const putBack = all<{ ok: boolean }>("put_back", (v) => v?.ok === true);
  const allSix = done.length === FIXTURES.length;

  // Part 2: the chat.
  let chatOk = false;
  let chatPutBack = false;
  if (errors.length === 0 && allSix && scripted && putBack) {
    say("");
    say("Part 2: the chat in Claude Desktop.");
    say(`  1. In Lightroom's Filmstrip, click ${CHAT_FIXTURE} (stay in the Develop module).`);
    say("  2. Start Claude Desktop (Start menu > Claude).");
    say("  3. Open a new chat, type this sentence and press Enter:");
    say(`       ${CHAT_PROMPT}`);
    say("  4. If Claude Desktop asks whether Claude may use an lrc-avg tool, allow it (Always allow).");
    say("  5. Wait until Claude says it has finished and has ended the session.");
    const chatStart = now();
    results["chat_started_at"] = chatStart.toISOString();
    const entered = await deps.prompt("  6. Come back to this window and press Enter.");
    if (entered === null) {
      errors.push("input ended before the chat was done");
    } else {
      const steps = await ask("3. While Claude worked, did steps named like \"AVG ... pass 1/4\" appear in the History panel?");
      const sliders = await ask("4. Are Claude's changes visible on the Develop sliders (for example Exposure or Highlights in the Basic panel)?");
      const look = await ask("5. Does the result look like a sensible golden-hour landscape edit to you?");
      results["jim_part2"] = { history_steps_seen: steps, settings_on_sliders: sliders, looks_golden_hour: look };
      const logs = deps.collectChat(chatStart);
      const evaluation = evaluateChat(logs.engine_log.records);
      results["chat"] = {
        desktop_log: logs.desktop_log,
        engine_log: { found: logs.engine_log.found, saved_as: logs.engine_log.saved_as, records: logs.engine_log.records.length },
        ...evaluation,
      };
      say(`Chat log: Claude Desktop's MCP log ${logs.desktop_log.found ? `found (${logs.desktop_log.lines} lines)` : "NOT found"}; ` +
        `engine tool log ${logs.engine_log.found ? `found (${logs.engine_log.records.length} calls)` : "NOT found"}.`);
      say(`  session begun: ${evaluation.session_begun ? `YES (${String(evaluation.intent_id)})` : "NO"}; passes: ${evaluation.passes}; ended: ${evaluation.session_ended ?? "NO"}`);
      chatOk =
        steps === "y" && sliders === "y" && evaluation.session_begun && evaluation.intent_id === INTENT_A &&
        evaluation.passes >= 1 && evaluation.passes <= 4 && evaluation.session_ended === "accept";
      const snapshotName = evaluation.snapshot_name ?? "AVG pre-session ... (the newest one)";
      say("");
      say(`Last step: in the Snapshots panel (left side of Develop), click "${snapshotName}". That puts the photo back as it was before the chat.`);
      chatPutBack = (await ask(`6. Did you click "${snapshotName}", and does the photo now look as before the chat?`)) === "y";
      results["jim_part2"] = { ...(results["jim_part2"] as Json), photo_put_back_after_chat: chatPutBack ? "y" : "n" };
    }
  } else {
    say("");
    say("Part 2 (the chat) was skipped because Part 1 did not pass on all six photos. Tell Claude Code what this window says.");
  }

  const within = passDurations.filter((d) => d <= PASS_BUDGET_MS).length;
  const ac1 = scripted && allSix && part1Jim && chatOk;
  const accepted = ac1 && ac2 && ac4 && ac5 && putBack && chatPutBack;
  results["summary"] = {
    acceptance_suggestion: accepted ? "WORKED" : "FAILED",
    fixtures_done: done.length,
    fixtures_skipped: fixtures.filter((f) => f["status"] === "skipped").map((f) => f["name"]),
    ac1_scripted_sessions: scripted,
    ac1_chat: chatOk,
    ac2_revert: ac2,
    ac4_clipping: ac4,
    ac5_log_and_replay: ac5,
    photos_put_back: putBack,
    jim_part1_confirmed: part1Jim,
    photo_put_back_after_chat: chatPutBack,
    pass_ms: { n: passDurations.length, median: Math.round(median(passDurations)), within_budget: within },
  };
  results["finished_at"] = now().toISOString();
  const yn = (b: boolean): string => (b ? "YES" : "NO");
  say("");
  say(`Phase 3 acceptance: ${accepted ? "WORKED" : "FAILED"}`);
  say(`  photos done: ${done.length} of ${FIXTURES.length}; scripted sessions: ${yn(scripted)}; AC-2 revert within 1 s and exact: ${yn(ac2)}; ` +
    `AC-4 clipping within limits on every pass: ${yn(ac4)}; AC-5 log, recipe and replay: ${yn(ac5)}`);
  say(`  photos put back after the check: ${yn(putBack)}; your answers in part 1: ${part1Jim ? "both yes" : "not both yes"}; ` +
    `chat (AC-1): ${yn(chatOk)}; photo put back after the chat: ${yn(chatPutBack)}`);
  // The pass budget is a measurement, not part of the acceptance lines, so it has its own headline.
  say(`Pass budget: ${within} of ${passDurations.length} passes within ~${PASS_BUDGET_MS / 1000} s (median ${Math.round(median(passDurations))} ms).`);
  return { accepted, results };
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
    deps.say(`  The open session was ended with revert (photo put back: ${(end.json["revert"] as { differing: string[] }).differing.length === 0 ? "YES" : "NO"}).`);
  } catch (err) {
    fx["closed_after_error"] = { session_id: open.id, error: errorBody(err) };
    deps.say(`  The open session could not be ended: ${describeError(err)}. Tell Claude Code.`);
  }
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

async function runFixture(deps: Phase3Deps, name: string, fx: Json, first: boolean, passDurations: number[]): Promise<void> {
  const { client, tools, map, say } = deps;
  const photo = fx["photo"] as Json;
  const uuid = String(photo["uuid"]);
  if (photo["settings_error"]) throw new Error(`the photo's settings cannot be read (${JSON.stringify(photo["settings_error"])})`);
  const history: string[] = [];
  fx["history_names"] = history;

  // 1. The golden JPEG: the photo as it is.
  const golden = await tools.getPreview({ long_edge: 1600 });
  const goldenFile = deps.saveGolden(name, golden.image as Buffer);
  fx["golden"] = { saved_as: goldenFile, preview_hash: golden.json["preview_hash"], width: golden.json["width"], height: golden.json["height"], bytes: golden.json["bytes"], metrics: golden.json["metrics"] };
  say(`  Golden JPEG saved (${String(golden.json["width"])}x${String(golden.json["height"])}).`);

  // 2. Session A: pass 0, the scripted passes, accept.
  const a: Json = { ok: false, passes: [] as Json[] };
  fx["session_a"] = a;
  const begin = await tools.beginSession({ intent_id: INTENT_A, return_image: "none" });
  const sid = String(begin.json["session_id"]);
  history.push(...((begin.json["history_names"] as string[] | undefined) ?? []));
  a["session_id"] = sid;
  a["pass0"] = { history_names: begin.json["history_names"], applied: begin.json["pass0_applied"], guardrail_actions: begin.json["guardrail_actions"], metrics: brief(begin.json["metrics"]) };
  say(`  Session A (${INTENT_A}): pass 0 done, ${summary(begin.json)}`);
  for (const step of SCRIPT) {
    const pass: Json = { requested: step.settings };
    (a["passes"] as Json[]).push(pass);
    try {
      const out = await tools.step({ session_id: sid, settings: step.settings, rationale: step.rationale, return_image: "none" });
      history.push(...((out.json["history_names"] as string[] | undefined) ?? []));
      Object.assign(pass, {
        pass: out.json["pass"],
        history_names: out.json["history_names"],
        applied: out.json["applied"],
        clamped: out.json["clamped"],
        refused: out.json["refused"],
        guardrail_actions: out.json["guardrail_actions"],
        converged_by_metrics: out.json["converged_by_metrics"],
        cap_reached: out.json["cap_reached"],
        metrics: brief(out.json["metrics"]),
        total_ms: (out.json["timings"] as { total_ms?: number } | undefined)?.total_ms ?? null,
      });
      say(`  ${String(out.json["pass"])}: ${summary(out.json)}`);
      if (out.json["converged_by_metrics"] === true || out.json["cap_reached"] === true) break;
    } catch (err) {
      pass["error"] = errorBody(err);
      say(`  pass refused: ${describeError(err)}`);
      const code = err instanceof ToolError ? err.code : "";
      if (code !== "GUARDRAIL_REFUSED" && code !== "NO_CHANGE") throw err;
    }
  }
  const end = await tools.endSession({ session_id: sid, outcome: "accept" });
  const logPath = String(end.json["log_path"]);
  const recipePath = String(end.json["recipe_path"]);
  a["log_path"] = logPath;
  a["recipe_path"] = recipePath;

  // The log and the recipe against their schemas; AC-4 on every pass; the pass times.
  const parsedLog = sessionLogSchema.safeParse(readJson(logPath));
  const parsedRecipe = recipeSchema.safeParse(readJson(recipePath));
  const stepsDone = parsedLog.success ? parsedLog.data.passes.filter((p) => p.kind === "step").length : 0;
  a["ok"] = parsedLog.success && stepsDone >= 1 && stepsDone <= 4;
  a["steps_done"] = stepsDone;
  const ac4 = parsedLog.success ? clipCheck(parsedLog.data) : { ok: false, passes: [] };
  fx["ac4"] = ac4;
  if (parsedLog.success) for (const p of parsedLog.data.passes) if (p.kind === "step") passDurations.push(p.duration_ms);
  say(`  Session A accepted: log valid ${parsedLog.success ? "YES" : "NO"}, recipe valid ${parsedRecipe.success ? "YES" : "NO"}; AC-4 on every pass: ${ac4.ok ? "YES" : "NO"}`);

  // AC-5 (decision 1): the pre-session snapshot, then the recipe as one write, read back.
  const ac5: Json = { ok: false, log_valid: parsedLog.success, recipe_valid: parsedRecipe.success };
  fx["ac5"] = ac5;
  if (!parsedLog.success) ac5["log_issues"] = parsedLog.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
  if (!parsedRecipe.success) ac5["recipe_issues"] = parsedRecipe.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`);
  const putBack: Json = { ok: false };
  fx["put_back"] = putBack;
  // The session's snapshot from lr_begin_session's result, so the photo is put back even when the
  // log does not validate.
  const snapshotId = String((begin.json["snapshot"] as { id?: unknown } | undefined)?.id ?? "");
  if (parsedLog.success && parsedRecipe.success) {
    const recipe = parsedRecipe.data;
    await client.request("apply_snapshot", { target_uuid: uuid, snapshot_id: snapshotId }, { timeoutMs: WRITE_TIMEOUT_MS });
    const sdk = map.toSdk(recipe.settings, { processVersion: recipe.process_version });
    const replayed = await client.request("apply_settings", { target_uuid: uuid, settings: sdk, history_name: REPLAY_HISTORY_NAME }, { timeoutMs: WRITE_TIMEOUT_MS });
    history.push(REPLAY_HISTORY_NAME);
    const view = map.fromSdk(replayed.read_back).settings;
    const keys = new Set([...Object.keys(view), ...Object.keys(recipe.settings)]);
    const differing = [...keys].filter((k) => !same(view[k], recipe.settings[k])).sort();
    Object.assign(ac5, { replay_differing: differing, readback_mismatches: map.verifyReadback(sdk, replayed.read_back).map((m) => m.sdk_key), ok: differing.length === 0 });
    say(`  AC-5 replay of the recipe after the snapshot: ${differing.length === 0 ? "exact" : `${differing.length} setting(s) differ: ${differing.join(", ")}`}`);
  }
  // Leave the photo as it was: the pre-session snapshot again, compared with the settings before pass 0.
  const back = await client.request("apply_snapshot", { target_uuid: uuid, snapshot_id: snapshotId }, { timeoutMs: WRITE_TIMEOUT_MS });
  const start = (fx["start_settings"] ?? {}) as Record<string, unknown>;
  const now = map.fromSdk(back.read_back).settings;
  const all = new Set([...Object.keys(now), ...Object.keys(start)]);
  const off = [...all].filter((k) => !same(now[k], start[k])).sort();
  Object.assign(putBack, { ok: off.length === 0, differing: off });

  // First fixture: a region crop, with the context's size.
  if (first) {
    try {
      const crop = await tools.getPreview({ long_edge: 800, region: REGION });
      fx["region"] = {
        region: REGION,
        export_long_edge: crop.json["export_long_edge"],
        width: crop.json["width"],
        height: crop.json["height"],
        effective_scale: crop.json["effective_scale"],
        scale_in_export: crop.json["scale_in_export"],
        context_width: photo["width"],
        context_height: photo["height"],
        timings: crop.json["timings"],
      };
      say(`  Region crop: export ${String(crop.json["export_long_edge"])} px, effective scale ${String(crop.json["effective_scale"])}.`);
    } catch (err) {
      fx["region"] = { error: errorBody(err) };
      say(`  Region crop FAILED: ${describeError(err)}`);
    }
  }

  // 3. Session B: a probe, (first fixture) the selection guard, one pass, revert.
  const b: Json = {};
  fx["session_b"] = b;
  const beginB = await tools.beginSession({ intent_id: INTENT_B, return_image: "none" });
  const sidB = String(beginB.json["session_id"]);
  history.push(...((beginB.json["history_names"] as string[] | undefined) ?? []));
  b["session_id"] = sidB;
  try {
    const probe = await tools.probe({ session_id: sidB, sliders: ["exposure", "whites"], magnitude: 0.5 });
    history.push(...((probe.json["history_names"] as string[] | undefined) ?? []));
    b["probe"] = { results: probe.json["results"], history_names: probe.json["history_names"], total_ms: (probe.json["timings"] as { total_ms?: number } | undefined)?.total_ms };
    say(`  Session B (${INTENT_B}): probe done (${(probe.json["history_names"] as string[]).length} History steps).`);
  } catch (err) {
    b["probe"] = { error: errorBody(err) };
    say(`  Probe FAILED: ${describeError(err)}`);
  }
  if (first) {
    const guard: Json = {};
    b["selection_guard"] = guard;
    const other = await deps.prompt(`  Click any OTHER photo in the Filmstrip (not ${name}), then press Enter.`);
    if (other !== null) {
      try {
        await tools.step({ session_id: sidB, settings: { shadows: 5 }, rationale: "check: another photo is selected", return_image: "none" });
        Object.assign(guard, { ok: false, note: "the pass was written although another photo was selected" });
      } catch (err) {
        Object.assign(guard, { ok: err instanceof ToolError && err.code === "TARGET_CHANGED", error: errorBody(err) });
      }
      say(`  Selection guard: pass refused while another photo was selected: ${guard["ok"] === true ? "YES" : "NO"}`);
      // Back to the fixture, checked, so the rest of session B (and its revert) reaches this photo.
      let back = false;
      for (let attempt = 1; attempt <= 3 && !back; attempt++) {
        const line = await deps.prompt(attempt === 1 ? `  Click ${name} again, then press Enter.` : `  The selected photo is not ${name}. Click ${name}, then press Enter.`);
        if (line === null) break;
        back = (await tools.getActivePhotoContext()).json["filename"] === name;
      }
      if (!back) throw new Error(`${name} was not selected again after the selection-guard step`);
    }
  }
  // Shadows, not exposure: after the probe, its slope may (rightly) refuse an exposure increase
  // [handle: Claude Code, 2026-09-26, the first run of tests\phase3-check.test.ts: "Nothing was
  // written: every change was refused (exposure: the probe's slope projects a clipping breach ...)"].
  const stepB = await tools.step({ session_id: sidB, settings: { shadows: 10 }, rationale: "scripted pass before the revert", return_image: "none" });
  history.push(...((stepB.json["history_names"] as string[] | undefined) ?? []));
  const endB = await tools.endSession({ session_id: sidB, outcome: "revert" });
  const revert = endB.json["revert"] as { ms: number; differing: string[] };
  b["revert"] = revert;
  const ac2 = { ok: revert.ms <= REVERT_BUDGET_MS && revert.differing.length === 0, ms: revert.ms, differing: revert.differing };
  fx["ac2"] = ac2;
  say(`  Session B reverted in ${revert.ms} ms (AC-2: within 1 s and exact: ${ac2.ok ? "YES" : "NO"}).`);
  fx["status"] = "done";
}

function brief(metrics: unknown): Json {
  const m = (metrics ?? {}) as Json;
  return { luma_mean: m["luma_mean"], clip_high_pct: m["clip_high_pct"], clip_low_pct: m["clip_low_pct"] };
}

function summary(json: Json): string {
  const m = brief(json["metrics"]);
  const actions = (json["guardrail_actions"] as Array<{ kind: string }> | undefined) ?? [];
  const refused = (json["refused"] as unknown[] | undefined) ?? [];
  return `luma ${String(m["luma_mean"])}, clipping ${String(m["clip_high_pct"])} % / ${String(m["clip_low_pct"])} %` +
    `${refused.length ? `, ${refused.length} refused` : ""}${actions.length ? `, guardrail: ${actions.map((x) => x.kind).join(", ")}` : ""}` +
    `${json["converged_by_metrics"] === true ? ", converged" : ""}`;
}
