// Phase 4 acceptance check (PHASES.md Phase 4; PHASE4_PLAN row 10; plan approved by Jim 2026-09-28
// with five decisions [stated: "Go"]). The command-line entry is phase4-check-cli.ts
// (`npm run phase4:check`); this module runs the steps, so tests\phase4-check.test.ts can run them
// against the simulated plugin. The fixed values are in phase4-config.ts.
//
// Part 1 is scripted (no Claude) and runs through the same Tools class as the MCP server, on one
// photo that Jim selects (phase4-config.ts PHOTO):
//   1. four virtual copies (phase4-copies.ts);
//   2. session A, a Converge session: the AC-4 fix verified on this photo (phase4-converge.ts);
//   3. the burst sync with adaptive exposure, AC-5's replay through lr_sync_series, a write to the
//      photo while a copy is selected; then the photo put back (phase4-sync.ts);
//   4. AC-3: a Variants session, Jim looks at the copies and picks (phase4-variants.ts);
//   5. the preset from the pick, a Lightroom restart, listed (y/n), applied by Jim's click and read
//      back (phase4-preset.ts).
// Part 2 is Variants in a Claude Desktop chat (phase4-chat.ts). The cleanup runs in every case
// (phase4-cleanup.ts). AC-4 counts every pass of session A, the Variants session and the chat's
// (clip-check.ts, PHASE4_PLAN decision 1). Jim answers y/n in this window, as in Phases 1-3.

import { pluginVersionAtLeast } from "../bridge/version.js";
import { clipCheckAll, describeClip, type SessionClip } from "./clip-check.js";
import { describeError } from "./phase1-check.js";
import { yn } from "./phase3-config.js";
import { runChat, type ChatOutcome } from "./phase4-chat.js";
import { cleanup, type CleanupOutcome } from "./phase4-cleanup.js";
import { MASTER, MIN_PLUGIN_VERSION, PHOTO, SYNC_COPIES, closeOpenSession, select, settingsOf, type Json, type Phase4Deps, type Photo, type Run } from "./phase4-config.js";
import { converge, type Converged } from "./phase4-converge.js";
import { makeCheckCopies } from "./phase4-copies.js";
import { presetCheck } from "./phase4-preset.js";
import { ac5Replay, putMasterBack, syncBurst, unselectedOriginal } from "./phase4-sync.js";
import { variantsSession, type VariantsOutcome } from "./phase4-variants.js";

export type { Answer, Phase4Deps } from "./phase4-config.js";

type Part1 = { converged: Converged | null; variants: VariantsOutcome; preset: { made: boolean; listed: boolean; applies: boolean } };
const NO_PART1: Part1 = { converged: null, variants: { picked: null, clip: null }, preset: { made: false, listed: false, applies: false } };

export async function runPhase4Check(deps: Phase4Deps): Promise<{ accepted: boolean; results: Json }> {
  const now = deps.now ?? (() => new Date());
  const errors: string[] = [];
  const results: Json = { check: "phase4", started_at: now().toISOString(), photo_name: PHOTO, errors };
  const run: Run = { results, errors, copies: [], masterSnapshot: null, preset: null, fail: (m) => {
    errors.push(m);
    deps.say(`FAILED: ${m}`);
  } };
  deps.say("LrC-AVG Phase 4 check");
  deps.say("Part 1: the engine runs scripted steps on one photo. Connecting...");
  if (!(await connect(deps, run))) return { accepted: false, results };
  let chat: ChatOutcome | null = null;
  let released = false;
  let photo: Photo | null = null;
  let part1 = NO_PART1;
  try {
    photo = await selectPhoto(deps, run);
    if (photo) part1 = await runPart1(deps, run, photo);
    if (photo && errors.length === 0 && (await readyForChat(deps, run, photo))) {
      results["bridge_stats"] = { ...deps.client.stats };
      await deps.gate.release(); // leave the bridge to Claude Desktop's engine
      released = true;
      chat = await runChat(deps, run);
    } else {
      deps.say("");
      deps.say("Part 2 (the chat) was skipped because Part 1 did not pass. The cleanup follows.");
    }
  } catch (err) {
    run.fail(`the check stopped: ${describeError(err)}`);
    await closeOpenSession(deps, results); // a session left open would keep the photo edited
  }
  const tidy = await cleanup(deps, run, photo, released);
  results["bridge_stats_end"] = { ...deps.client.stats };
  await deps.gate.release();
  return finish(deps, run, now, part1, chat, tidy);
}

