// One target of lr_sync_series: identify it, snapshot it, write the copied settings as one History
// step and read them back (Phase 0, P-12), then with adaptive exposure search for its exposure
// (exposure.ts). Every command names the photo with `photo_uuid`, so the selection in Lightroom is
// not touched (plugin 0.4.0, plugin\LrC-AVG.lrplugin\Develop.lua target()): S7 wrote to and exported
// a virtual copy found by uuid without selecting it [handle: docs\reports\phase4\S7.md Verdict 4];
// an original is [unverified] until PHASE4_PLAN row 10. Against the Lightroom sim [handle:
// tests\sync.test.ts "writes to photos by uuid and leaves the selection alone"].

import { BridgeError } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { differingSettings, type CanonicalValue, type FromSdkResult } from "../params/index.js";
import type { RenderedPreview } from "../preview/index.js";
import { roundForSlider } from "../session/rules.js";
import { solveExposure } from "./exposure.js";
import type { SyncRun, TargetResult } from "./types.js";

/** A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md:240]; 30 s, as session\types.ts. */
export const WRITE_TIMEOUT_MS = 30000;
/**
 * A command that got no answer (timeout, lost bridge) may still be carried out by Lightroom
 * [inference: on a timeout the engine only stops waiting and tells the plugin nothing
 * (engine\src\bridge\client.ts send(), the timer), and the plugin runs each command in its own task
 * (plugin\LrC-AVG.lrplugin\Sockets.lua:50)].
 */
export const UNANSWERED = new Set(["BRIDGE_TIMEOUT", "BRIDGE_DISCONNECTED"]);

/**
 * True for a command that never left the engine: the client refuses with `not_connected` before it
 * writes the line [handle: engine\src\bridge\client.ts request() and send(), the two `not_connected`
 * refusals]; every other refusal comes after the line was sent (Greptile, PR #35 round 2).
 */
function neverSent(err: unknown): boolean {
  return err instanceof BridgeError && err.code === "not_connected";
}

/** A command with no answer that may still have reached Lightroom. */
const mayHaveLanded = (err: unknown): boolean => UNANSWERED.has(toToolError(err).code) && !neverSent(err);

type Photo = { uuid: string; filename: string | null; copy_name: string | null };
const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

async function identify(run: SyncRun, uuid: string): Promise<Photo> {
  const photo = await run.deps.client.request("get_context", { photo_uuid: uuid });
  const found = { uuid, filename: text(photo["filename"]), copy_name: text(photo["copy_name"]) };
  if (photo["file_format"] === "VIDEO") throw new ToolError("VIDEO_NOT_SUPPORTED", `${found.filename ?? uuid} is a video; only photos are synced.`, false);
  return found;
}

/**
 * Write canonical values as one History step and check the read-back. The step's name joins `names`
 * once Lightroom answered, also when the read-back then shows a value it did not take. With no
 * answer, Lightroom may still make the step after the engine stopped waiting (Greptile, PR #35): the
 * error names it as `maybe_written` [handle: tests\sync.test.ts "stops when a write gets no answer
 * in time"].
 */
