// Part 1 of the Phase 8 check (phase8-check.ts): every photo of the "fixtures" collection, in order,
// as PHASE8_PLAN row 6 asks, with decisions D1-D4 A [stated: Jim, 2026-10-10, "Go"]:
//   1. the photo is selected (Lightroom checks writes on the photo in Develop only) and held back with
//      the check's own snapshot (phase8-config.ts holdBack);
//   2. lr_begin_session with portrait_natural_light, two scripted lr_step passes (temperature in the
//      photo's own unit), the settings read, lr_end_session revert, which must leave 0 settings
//      differing (D1 A);
//   3. the settings the session changed synced (lr_sync_series {settings}) onto the next photo of the
//      same pipeline in the collection, read back (D2 A);
//   4. that photo selected and a preset made from it (lr_create_preset_from_active), its file checked
//      for the pipeline's white balance and profile form, then deleted by the check (D3 A);
//   5. that photo put back with the sync's own "AVG pre-sync" snapshot, 0 settings differing.
// A photo whose original is missing must be refused with ORIGINAL_MISSING; it is not a target.

import { unlinkSync } from "node:fs";
import { CATALOG_READ_TIMEOUT_MS, MAX_PAGE } from "../library/index.js";
import { toToolError } from "../mcp/index.js";
import { differingSettings, type CanonicalSettings } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import { closeOpenSession, errorBody, settingsOf } from "./phase4-config.js";
import { COLLECTION, INTENT, holdBack, presetName, putBack, putBackAll, selectSettled, stepsFor, yes, type Fixture, type Json, type Phase8Deps, type Run } from "./phase8-config.js";
import { presetFileProblems } from "./phase8-presets.js";
import { changedBy, passesMade, revertExact, scriptedSession } from "./phase8-session.js";
import { partOf } from "./phase8-state.js";

