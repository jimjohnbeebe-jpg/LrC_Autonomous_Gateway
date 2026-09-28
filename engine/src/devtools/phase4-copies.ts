// The Phase 4 check's virtual copies (phase4-check.ts). At the start, four copies of the photo in one
// create_virtual_copies command (plugin 0.3.0, Catalog.lua): three for the sync test (PHASE4_PLAN
// decision 5) and one for AC-5's replay. Each is checked to start with the master's settings, which
// row 7 left [unverified] (session\variants.ts copyPass0 renders a copy first when it does not).
// At the end, whether every copy the check and the chat made is gone from the catalog: a photo that
// was removed is no longer found by uuid (plugin\LrC-AVG.lrplugin\Photos.lua:64 answers unknown_photo) [unverified in
// Lightroom until this check runs].

import { BridgeError } from "../bridge/index.js";
import { differingSettings } from "../params/index.js";
import { describeError } from "./phase1-check.js";
import { yn } from "./phase3-config.js";
import { COPIES_TIMEOUT_MS, REPLAY_COPY, SYNC_COPIES, errorBody, failLine, ms, settingsOf, type Json, type Phase4Deps, type Photo, type Run } from "./phase4-config.js";

/** The check's copies by role, once all four exist with the names asked for. */
export type CheckCopies = { sync: string[]; replay: string };

/** Make the check's four copies; null (with the reason in the results) when not all four came back as asked. */
export async function makeCheckCopies(deps: Phase4Deps, run: Run, photo: Photo): Promise<CheckCopies | null> {
  const names = [...SYNC_COPIES, REPLAY_COPY];
  const out: Json = { names };
  run.results["copies"] = out;
  const started = performance.now();
  try {
    const res = await deps.client.request("create_virtual_copies", { target_uuid: photo.uuid, names }, { timeoutMs: COPIES_TIMEOUT_MS });
    for (const c of res.copies) if (c.uuid) run.copies.push({ uuid: c.uuid, copy_name: c.copy_name ?? "?", made_by: "check" });
    const byName = new Map(res.copies.filter((c) => c.identity_ok && c.uuid).map((c) => [c.copy_name, c.uuid as string]));
    Object.assign(out, { ms: ms(started), made: res.copies, failure: res.failure ?? null, master_selected: res.master_selected });
    const missing = names.filter((n) => !byName.has(n));
    if (missing.length > 0) {
      run.fail(`the check's copies: ${missing.join(", ")} did not come back as copies of the photo with that name${res.failure ? ` (${res.failure.message})` : ""}`);
      return null;
    }
    out["start_as_master"] = await startAsMaster(deps, photo, [...byName.values()]);
    deps.say(`  Four virtual copies made in ${String(out["ms"])} ms; each starts with the photo's settings: ${yn((out["start_as_master"] as { ok: boolean }).ok)}.`);
    return { sync: SYNC_COPIES.map((n) => byName.get(n) as string), replay: byName.get(REPLAY_COPY) as string };
  } catch (err) {
    out["error"] = errorBody(err);
    run.fail(failLine("the check's copies", err));
    return null;
  }
}

/** Each new copy's settings against the master's before the check. */
async function startAsMaster(deps: Phase4Deps, photo: Photo, uuids: readonly string[]): Promise<{ ok: boolean; copies: Json[] }> {
  const copies: Json[] = [];
  for (const uuid of uuids) {
    const differing = differingSettings((await settingsOf(deps, uuid)).settings, photo.start);
    copies.push({ uuid, differing });
  }
  return { ok: copies.every((c) => (c["differing"] as string[]).length === 0), copies };
}

/** Where a copy is after the cleanup: gone (unknown_photo), still there, or not known (another error). */
export type CopyState = { uuid: string; copy_name: string; made_by: string; state: "gone" | "still there" | "unknown"; error?: string };

export async function copyStates(deps: Phase4Deps, run: Run): Promise<CopyState[]> {
  const states: CopyState[] = [];
  for (const c of run.copies) {
    try {
      await deps.client.request("get_context", { photo_uuid: c.uuid });
      states.push({ ...c, state: "still there" });
    } catch (err) {
      const gone = err instanceof BridgeError && err.code === "unknown_photo";
      states.push({ ...c, state: gone ? "gone" : "unknown", ...(gone ? {} : { error: describeError(err) }) });
    }
  }
  return states;
}