async function write(run: SyncRun, uuid: string, values: Record<string, CanonicalValue>, historyName: string, processVersion: string, names: string[]): Promise<FromSdkResult> {
  const { client, map } = run.deps;
  const sdk = map.toSdk(values, { processVersion });
  let res;
  try {
    res = await client.request("apply_settings", { photo_uuid: uuid, settings: sdk, history_name: historyName }, { timeoutMs: run.deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
  } catch (err) {
    const error = toToolError(err);
    if (!mayHaveLanded(err)) throw error;
    throw new ToolError(error.code, `${error.message} Lightroom may still write "${historyName}" to this photo.`, error.recoverable, { maybe_written: historyName });
  }
  names.push(historyName);
  const mismatches = map.verifyReadback(sdk, res.read_back);
  if (mismatches.length > 0) {
    throw new ToolError("WRITE_NOT_TAKEN", `Lightroom did not take ${mismatches.map((m) => m.sdk_key).join(", ")} as written in "${historyName}".`, false, { history_name: historyName, mismatches });
  }
  return map.fromSdk(res.read_back);
}

const render = (run: SyncRun, uuid: string): Promise<RenderedPreview> => run.deps.render({ longEdge: run.longEdge, quality: run.quality, photoUuid: uuid });

type Adapted = { view: FromSdkResult; exposure: NonNullable<TargetResult["exposure"]>; luma: NonNullable<TargetResult["luma"]>; render: RenderedPreview };

/** Adaptive exposure on one target, from its exposure as synced; the best try is left written. */
async function adapt(run: SyncRun, uuid: string, view: FromSdkResult, names: string[]): Promise<Adapted> {
  const goal = run.goal as NonNullable<SyncRun["goal"]>;
  const spec = run.deps.map.spec("exposure");
  const start = view.settings["exposure"];
  if (spec?.kind !== "number" || typeof start !== "number") throw new ToolError("INTERNAL_ERROR", "the photo's settings have no exposure to adapt", false);
  const renders = new Map<number, RenderedPreview>();
  const first = await render(run, uuid);
  renders.set(start, first);
  let current = view;
  const step = async (exposure: number): Promise<void> => {
    const name = `AVG sync ${run.short} exposure ${names.filter((n) => n.includes(" exposure ")).length + 1}`;
    current = await write(run, uuid, { exposure }, name, view.process_version, names);
  };
  const measure = async (exposure: number): Promise<number> => {
    await step(exposure);
    const r = await render(run, uuid);
    renders.set(exposure, r);
    return r.metrics.luma_mean;
  };
  const solved = await solveExposure({ exposure: start, luma: first.metrics.luma_mean }, goal.luma, measure, { min: spec.min, max: spec.max });
  const { best, trail } = solved;
  // A later try moved away from the goal: put the best one back (its render was taken at that value).
  if ((trail[trail.length - 1] as { exposure: number }).exposure !== best.exposure) await step(best.exposure);
  return {
    view: current,
    exposure: { start, final: best.exposure, offset: goal.exposure === null ? null : roundForSlider("exposure", best.exposure - goal.exposure) },
    luma: { goal: goal.luma, start: first.metrics.luma_mean, final: best.luma, renders: trail.length, met: solved.met, tries: trail },
    render: renders.get(best.exposure) as RenderedPreview,
  };
}

/**
 * A failure once the target's snapshot was asked for: the error says what puts the photo back, and
 * its details the snapshot (or, with no answer, the name it may have), the History steps written and
 * `maybe_written`.
 */
function failedAfterSnapshot(err: unknown, photo: Photo, snapshotName: string, snapshot: { name: string; id: string } | null, names: string[]): ToolError {
  const error = toToolError(err);
  const details = typeof error.details === "object" && error.details !== null ? error.details : {};
  const maybeSnapshot = !snapshot && mayHaveLanded(err);
  const undo = snapshot
    ? ` The snapshot "${snapshotName}" on this photo puts it back as it was.`
    : maybeSnapshot
      ? ` Lightroom may still make the snapshot "${snapshotName}" on this photo; nothing else was sent to it.`
      : " Nothing was written to this photo.";
  return new ToolError(error.code, `${error.message}${undo}`, error.recoverable, {
    ...details,
    filename: photo.filename,
    ...(snapshot ? { snapshot } : maybeSnapshot ? { snapshot_name: snapshotName } : {}),
    history_names: names,
  });
}

/** Sync one target. A failure after its snapshot was asked for is described by failedAfterSnapshot(). */
export async function syncTarget(run: SyncRun, uuid: string): Promise<TargetResult> {
  const { client, map } = run.deps;
  const photo = await identify(run, uuid);
  const before = map.fromSdk((await client.request("get_settings", { photo_uuid: uuid })).settings);
  const snapshotName = `AVG pre-sync ${run.short}`;
  let snapshot: { name: string; id: string } | null = null;
  const names: string[] = [];
  try {
    const snap = await client.request("create_snapshot", { photo_uuid: uuid, name: snapshotName }, { timeoutMs: run.deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS });
    snapshot = { name: snapshotName, id: snap.snapshot_id };
    let now = before;
    if (Object.keys(run.copied).length > 0) now = await write(run, uuid, run.copied, `AVG sync ${run.short}`, before.process_version, names);
    const adapted = run.goal ? await adapt(run, uuid, now, names) : null;
    if (adapted) now = adapted.view;
    const changed = differingSettings(before.settings, now.settings);
    return { ...photo, snapshot, history_names: names, changed, exposure: adapted?.exposure ?? null, luma: adapted?.luma ?? null, render: adapted?.render ?? null };
  } catch (err) {
    throw failedAfterSnapshot(err, photo, snapshotName, snapshot, names);
  }
}
