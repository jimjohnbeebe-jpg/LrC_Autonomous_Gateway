// The crop frame of a session photo (GitHub issue #179; params\crop-frame.ts): taken from the settings the
// call has just read, so a crop the user made in Lightroom meanwhile counts. A crop angle also needs the
// photo's pixel size, which get_context gives (getRawMetadata width/height, the full size after a crop
// [handle: LR_SDK_NOTES.md:154; docs\reports\phase4\S7\s7_run_2026-09-27T12-53-05.json `crop.size_after_crop`]);
// an uncropped or straight crop needs no extra call.
//
// lr_crop (GitHub issue #115): one pass that writes the five crop keys as one History step "AVG <id> pass n/N crop",
// built like a mask pass (masks.ts maskPass): the pick first in Variants mode (CROP_AFTER_PICK), the pass cap, the
// approval, a fresh render to compare with, the write, its read-back (a crop not taken is written back, "… crop revert",
// and WRITE_NOT_TAKEN), the render. The keys write and read back through apply_settings with no plugin change [handle:
// docs\reports\phase11\CROP-SPIKE.md "Observed", run 2]. No clip or region guardrail: the framing moves the metrics, the
// tone does not [inference]. The session's regions are cleared, their boxes being in the old preview's frame [stated:
// Jim, 2026-10-29, "Go on all.", plan D4 (a)]. Masks need nothing: their geometry is stored in the uncropped frame and
// every mask call reads the crop again (the header above). [handle: tests\session-crop.test.ts, against the Lightroom sim;
// in Lightroom [unverified] until `npm run crop:check`.]

import { z } from "zod";
import { ToolError } from "../mcp/errors.js";
import { deltaMetrics, summarize as metricsOf } from "../metrics/index.js";
import { cropDiffers, cropFrame, cropKeys, cropSettings, cropView, needsSize, type CropFrame, type CropRequest, type SdkSettings } from "../params/index.js";
import { awaitApproval } from "./approval.js";
import { bridge, brief, describe, failed, fresh, historyName, image, ms, readSdk, recordPass, render, writeSdk } from "./io.js";
import { gapJson } from "./references.js";
import { checkReady, focus, resolveTarget } from "./targets.js";
import type { CropArgs, Rendered, Session, SessionContext, SessionOutput, Target } from "./types.js";

const sizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });

/** The crop frame of `sdk`; `context` gives get_context's answer, asked only when the crop has an angle. Also used by `npm run masks:crop`. */
export async function frameFor(sdk: SdkSettings, context: () => Promise<unknown>): Promise<CropFrame> {
  if (!needsSize(sdk)) return cropFrame(sdk, null);
  const size = sizeSchema.safeParse(await context());
  return cropFrame(sdk, size.success ? size.data : null);
}

const context = (ctx: SessionContext, s: Session, t: Target): Promise<unknown> => bridge(s, t, () => ctx.deps.client.request("get_context", { target_uuid: t.uuid }));

export const frameOf = (ctx: SessionContext, s: Session, t: Target, sdk: SdkSettings): Promise<CropFrame> => frameFor(sdk, () => context(ctx, s, t));

/** The photo a crop pass works on, once the pick and the pass cap allow it. */
function cropTarget(s: Session, args: CropArgs): Target {
  if (s.mode === "variants") {
    checkReady(s);
    if (!s.picked) throw new ToolError("CROP_AFTER_PICK", "The crop goes on the pick: let the user pick a copy (lr_select_variant) first; the copies before the pick take one lr_step each.", false, { session_id: s.id });
  }
  const t = resolveTarget(s, args.target, "write");
  if (t.endReason === "cap_reached" || t.passes >= s.maxPasses) {
    throw new ToolError("CAP_REACHED", `All ${s.maxPasses} passes are used, and a crop is a pass. Call lr_end_session; next time raise max_passes at lr_begin_session when a crop is planned.`, false, { session_id: s.id });
  }
  return t;
}

const fmt = (keys: SdkSettings): string => Object.entries(cropKeys(keys)).map(([k, v]) => `${k} ${Math.round(v * 1e5) / 1e5}`).join(", ");

