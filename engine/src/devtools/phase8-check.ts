// Phase 8 acceptance check (PHASES.md Phase 8; PHASE8_PLAN row 6; plan approved by Jim 2026-10-10 with
// D1-D4 A [stated: "Go"]). The command-line entry is phase8-check-cli.ts (`npm run phase8:check`); this
// module runs the parts, so tests\phase8-check.test.ts can run them against the simulated plugin.
//   Part 1 (phase8-photos.ts): every photo of the "fixtures" collection: a session, two passes, an
//          exact revert, a sync onto the next photo of its pipeline, a preset; unattended.
//   Part 2 (phase8-intents.ts): the 11 bundled intents on DSC_0031.JPG (Copy 1); unattended.
//   Part 3 (phase8-cross.ts): a raw→rendered sync, and the preset Part 4 applies; unattended.
//   Part 4 (phase8-presets.ts): a Lightroom restart, the preset listed (y/n) and applied by Jim's click.
//   Part 5 (phase8-chat.ts): one Claude Desktop chat on the JPEG.
//   Cleanup (phase8-cleanup.ts): row 5's presets and snapshot, the check's preset.
// It resumes (phase8-state.ts): run again after a stop, it puts back any photo left mid-write, then
// skips what it has recorded. Jim answers y/n in this window, as in Phases 1-7.

import { pluginVersionAtLeast } from "../bridge/index.js";
import { describeError } from "./phase1-check.js";
import { closeOpenSession } from "./phase4-config.js";
import { chatPart } from "./phase8-chat.js";
import { cleanup, type CleanupOutcome } from "./phase8-cleanup.js";
import { MIN_PLUGIN_VERSION, JPEG, RAW_SOURCE, putBackAll, type Fixture, type Json, type Phase8Deps, type Run } from "./phase8-config.js";
import { crossPart } from "./phase8-cross.js";
import { intentsPart } from "./phase8-intents.js";
import { listFixtures, photosPart } from "./phase8-photos.js";
import { presetPart } from "./phase8-presets.js";
import { stateToContinue, type CheckState } from "./phase8-state.js";

export type CheckOutcome = { accepted: boolean; finished: boolean; results: Json };