/** Take the bridge and connect to Lightroom's plugin (as phase3-check.ts). False, with the reason said, when it cannot. */
async function connect(deps: Phase4Deps, run: Run): Promise<boolean> {
  if (!(await deps.gate.start())) {
    run.results["summary"] = { acceptance_suggestion: "FAILED", lock: "busy" };
    run.fail("another LrC-AVG engine is using the Lightroom bridge. Quit Claude Desktop: right-click the Claude icon in the Windows system tray > Quit. Then run the command again.");
    return false;
  }
  const started = Date.now();
  try {
    run.results["hello"] = await deps.client.waitConnected(deps.connectTimeoutMs ?? 20000);
    run.results["connect_ms"] = Date.now() - started;
  } catch (err) {
    await deps.gate.release();
    run.results["summary"] = { acceptance_suggestion: "FAILED", connected: false };
    run.fail(`could not connect to Lightroom (${deps.client.stats.last_drop_reason ?? deps.client.stats.last_connect_error ?? describeError(err)}). ` +
      "Check that Lightroom is open and that File > Plug-in Manager lists LrC-AVG as Enabled, then run the command again.");
    return false;
  }
  const version = (run.results["hello"] as { plugin_version?: unknown }).plugin_version;
  if (!pluginVersionAtLeast(version, MIN_PLUGIN_VERSION)) {
    await deps.gate.release();
    run.results["summary"] = { acceptance_suggestion: "FAILED", plugin_version: version };
    run.fail(`Lightroom is running LrC-AVG plugin ${String(version)}, not ${MIN_PLUGIN_VERSION} or later. Restart Lightroom and run the command again.`);
    return false;
  }
  deps.say(`Connected (${String(run.results["connect_ms"])} ms, plugin ${String(version)}).`);
  return true;
}

/** Jim selects the photo (the original, not a copy); its settings before the check are read. Null after three tries. */
async function selectPhoto(deps: Phase4Deps, run: Run): Promise<Photo | null> {
  let text = `  In Lightroom's Filmstrip, click ${PHOTO} (the original, not a virtual copy; stay in the Develop module). Then press Enter here.`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    if ((await deps.prompt(text)) === null) break;
    const ctx = await deps.client.request("get_context", {});
    if (ctx["filename"] === PHOTO && ctx["is_virtual_copy"] !== true) {
      const view = await settingsOf(deps, ctx.uuid);
      run.results["photo"] = { uuid: ctx.uuid, local_id: ctx.local_id, process_version: view.process_version, camera_profile: view.camera_profile, start_settings: view.settings };
      return { uuid: ctx.uuid, local_id: ctx.local_id, process_version: view.process_version, start: view.settings };
    }
    const which = ctx["is_virtual_copy"] === true ? `a virtual copy ("${String(ctx["copy_name"])}")` : String(ctx["filename"]);
    text = `  The selected photo is ${which}, not ${PHOTO}. Click ${PHOTO} (the original), then press Enter.`;
  }
  run.fail(`${PHOTO} was not selected`);
  return null;
}

/** Part 1's steps in order; a step that needs an earlier one's result is skipped when that one failed. */
async function runPart1(deps: Phase4Deps, run: Run, photo: Photo): Promise<Part1> {
  const copies = await makeCheckCopies(deps, run, photo);
  await select(deps, photo.uuid, MASTER); // the sessions work on the selected photo
  const converged = await converge(deps, run);
  try {
    if (converged && copies) {
      await syncBurst(deps, run, photo, converged, copies);
      await ac5Replay(deps, run, converged, copies);
      await unselectedOriginal(deps, run, photo, converged, copies);
    }
  } finally {
    await putMasterBack(deps, run, photo);
  }
  const variants = await variantsSession(deps, run, photo);
  const target = copies ? { uuid: copies.sync[0] as string, copy_name: SYNC_COPIES[0] } : null;
  const preset = variants.picked ? await presetCheck(deps, run, photo, variants.picked, target) : NO_PART1.preset;
  return { converged, variants, preset };
}