/** lr_crop: one pass of the session's photo. */
export async function cropPass(ctx: SessionContext, s: Session, args: CropArgs): Promise<SessionOutput> {
  const started = performance.now();
  const t = cropTarget(s, args);
  const { box, aspect, angle, reset } = args;
  const req: CropRequest = { ...(box ? { box } : {}), ...(aspect !== undefined ? { aspect } : {}), ...(angle !== undefined ? { angle } : {}), ...(reset !== undefined ? { reset } : {}) };
  const n = t.passes + 1;
  const approval = await awaitApproval(ctx, s, t, "lr_crop");
  const passStarted = ctx.now().toISOString();
  s.work = { target: t, pass: n, note: "Cropping" };
  await focus(ctx, s, t);
  const first = await readSdk(ctx, s, t);
  const size = sizeSchema.safeParse(await context(ctx, s, t));
  if (!size.success) throw new ToolError("CROP_FRAME_UNSUPPORTED", "Nothing was written: Lightroom did not give the photo's pixel size, which a crop needs. The pass is not used.", false, { session_id: s.id });
  const frame = cropFrame(first.sdk, size.data);
  const keys = cropSettings(req, frame, size.data); // MaskError: nothing written
  if (!cropDiffers(keys, first.sdk)) throw new ToolError("NO_CHANGE", "Nothing was written: the photo already has this crop. The pass is not used.", false, { session_id: s.id });
  const before = cropView(frame, size.data);
  let baseline: Rendered;
  try {
    baseline = (await fresh(ctx, s, t, first.view)).last;
  } catch (err) {
    throw failed(ctx, s, `crop pass ${n} (render before the change)`, err);
  }
  try {
    const name = historyName(s, t, n, "crop");
    // The canonical settings leave the crop out, so io.ts fresh would take the last render as current: drop it before the
    // write (one that times out may have been taken), and the probe slopes once the crop is taken (Greptile, PR #269).
    t.last = null;
    const readBack = await writeSdk(ctx, s, t, keys, name);
    if (cropDiffers(readBack, keys)) {
      const back = historyName(s, t, n, "crop revert");
      await writeSdk(ctx, s, t, cropKeys(first.sdk), back, true);
      throw new ToolError("WRITE_NOT_TAKEN", `Lightroom did not take the crop as written in "${name}" (written: ${fmt(keys)}; read back: ${fmt(readBack)}). The crop from before was written back ("${back}"), and the pass is not used.`, false, { history_name: name, revert_name: back });
    }
    t.slopes.clear();
    const cleared = s.regions.map((r) => r.label);
    s.regions = [];
    const view = ctx.deps.map.fromSdk(readBack);
    const rendered = await render(ctx, s, t, view);
    t.passes = n;
    t.endReason = n >= s.maxPasses ? "cap_reached" : null; // never "converged", as a mask pass
    const after = cropView(cropFrame({ ...first.sdk, ...cropKeys(readBack) }, size.data), size.data);
    const delta = deltaMetrics(baseline.metrics, rendered.metrics);
    const crop = { before, after };
    recordPass(s, {
      n, kind: "crop", target: t.id, started: passStarted, duration_ms: ms(started), history_names: [name], rationale: args.rationale,
      requested: { ...req }, changes: [], clamped: [], refused: [], unchanged: [], settings_before: first.view.settings, settings_after: view.settings,
      metrics_before: metricsOf(baseline.metrics), metrics_after: metricsOf(rendered.metrics), delta_metrics: delta, preview_hash: rendered.hash,
      preview_source: "export", guardrail_actions: [], converged_by_metrics: false, ...(approval ? { approval } : {}), crop,
    });
    const regionsNote = cleared.length > 0 ? { regions_cleared: cleared, regions_note: "The session's regions were cleared: their boxes were in the preview before the crop. Call lr_set_regions again on this preview." } : {};
    const json = {
      ok: true, session_id: s.id, target: t.id, pass: `${n}/${s.maxPasses}`, crop, history_names: [name], ...regionsNote,
      metrics: metricsOf(rendered.metrics), delta_metrics: delta, ...gapJson(s, rendered.metrics), cap_reached: t.endReason === "cap_reached", passes_left: s.maxPasses - n,
      ...(approval ? { approval } : {}), ...describe(rendered), timings: { total_ms: ms(started) },
    };
    const img = await image(s, args.return_image ?? "after", baseline, rendered, `pass ${n - 1}`, `pass ${n}`);
    return { json, ...(img ? { image: img } : {}), log: { session_id: s.id, pass: json.pass, history_names: [name], crop: after, metrics: brief(rendered.metrics) } };
  } catch (err) {
    throw failed(ctx, s, `crop pass ${n}`, err);
  }
}
