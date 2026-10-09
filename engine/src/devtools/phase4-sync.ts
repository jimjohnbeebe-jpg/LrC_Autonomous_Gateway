// The Phase 4 check's lr_sync_series parts (phase4-check.ts), all from session A's recipe
// (phase4-converge.ts), through the same Tools class as the MCP server:
//   1. the burst (PHASES.md Phase 4, PHASE4_PLAN decision 5): three copies at exposure -1.0, +0.5
//      and +1.0, synced with adaptive exposure; each must end within 2/255 of the source photo's mean
//      luma, measured again afterwards, independently of the sync's own figures (as in
//      tests\sync-adaptive.test.ts). The sync's tries show how luma answers exposure in Lightroom
//      (row 8 left that [unverified]);
//   2. AC-5's second half (PHASES.md Phase 4, "Inputs from Phase 3"): the recipe synced onto the
//      replay copy without adaptive exposure reads back as the recipe's settings;
//   3. a write to an original that is not selected (row 8 left it [unverified]; S7 wrote to a virtual
//      copy [handle: docs\reports\phase4\S7.md Verdict 4]): with the replay copy selected, a
//      one-setting sync onto the photo, read back, then undone with that sync's own snapshot;
//   4. the photo put back with session A's pre-session snapshot, and selected again.

import { canonicalValuesEqual, differingSettings } from "../params/index.js";
import { DEFAULT_LONG_EDGE, PREVIEW_QUALITY } from "../mcp/index.js";
import { yn } from "./phase3-config.js";
import type { CheckCopies } from "./phase4-copies.js";
import type { Converged } from "./phase4-converge.js";
import {
  LUMA_TOLERANCE,
  MASTER,
  ORIGINAL_NUDGE,
  REPLAY_COPY,
  START_EXPOSURES,
  START_HISTORY_NAME,
  WRITE_TIMEOUT_MS,
  copyOf,
  errorBody,
  failLine,
  select,
  settingsOf,
  type Json,
  type Phase4Deps,
  type Photo,
  type Run,
} from "./phase4-config.js";

type SyncTarget = { uuid: string; history_names: string[]; snapshot: { id: string; name: string }; exposure: Json | null; luma: { goal: number; final: number; renders: number; met: boolean; tries: unknown[] } | null };
const targetsOf = (json: Json): SyncTarget[] => (json["targets"] as SyncTarget[] | undefined) ?? [];
const skippedOf = (json: Json): unknown[] => (json["skipped"] as unknown[] | undefined) ?? [];

/** 1. The burst: start exposures, the adaptive sync, and every copy's luma measured again. */
export async function syncBurst(deps: Phase4Deps, run: Run, photo: Photo, a: Converged, copies: CheckCopies): Promise<void> {
  const out: Json = { ok: false, start_exposures: START_EXPOSURES };
  run.results["sync_burst"] = out;
  try {
    for (const [i, uuid] of copies.sync.entries()) {
      const settings = deps.map.toSdk({ exposure: START_EXPOSURES[i] as number }, { processVersion: photo.process_version, pipeline: "raw" });
      await deps.client.request("apply_settings", { photo_uuid: uuid, settings, history_name: START_HISTORY_NAME }, { timeoutMs: WRITE_TIMEOUT_MS });
    }
    const res = (await deps.tools.syncSeries({ source: { session_id: a.sessionId }, targets: { uuids: copies.sync }, adaptive_exposure: true, return_image: "none" })).json;
    const measured = await measureAgain(deps, photo.uuid, copies.sync);
    const targets = targetsOf(res);
    const selection = await deps.client.request("get_selection", { max: 1 });
    const ok = res["applied"] === copies.sync.length && skippedOf(res).length === 0 && targets.every((t) => t.luma?.met === true) && measured.within;
    Object.assign(out, { ok, applied: res["applied"], skipped: res["skipped"], source_luma: res["source_luma"], offsets: res["per_target_exposure_offsets"], targets, measured, selection_kept: selection.photos[0]?.uuid === photo.uuid, total_ms: (res["timings"] as Json | undefined)?.["total_ms"] });
    const lines = targets.map((t, i) => `copy ${i + 1}: ${t.luma ? `${t.luma.final.toFixed(1)} after ${t.luma.renders} renders` : "no luma"}`);
    deps.say(`  Sync with adaptive exposure (source luma ${String(res["source_luma"])}): ${lines.join("; ")}. Within ±${LUMA_TOLERANCE}/255, measured again: ${yn(measured.within)}.`);
    if (!ok) run.fail(`the burst sync did not match the source photo's mean luma within ±${LUMA_TOLERANCE}/255 on every copy (details in sync_burst)`);
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("the burst sync", err));
  }
}