/** Before the chat: the photo selected again, since the chat's Variants session begins on the selected photo. */
async function readyForChat(deps: Phase4Deps, run: Run, photo: Photo): Promise<boolean> {
  try {
    await select(deps, photo.uuid, MASTER);
    return true;
  } catch (err) {
    run.fail(`the photo could not be selected for the chat: ${describeError(err)}`);
    return false;
  }
}

const okOf = (v: unknown): boolean => (v as { ok?: unknown } | undefined)?.ok === true;

/** The summary in the results and the headlines in the window. */
function finish(deps: Phase4Deps, run: Run, now: () => Date, p: Part1, chat: ChatOutcome | null, tidy: CleanupOutcome): { accepted: boolean; results: Json } {
  const r = run.results;
  const sessions = [p.converged?.clip, p.variants.clip, chat?.ac4].filter((c): c is SessionClip => c !== null && c !== undefined);
  const clip = clipCheckAll(sessions);
  const lines = {
    ac3_variants_scripted: okOf(r["variants"]),
    ac3_chat: chat?.ok === true,
    sync_burst_within_2: okOf(r["sync_burst"]),
    ac5_log_and_sync_replay: p.converged !== null && okOf(r["ac5_sync"]),
    // Every session must have been counted: A, the Variants session and the chat's.
    ac4_clipping: clip.ok && p.converged !== null && p.variants.clip !== null && (chat?.ac4 ?? null) !== null,
    preset_listed_after_restart: p.preset.listed,
    preset_applies: p.preset.applies,
    unselected_original_write: okOf(r["unselected_original"]),
    photo_put_back: okOf(r["put_back"]),
  };
  const accepted = Object.values(lines).every(Boolean);
  const also = { copies_start_as_master: okOf((r["copies"] as Json | undefined)?.["start_as_master"]), contact_sheet_letters_readable: chat?.sheetReadable ?? null };
  r["summary"] = { acceptance_suggestion: accepted ? "WORKED" : "FAILED", ...lines, ac4_sessions: clip.sessions.map((s) => s.session), ...also, cleanup: tidy };
  r["finished_at"] = now().toISOString();
  const { say } = deps;
  say("");
  say(`Phase 4 acceptance: ${accepted ? "WORKED" : "FAILED"}`);
  say(`  AC-3 Variants (scripted): ${yn(lines.ac3_variants_scripted)}; AC-3 in the chat: ${yn(lines.ac3_chat)}; burst sync within ±2/255: ${yn(lines.sync_burst_within_2)}; AC-5 recipe synced onto a copy: ${yn(lines.ac5_log_and_sync_replay)}`);
  say(`  AC-4 on every pass of every session (${clip.sessions.map((s) => s.session).join(", ") || "none"}): ${describeClip(clip)}; preset listed after the restart: ${yn(lines.preset_listed_after_restart)}; preset applies: ${yn(lines.preset_applies)}`);
  say(`  write to the photo while a copy was selected: ${yn(lines.unselected_original_write)}; photo put back after Part 1: ${yn(lines.photo_put_back)}`);
  say(`Also recorded: new copies start with the photo's settings: ${yn(also.copies_start_as_master)}; contact sheet letters readable: ${also.contact_sheet_letters_readable === null ? "not asked" : yn(also.contact_sheet_letters_readable)}.`);
  say(`Cleanup: copies removed ${tidy.copiesGone} of ${tidy.copies}; presets removed ${tidy.presetsGone} of ${tidy.presets}; photo as before the check: ${tidy.masterAsBefore === null ? "not checked" : yn(tidy.masterAsBefore)}.`);
  return { accepted, results: r };
}