/** The collection's photos with their pipeline and availability; null, failed, when there is no single such collection. */
export async function listFixtures(deps: Phase8Deps, run: Run): Promise<Fixture[] | null> {
  const { client } = deps;
  const named = (await client.request("list_collections", {}, { timeoutMs: CATALOG_READ_TIMEOUT_MS })).collections.filter((c) => c.name === COLLECTION);
  if (named.length !== 1) {
    run.fail(`Lightroom has ${named.length} collections named "${COLLECTION}", not one (the S10 spike made it: npm run s10:check -- --fixtures).`);
    return null;
  }
  const collectionId = (named[0] as { local_id: number }).local_id;
  const listed: Array<{ uuid?: string | undefined }> = [];
  for (let offset = 0; ; offset += MAX_PAGE) {
    const page = await client.request("search_photos", { criteria: [], collection_id: collectionId, offset, limit: MAX_PAGE }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    listed.push(...page.photos);
    if (page.photos.length === 0 || listed.length >= page.count) break;
  }
  const fixtures: Fixture[] = [];
  for (const { uuid } of listed) {
    if (!uuid) continue;
    const c = await client.request("get_context", { photo_uuid: uuid });
    const filename = typeof c["filename"] === "string" ? c["filename"] : uuid;
    const copyName = typeof c["copy_name"] === "string" ? c["copy_name"] : null;
    let view: { pipeline: Fixture["pipeline"]; process_version: string | null } = { pipeline: null, process_version: null };
    try {
      view = await settingsOf(deps, uuid);
    } catch {
      // PIPELINE_UNKNOWN or an unsupported version: the session refuses it, which Part 1 records.
    }
    fixtures.push({ uuid, filename, copy_name: copyName, label: copyName ? `${filename} (${copyName})` : filename, file_format: typeof c["file_format"] === "string" ? c["file_format"] : null, pipeline: view.pipeline, process_version: view.process_version, available: c["available"] !== false });
  }
  run.results["fixtures"] = fixtures;
  deps.say(`The collection "${COLLECTION}": ${fixtures.length} photos, ${fixtures.filter((f) => f.pipeline === "raw").length} raw, ${fixtures.filter((f) => f.pipeline === "rendered").length} rendered, ${fixtures.filter((f) => !f.available).length} with the original missing.`);
  return fixtures;
}

/** The sync target of each photo: the next available photo of the same pipeline, round the collection (D2 A); null when it is the only one. */
export function ringTargets(fixtures: readonly Fixture[]): Map<string, Fixture | null> {
  const targets = new Map<string, Fixture | null>();
  for (const pipeline of ["raw", "rendered"] as const) {
    const ring = fixtures.filter((f) => f.available && f.pipeline === pipeline);
    ring.forEach((f, i) => targets.set(f.uuid, ring.length > 1 ? (ring[(i + 1) % ring.length] as Fixture) : null));
  }
  return targets;
}

export async function photosPart(deps: Phase8Deps, run: Run, fixtures: readonly Fixture[]): Promise<void> {
  const targets = ringTargets(fixtures);
  deps.say("");
  deps.say(`Part 1: a session, a sync and a preset on every photo of "${COLLECTION}". Nothing to do in Lightroom; the check selects each photo itself.`);
  for (const [i, f] of fixtures.entries()) {
    if (run.state.photos.some((p) => p.uuid === f.uuid)) continue;
    const out: Json = { label: f.label, file_format: f.file_format, pipeline: f.pipeline, process_version: f.process_version };
    let ok = false;
    try {
      ok = f.available ? await onePhoto(deps, run, f, targets.get(f.uuid) ?? null, i + 1, out) : await refusedMissing(deps, f, out);
    } catch (err) {
      out["error"] = errorBody(err);
      run.fail(`${f.label}: ${describeError(err)}`);
      await putBackAll(deps, run); // the photo and its target, if the error came after a write
    }
    out["ok"] = ok;
    run.state.photos.push({ ...partOf(ok, out), uuid: f.uuid, label: f.label });
    run.save();
    deps.say(`  ${String(i + 1).padStart(2)}/${fixtures.length} ${f.label} (${f.file_format ?? "?"}, ${f.pipeline ?? "pipeline unknown"}, PV ${f.process_version ?? "?"}): ${!ok ? "FAILED" : f.available ? "WORKED" : "refused as expected (the original is missing)"}`);
  }
}

/**
 * A missing original: lr_begin_session must refuse it with ORIGINAL_MISSING before anything is
 * written. Lightroom may not select such a photo at all (offline check runs 2-3: "active photo nil")
 * [handle: docs\reports\phase8\offline.md "Observed"]; then nothing can be begun on it, which is
 * recorded and counts as refused.
 */
async function refusedMissing(deps: Phase8Deps, f: Fixture, out: Json): Promise<boolean> {
  try {
    await deps.client.request("select_photo", { uuid: f.uuid });
  } catch (err) {
    out["missing"] = { refused: true, selected: false, select_error: describeError(err) };
    return true;
  }
  try {
    await deps.tools.beginSession({ intent_id: INTENT, return_image: "none" });
    out["missing"] = { refused: false };
    await closeOpenSession(deps, out); // it began: revert it, so the photo is as it was
    return false;
  } catch (err) {
    const code = toToolError(err).code;
    out["missing"] = { refused: code === "ORIGINAL_MISSING", code };
    return code === "ORIGINAL_MISSING";
  }
}

async function onePhoto(deps: Phase8Deps, run: Run, f: Fixture, target: Fixture | null, n: number, out: Json): Promise<boolean> {
  await selectSettled(deps, f.uuid);
  const held = await holdBack(deps, run, f.uuid, f.label);
  const session: Json = {};
  out["session"] = session;
  const s = await scriptedSession(deps, session, f.uuid, INTENT, stepsFor(f.pipeline ?? "raw"), "revert");
  const reverted = revertExact(s);
  const passes = passesMade(s);
  const differing = await putBack(deps, run, held); // 0 after an exact revert; else the check's snapshot repairs it
  Object.assign(session, { ok: reverted && passes === 2 && differing.length === 0, passes, revert_exact: reverted, put_back_differing: differing });
  if (!reverted) run.fail(`${f.label}: lr_end_session revert left settings differing (${JSON.stringify((s.end["revert"] as Json | undefined)?.["differing"])})`);
  if (passes !== 2) run.fail(`${f.label}: ${passes} of the 2 scripted passes were made (details in photos)`);
  if (!target) {
    out["sync"] = { skipped: `no other photo on the ${f.pipeline ?? "?"} pipeline` };
    return session["ok"] === true;
  }
  const synced = await syncAndPreset(deps, run, changedBy(held.start as CanonicalSettings, s), target, n, out);
  return session["ok"] === true && synced;
}

/** Steps 3-5: the changed settings onto the target, a preset from it, the target put back with the sync's snapshot. */
async function syncAndPreset(deps: Phase8Deps, run: Run, changed: CanonicalSettings, target: Fixture, n: number, out: Json): Promise<boolean> {
  const sync: Json = { target: target.label, copied: Object.keys(changed) };
  out["sync"] = sync;
  const held = await holdBack(deps, run, target.uuid, target.label);
  const res = (await deps.tools.syncSeries({ source: { settings: changed }, targets: { uuids: [target.uuid] }, adaptive_exposure: false, return_image: "none" })).json;
  const t = ((res["targets"] as Json[] | undefined) ?? [])[0];
  const leftOut = ((t?.["not_transferable"] as Array<{ names: string[] }> | undefined) ?? []).flatMap((x) => x.names);
  const written = Object.keys(changed).filter((k) => !leftOut.includes(k));
  const now = (await settingsOf(deps, target.uuid)).settings;
  const differing = differingSettings(Object.fromEntries(written.map((k) => [k, now[k]])), Object.fromEntries(written.map((k) => [k, changed[k]])));
  Object.assign(sync, { applied: res["applied"], skipped: res["skipped"], not_transferable: t?.["not_transferable"] ?? [], snapshot: t?.["snapshot"] ?? null, read_back_differing: differing });
  const preset = await presetFrom(deps, target, n);
  out["preset"] = preset;
  const snapshot = (t?.["snapshot"] as { id?: string } | undefined)?.id;
  const back = snapshot ? await putBack(deps, run, held, snapshot) : ["no sync snapshot"];
  sync["undone_by_its_snapshot"] = back.length === 0;
  if (back.length > 0) {
    sync["undo_differing"] = back;
    const repaired = await putBack(deps, run, held);
    if (repaired.length > 0) run.fail(`${target.label} is not back as before the check (${repaired.join(", ")} differ): in the Snapshots panel, click "${held.snapshot_name}"`);
  }
  const ok = res["applied"] === 1 && leftOut.length === 0 && differing.length === 0 && back.length === 0 && preset["ok"] === true;
  sync["ok"] = ok;
  if (!ok) run.fail(`${target.label}: the sync, the preset or the put-back did not work as expected (details in photos)`);
  return ok;
}

/** A preset from the target (selected first), its file checked, then deleted: Lightroom never lists it. */
async function presetFrom(deps: Phase8Deps, target: Fixture, n: number): Promise<Json> {
  try {
    return await makePreset(deps, target, n);
  } catch (err) {
    return { ok: false, error: errorBody(err) };
  }
}

async function makePreset(deps: Phase8Deps, target: Fixture, n: number): Promise<Json> {
  await selectSettled(deps, target.uuid);
  const res = (await deps.tools.createPresetFromActive({ name: presetName(deps.stamp, n) })).json;
  const path = String(res["path"]);
  const written = (res["written"] as string[] | undefined) ?? [];
  const source = (await settingsOf(deps, target.uuid)).settings;
  const problems = presetFileProblems(deps.map, path, target.pipeline ?? "raw", written, source);
  let deleted = true;
  try {
    unlinkSync(path);
  } catch {
    deleted = false;
  }
  deps.say(`       preset: ${written.length} settings, form as Lightroom writes it: ${yes(problems.length === 0)}${problems.length ? ` (${problems.join("; ")})` : ""}`);
  return { ok: problems.length === 0 && written.length > 0, name: res["name"], written, left_out: res["left_out"], problems, deleted };
}