/** The source photo and each copy rendered again as the sync renders them: each copy's luma against the source's. */
async function measureAgain(deps: Phase4Deps, source: string, uuids: readonly string[]): Promise<{ within: boolean; source_luma: number; copies: Json[] }> {
  const luma = async (uuid: string): Promise<number> => (await deps.previews.render({ longEdge: DEFAULT_LONG_EDGE, quality: PREVIEW_QUALITY, photoUuid: uuid })).metrics.luma_mean;
  const goal = await luma(source);
  const copies: Json[] = [];
  for (const uuid of uuids) {
    const value = await luma(uuid);
    copies.push({ uuid, luma: value, difference: Math.round((value - goal) * 100) / 100 });
  }
  return { within: copies.every((c) => Math.abs(c["difference"] as number) <= LUMA_TOLERANCE), source_luma: goal, copies };
}

/** 2. AC-5's second half: the recipe synced onto the replay copy reads back as the recipe. */
export async function ac5Replay(deps: Phase4Deps, run: Run, a: Converged, copies: CheckCopies): Promise<void> {
  const out: Json = { ok: false };
  run.results["ac5_sync"] = out;
  try {
    const res = (await deps.tools.syncSeries({ source: { session_id: a.sessionId }, targets: { uuids: [copies.replay] }, adaptive_exposure: false, return_image: "none" })).json;
    const differing = differingSettings((await settingsOf(deps, copies.replay)).settings, a.recipe.settings);
    const ok = res["applied"] === 1 && differing.length === 0;
    Object.assign(out, { ok, applied: res["applied"], skipped: res["skipped"], history_names: targetsOf(res)[0]?.history_names ?? [], differing });
    deps.say(`  AC-5, the recipe synced onto a virtual copy: ${ok ? "reads back exactly" : `${differing.length} setting(s) differ: ${differing.join(", ") || "(none; see ac5_sync)"}`}`);
    if (!ok) run.fail("AC-5: the recipe synced onto the replay copy does not read back as the recipe");
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("AC-5's sync", err));
  }
}

/** 3. A write to the photo while a copy is selected, read back, then undone with the sync's snapshot. */
export async function unselectedOriginal(deps: Phase4Deps, run: Run, photo: Photo, a: Converged, copies: CheckCopies): Promise<void> {
  const out: Json = { ok: false };
  run.results["unselected_original"] = out;
  try {
    await select(deps, copies.replay, copyOf(photo, REPLAY_COPY));
    const now = Number(a.recipe.settings["vibrance"] ?? 0);
    const vibrance = now + ORIGINAL_NUDGE <= 100 ? now + ORIGINAL_NUDGE : now - ORIGINAL_NUDGE;
    const res = (await deps.tools.syncSeries({ source: { settings: { vibrance } }, targets: { uuids: [photo.uuid] }, adaptive_exposure: false, return_image: "none" })).json;
    const written = canonicalValuesEqual((await settingsOf(deps, photo.uuid)).settings["vibrance"], vibrance);
    const selection = await deps.client.request("get_selection", { max: 1 });
    const t = targetsOf(res)[0];
    if (!t) throw new Error(`the sync onto the photo was not applied (${JSON.stringify(res["skipped"])})`);
    const undone = await deps.client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: t.snapshot.id }, { timeoutMs: WRITE_TIMEOUT_MS });
    const back = differingSettings(deps.map.fromSdk(undone.read_back).settings, a.recipe.settings);
    const selectionKept = selection.photos[0]?.uuid === copies.replay;
    const ok = written && selectionKept && back.length === 0;
    Object.assign(out, { ok, vibrance, written, selection_kept: selectionKept, history_names: t.history_names, snapshot: t.snapshot, undo_differing: back });
    deps.say(`  Write to the photo while a copy was selected: written ${yn(written)}, selection kept ${yn(selectionKept)}, undone by its snapshot ${yn(back.length === 0)}.`);
    if (!ok) run.fail("the write to the photo while a copy was selected did not work as expected (details in unselected_original)");
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("the write to the unselected photo", err));
  }
}

/** 4. The photo put back with session A's pre-session snapshot, compared with its settings before the check, and selected again. */
export async function putMasterBack(deps: Phase4Deps, run: Run, photo: Photo): Promise<void> {
  const snap = run.masterSnapshot;
  if (!snap) return;
  const out: Json = { ok: false, snapshot: snap.name };
  run.results["put_back"] = out;
  try {
    const back = await deps.client.request("apply_snapshot", { photo_uuid: photo.uuid, snapshot_id: snap.id }, { timeoutMs: WRITE_TIMEOUT_MS });
    const differing = differingSettings(deps.map.fromSdk(back.read_back).settings, photo.start);
    Object.assign(out, { ok: differing.length === 0, differing });
    await select(deps, photo.uuid, MASTER);
    deps.say(`  The photo put back as before the check: ${differing.length === 0 ? "YES" : `NO (${differing.join(", ")} differ). In the Snapshots panel, click "${snap.name}".`}`);
    if (differing.length > 0) run.fail("the photo is not as it was before the check");
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(`${failLine("putting the photo back", err)}. In the Snapshots panel, click "${snap.name}".`);
  }
}
