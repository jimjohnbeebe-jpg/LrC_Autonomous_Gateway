// One target of lr_sync_series: identify it, snapshot it, write the copied settings as one History
// step and read them back (Phase 0, P-12), then with adaptive exposure search for its exposure
// (exposure.ts). Every command names the photo with `photo_uuid`, so the selection in Lightroom is
// not touched (plugin 0.4.0, plugin\LrC-AVG.lrplugin\Develop.lua target()): S7 wrote to and exported
// a virtual copy found by uuid without selecting it [handle: docs\reports\phase4\S7.md Verdict 4];
// an original is [unverified] until PHASE4_PLAN row 10. Against the Lightroom sim [handle:
// tests\sync.test.ts "writes to photos by uuid and leaves the selection alone"].

import { ToolError, toToolError } from "../mcp/errors.js";
import { differingSettings, type CanonicalValue, type FromSdkResult } from "../params/index.js";
import type { RenderedPreview } from "../preview/index.js";
import { roundForSlider } from "../session/rules.js";
import { solveExposure } from "./exposure.js";
import type { SyncRun, TargetResult } from "./types.js";

/** A write with its read-back took ~0.39 s in Phase 2 [handle: docs\reports\phase2\PHASE2.md:240]; 30 s, as session\types.ts. */
const WRITE_TIMEOUT_MS = 30000;

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
 * once Lightroom answered, also when the read-back then shows a value it did not take.
 */
async function write(run: SyncRun, uuid: string, values: Record<string, CanonicalValue>, historyName: string, processVersion: string, names: string[]): Promise<FromSdkResult> {
  const { client, map } = run.deps;
  const sdk = map.toSdk(values, { processVersion });
  const res = await client.request("apply_settings", { photo_uuid: uuid, settings: sdk, history_name: historyName }, { timeoutMs: WRITE_TIMEOUT_MS });
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
 * Sync one target. A failure after the snapshot says which snapshot puts the photo back and which
 * History steps were written (in the error's details).
 */
export async function syncTarget(run: SyncRun, uuid: string): Promise<TargetResult> {
  const { client, map } = run.deps;
  const photo = await identify(run, uuid);
  const before = map.fromSdk((await client.request("get_settings", { photo_uuid: uuid })).settings);
  const snapshotName = `AVG pre-sync ${run.short}`;
  const snap = await client.request("create_snapshot", { photo_uuid: uuid, name: snapshotName }, { timeoutMs: WRITE_TIMEOUT_MS });
  const snapshot = { name: snapshotName, id: snap.snapshot_id };
  const names: string[] = [];
  try {
    let now = before;
    if (Object.keys(run.copied).length > 0) now = await write(run, uuid, run.copied, `AVG sync ${run.short}`, before.process_version, names);
    const adapted = run.goal ? await adapt(run, uuid, now, names) : null;
    if (adapted) now = adapted.view;
    const changed = differingSettings(before.settings, now.settings);
    return { ...photo, snapshot, history_names: names, changed, exposure: adapted?.exposure ?? null, luma: adapted?.luma ?? null, render: adapted?.render ?? null };
  } catch (err) {
    const error = toToolError(err);
    const details = typeof error.details === "object" && error.details !== null ? error.details : {};
    throw new ToolError(error.code, `${error.message} The snapshot "${snapshotName}" on this photo puts it back as it was.`, error.recoverable, {
      ...details,
      filename: photo.filename,
      snapshot,
      history_names: names,
    });
  }
}