export async function runPhase8Check(deps: Phase8Deps, options: { fresh?: boolean } = {}): Promise<CheckOutcome> {
  const now = deps.now ?? (() => new Date());
  const { state, resumed } = stateToContinue(deps.state.load(), now().toISOString(), options.fresh === true);
  state.runs.push(deps.stamp);
  const errors: string[] = [];
  const results: Json = { check: "phase8", started_at: now().toISOString(), resumed, state_started_at: state.started_at, errors };
  const run: Run = { results, errors, state, save: () => deps.state.save(state), fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  run.save();
  deps.say("LrC-AVG Phase 8 check");
  if (resumed) deps.say(`Continuing the check begun ${state.started_at}: ${progress(state)}.`);
  let tidy: CleanupOutcome | null = null;
  if (await connect(deps, run)) {
    try {
      tidy = await parts(deps, run);
    } catch (err) {
      run.fail(`the check stopped: ${describeError(err)}`);
      await closeOpenSession(deps, results); // a session left open would keep the photo edited
      await putBackAll(deps, run);
    }
  }
  results["bridge_stats"] = { ...deps.client.stats };
  await deps.gate.release();
  return finish(deps, run, tidy);
}

/** The parts in order, each skipped once recorded; the cleanup once all are. Null when the run stopped first. */
async function parts(deps: Phase8Deps, run: Run): Promise<CleanupOutcome | null> {
  const { state } = run;
  if (state.pending.length > 0) {
    deps.say(`The last run stopped with ${state.pending.length} photo(s) not yet put back; putting them back first.`);
    if (!(await putBackAll(deps, run))) {
      deps.say("The check stops here: tell Claude Code.");
      return null;
    }
  }
  const fixtures = await listFixtures(deps, run);
  if (!fixtures) return null;
  const jpeg = fixtures.find((f) => f.filename === JPEG.filename && f.copy_name === JPEG.copy_name);
  const raw = fixtures.find((f) => f.filename === RAW_SOURCE && f.copy_name === null);
  if (!jpeg || !raw) {
    run.fail(`the collection lacks ${jpeg ? RAW_SOURCE : `${JPEG.filename} (${JPEG.copy_name})`}, which Parts 2-5 need`);
    return null;
  }
  await photosPart(deps, run, fixtures);
  await intentsPart(deps, run, jpeg);
  if (!state.cross) await crossPart(deps, run, raw, jpeg);
  if (!state.preset) await presetPart(deps, run);
  if (!state.chat && !(await chatPart(deps, run, jpeg))) return null;
  const tidy = await cleanup(deps, run, jpeg);
  state.finished = true;
  run.save();
  return tidy;
}

/** Take the bridge and connect (as phase5-check.ts); false, with the reason said, when it cannot. */
async function connect(deps: Phase8Deps, run: Run): Promise<boolean> {
  if (!(await deps.gate.start())) {
    run.fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return false;
  }
  try {
    run.results["hello"] = await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
  } catch (err) {
    run.fail(`could not connect to Lightroom (${deps.client.stats.last_drop_reason ?? deps.client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open in the Develop module and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return false;
  }
  const version = (run.results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (!pluginVersionAtLeast(version, MIN_PLUGIN_VERSION)) {
    run.fail(`Lightroom is running LrC-AVG plugin ${String(version)}, not ${MIN_PLUGIN_VERSION} or later. Restart Lightroom and run the command again.`);
    return false;
  }
  deps.say(`Connected (plugin ${String(version)}).`);
  return true;
}

const progress = (s: CheckState): string =>
  `${s.photos.length} photo(s), ${s.intents.length} intent(s) done; raw→rendered sync ${s.cross ? "done" : "to do"}, preset click ${s.preset ? "done" : "to do"}, chat ${s.chat ? "done" : "to do"}`;

/** Per format (file format and pipeline): the photos and how many worked. */
function byFormat(s: CheckState, fixtures: readonly Fixture[]): Record<string, { photos: number; worked: number }> {
  const out: Record<string, { photos: number; worked: number }> = {};
  for (const p of s.photos) {
    const f = fixtures.find((x) => x.uuid === p.uuid);
    const key = `${f?.file_format ?? "?"} ${f?.pipeline ?? "?"}`;
    const e = (out[key] ??= { photos: 0, worked: 0 });
    e.photos++;
    if (p.ok) e.worked++;
  }
  return out;
}

function finish(deps: Phase8Deps, run: Run, tidy: CleanupOutcome | null): CheckOutcome {
  const { state, results } = run;
  const fixtures = (results["fixtures"] as Fixture[] | undefined) ?? [];
  const lines = {
    every_photo: state.photos.length > 0 && state.photos.length >= fixtures.length && state.photos.every((p) => p.ok),
    every_intent: state.intents.length > 0 && state.intents.every((i) => i.ok),
    raw_to_rendered_sync: state.cross?.ok === true,
    preset_click: state.preset?.ok === true,
    chat: state.chat?.ok === true,
  };
  const accepted = state.finished && Object.values(lines).every(Boolean);
  const formats = byFormat(state, fixtures);
  results["summary"] = { acceptance_suggestion: state.finished ? (accepted ? "WORKED" : "FAILED") : "NOT FINISHED", finished: state.finished, ...lines, formats, failed_photos: state.photos.filter((p) => !p.ok).map((p) => p.label), failed_intents: state.intents.filter((i) => !i.ok).map((i) => i.intent), cleanup: tidy, pending: state.pending.map((p) => p.label) };
  results["finished_at"] = (deps.now ?? (() => new Date()))().toISOString();
  const { say } = deps;
  const yn = (b: boolean): string => (b ? "YES" : "NO");
  say("");
  say(`Phase 8 acceptance: ${state.finished ? (accepted ? "WORKED" : "FAILED") : "NOT FINISHED (run the command again to continue)"}`);
  say(`  every photo (${state.photos.filter((p) => p.ok).length} of ${fixtures.length || state.photos.length}): ${yn(lines.every_photo)}; every intent on the JPEG (${state.intents.filter((i) => i.ok).length} of ${state.intents.length}): ${yn(lines.every_intent)}`);
  say(`  raw→rendered sync: ${yn(lines.raw_to_rendered_sync)}; preset listed and applied by a click: ${yn(lines.preset_click)}; Claude Desktop chat: ${yn(lines.chat)}`);
  say(`  by format: ${Object.entries(formats).map(([k, v]) => `${k} ${v.worked}/${v.photos}`).join("; ") || "none yet"}`);
  if (state.pending.length > 0) say(`  NOT put back: ${state.pending.map((p) => `${p.label} (snapshot "${p.snapshot_name}")`).join(", ")}`);
  return { accepted, finished: state.finished, results };
}
