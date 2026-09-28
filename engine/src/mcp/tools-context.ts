// The context tools (Phase 2; Phase 3 added `session_id` and `region`): lr_get_active_photo_context,
// lr_get_preview, lr_get_metrics. They change nothing in Lightroom.

import { z } from "zod";
import { boxProblem, summarize, type Region, type RegionBox } from "../metrics/index.js";
import { ParamError, type FromSdkResult } from "../params/index.js";
import { cropRegion } from "../preview/index.js";
import type { SessionManager, SessionView, TargetId } from "../session/index.js";
import { ToolError, toToolError } from "./errors.js";
import { DEFAULT_LONG_EDGE, PREVIEW_QUALITY, describe, openSession, render, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

/**
 * The largest export a region crop asks for: the plugin refuses a long edge above 4096
 * [handle: plugin\LrC-AVG.lrplugin\Preview.lua:29, Preview.MAX_LONG_EDGE].
 */
export const REGION_EXPORT_MAX = 4096;

export type PreviewArgs = { long_edge?: number | undefined; session_id?: string | undefined; target?: TargetId | undefined; region?: RegionBox | undefined };
export type MetricsArgs = { session_id?: string | undefined; target?: TargetId | undefined };

/** `target` names a photo of an open session; without session_id it has nothing to name. */
function checkTarget(args: { session_id?: string | undefined; target?: TargetId | undefined }): void {
  if (args.target !== undefined && args.session_id === undefined) {
    throw new ToolError("INVALID_ARGUMENTS", "target names a photo of a session: give session_id too.", false);
  }
}

const sizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() });
export type PhotoSize = { width: number; height: number; from: "croppedDimensions" | "width/height" };

/**
 * The photo's size in pixels, as far as the context gives it: `cropped_dimensions`
 * (getRawMetadata("croppedDimensions"), which follows a Lightroom crop and is the full size when
 * uncropped), else `width`/`height`, which stay at the full size after a crop [handle:
 * docs\reports\phase4\S7.md Verdict 3, 6605 x 3302 against 8256 x 5504 in both runs]. The fallback
 * covers a plugin loaded before fix/effective-scale-crop, and a key the SDK refused, which the
 * plugin lists in metadata_errors instead of sending [handle: plugin\LrC-AVG.lrplugin\Develop.lua
 * Develop.getContext; tests\mcp-tools.test.ts "exports once more when a crop in Lightroom gave the
 * export another aspect"].
 */
export function photoSize(photo: Record<string, unknown>): PhotoSize | null {
  const cropped = sizeSchema.safeParse(photo["cropped_dimensions"]);
  if (cropped.success) return { ...cropped.data, from: "croppedDimensions" };
  const full = sizeSchema.safeParse({ width: photo["width"], height: photo["height"] });
  return full.success ? { ...full.data, from: "width/height" } : null;
}

export async function getActivePhotoContext(ctx: ToolContext): Promise<ToolOutput> {
  return run(ctx, "lr_get_active_photo_context", {}, async () => {
    const { client, map } = ctx.deps;
    await ctx.deps.ensureBridge();
    const photo = await client.request("get_context", {});
    const sdk = (await client.request("get_settings", { target_uuid: photo.uuid })).settings;
    let view: FromSdkResult | null = null;
    let settingsError: Record<string, unknown> | null = null;
    try {
      view = map.fromSdk(sdk);
    } catch (err) {
      if (!(err instanceof ParamError)) throw err;
      settingsError = toToolError(err).body(); // e.g. a legacy process version: the rest still helps
    }
    const field = (key: string): unknown => photo[key] ?? null;
    const open = ctx.sessions?.current() ?? null;
    const json: Record<string, unknown> = {
      ok: true,
      uuid: photo.uuid,
      local_id: photo.local_id,
      filename: field("filename"),
      path: field("path"),
      copy_name: field("copy_name"),
      is_virtual_copy: field("is_virtual_copy"),
      file_format: field("file_format"),
      width: field("width"),
      height: field("height"),
      exif: {
        iso: field("iso"),
        shutter: field("shutter"),
        aperture: field("aperture"),
        focal_length: field("focal_length"),
        lens: field("lens"),
        camera: field("camera"),
      },
      rating: field("rating"),
      label: field("label"),
      pick: field("pick"),
      process_version: view?.process_version ?? (typeof sdk["ProcessVersion"] === "string" ? sdk["ProcessVersion"] : null),
      camera_profile: view ? (view.camera_profile.name ?? view.camera_profile.camera_profile) : null,
      camera_profile_detail: view?.camera_profile ?? null,
      lens_profile_enabled: view ? view.settings["lens.profile_enable"] === 1 : null,
      settings: view?.settings ?? null,
      session_active: open?.photos.some((p) => p.uuid === photo.uuid) ?? false,
      ...(open ? { open_session: openSessionJson(open, photo.uuid) } : {}),
      ...(settingsError ? { settings_error: settingsError } : {}),
      ...(photo.metadata_errors?.length ? { metadata_errors: photo.metadata_errors } : {}),
    };
    return {
      json,
      log: { uuid: photo.uuid, filename: json["filename"], process_version: json["process_version"], camera_profile: json["camera_profile"] },
    };
  });
}

/**
 * The open session as lr_get_active_photo_context shows it: the selected photo's pass when it is
 * one of the session's photos (in Variants mode, a copy), else the photo the session last worked
 * on (Greptile, PR #34) [handle: tests\session-variants-faults.test.ts "previews and measures a
 * named copy, and says a copy is a session photo"].
 */
function openSessionJson(open: SessionView, selectedUuid: string): Record<string, unknown> {
  const selected = open.photos.find((p) => p.uuid === selectedUuid);
  const photo = selected ?? { target: open.target, uuid: open.uuid, pass: open.pass };
  return { session_id: open.id, mode: open.mode, ...photo, describes: selected ? "the selected photo" : "the photo the session last worked on" };
}

/**
 * A preview of the selected photo, or with `session_id` of a session photo (refused if another
 * photo is selected, C-2), with the session's region metrics. In Variants mode the manager selects
 * `target`'s copy first [handle: engine\src\session\targets.ts focus(); tests\session-variants-faults.test.ts
 * "previews and measures a named copy, and says a copy is a session photo": the sim's selection
 * is the copy afterwards]. With `region`, a crop of that box (regionPreview), rendered in the
 * session's queue with its selection [handle: tests\session-variants-faults.test.ts "runs a region
 * preview of one copy and a step on another sent at the same time one after the other"].
 */
export async function getPreview(ctx: ToolContext, args: PreviewArgs = {}): Promise<ToolOutput> {
  return run(ctx, "lr_get_preview", args, async () => {
    checkTarget(args);
    await ctx.deps.ensureBridge();
    const session = args.session_id !== undefined ? openSession(ctx, args.session_id) : null;
    const manager = ctx.sessions as SessionManager;
    const regions = session ? manager.regionsOf(session.id) : [];
    const longEdge = args.long_edge ?? DEFAULT_LONG_EDGE;
    if (!args.region) {
      // With a session, the manager renders it and keeps it as that photo's last render, so
      // lr_get_metrics and the next step describe this image (Greptile, PR #23) [handle:
      // tests\mcp-tools.test.ts "says a session is open on the selected photo, and answers
      // lr_get_metrics from the session's last render"].
      const preview = session ? await manager.preview(session.id, longEdge, args.target) : await render(ctx, longEdge, undefined, regions);
      const photo = session ? { target: manager.current()?.target } : {};
      const json = { ok: true, ...(session ? { session_id: session.id } : {}), ...photo, ...describe(preview), metrics: summarize(preview.metrics), timings: preview.timings };
      return { json, image: preview.jpeg, log: { uuid: preview.uuid, preview_hash: preview.sha256, metrics: json.metrics, timings: preview.timings } };
    }
    const region = args.region;
    if (!session) return regionPreview(ctx, null, regions, longEdge, region);
    return manager.withPhoto(session.id, args.target, (photo) => regionPreview(ctx, { id: session.id, ...photo }, regions, longEdge, region));
  });
}

/**
 * A crop of `region`: the photo is exported large enough for the crop to fill `long_edge` (up to
 * REGION_EXPORT_MAX), the crop is never enlarged, and `effective_scale` says how many output pixels
 * it has per pixel of the photo (1 = 100 %).
 */
async function regionPreview(ctx: ToolContext, session: { id: string; target: TargetId; uuid: string } | null, regions: Region[], longEdge: number, region: RegionBox): Promise<ToolOutput> {
  const problem = boxProblem(region);
  if (problem) throw new ToolError("INVALID_ARGUMENTS", `region: ${problem}`, false);
  const target = session?.uuid;
  const photo = await ctx.deps.client.request("get_context", target !== undefined ? { target_uuid: target } : {});
  // The cropped size when the plugin sent it, so a crop in Lightroom does not lower effective_scale
  // [handle: tests\mcp-tools.test.ts "takes the photo's size from croppedDimensions"].
  const size = photoSize(photo);
  const photoWidth = size ? Math.max(size.width, size.height) : null;
  // The crop's longer side as a fraction of the export's long edge: on a 3:2 landscape a box's
  // height counts 2/3 as much as its width (Greptile, PR #23: max(w, h) under-sized tall boxes)
  // [handle: tests\mcp-tools.test.ts "sizes the export by the crop's longer side in pixels"].
  const fraction = size && photoWidth ? Math.max(region.w * (size.width / photoWidth), region.h * (size.height / photoWidth)) : Math.max(region.w, region.h);
  // The epsilon keeps 800 / 0.26666666666666666 (= 3000.0000000000005) at 3000.
  const edgeFor = (f: number): number => Math.min(REGION_EXPORT_MAX, Math.max(longEdge, Math.ceil(longEdge / f - 1e-6)));
  let exportEdge = edgeFor(fraction);
  let preview = await render(ctx, exportEdge, photo.uuid, regions);
  let crop = await cropRegion(preview.jpeg, region, { longEdge, quality: PREVIEW_QUALITY });
  // The export follows a Lightroom crop, as croppedDimensions does [handle: docs\reports\phase4\S7.md
  // Numbers, item 3: export 1600 x 800, aspect 2.0, both runs]. The export can still have another
  // aspect than the context's size (Greptile, PR #23): after a crop, when the size came from
  // width/height (the fallback in photoSize), and possibly after a rotation, since S7 only tested
  // orientation "AB" [unverified: whether croppedDimensions follows a rotation]. If the crop came
  // out short, export once more at the size the export's own aspect needs [handle:
  // tests\mcp-tools.test.ts "exports once more when a crop in Lightroom gave the export another aspect"].
  let retried = false;
  if (Math.max(crop.width, crop.height) < longEdge && exportEdge < REGION_EXPORT_MAX) {
    const long = Math.max(preview.width, preview.height);
    const needed = edgeFor(Math.max(region.w * (preview.width / long), region.h * (preview.height / long)));
    if (needed > exportEdge) {
      exportEdge = needed;
      preview = await render(ctx, exportEdge, photo.uuid, regions);
      crop = await cropRegion(preview.jpeg, region, { longEdge, quality: PREVIEW_QUALITY });
      retried = true;
    }
  }
  const previewLong = Math.max(preview.width, preview.height);
  const effectiveScale = photoWidth ? Math.round(crop.scale * (previewLong / photoWidth) * 10000) / 10000 : null;
  const note = !size
    ? "the photo's size was not in the context; scale is per export pixel"
    : size.from === "width/height"
      ? "the photo's cropped size was not in the context, so the scale is per pixel of the uncropped photo and reads low if the photo is cropped in Lightroom"
      : null;
  const json = {
    ok: true,
    ...(session ? { session_id: session.id, target: session.target } : {}),
    uuid: preview.uuid,
    region,
    width: crop.width,
    height: crop.height,
    rect_in_export: crop.rect,
    export_long_edge: previewLong,
    ...(retried ? { export_retried: "the first export's aspect differed from the photo's size, so it was exported again larger" } : {}),
    effective_scale: effectiveScale,
    ...(note ? { effective_scale_note: note } : {}),
    scale_in_export: crop.scale,
    preview_source: preview.source,
    preview_hash: preview.sha256,
    metrics: summarize(preview.metrics),
    timings: preview.timings,
  };
  return { json, image: crop.jpeg, log: { uuid: preview.uuid, region, effective_scale: effectiveScale, photo_size: size, timings: preview.timings } };
}

/**
 * Metrics of the last preview: while a session is open, of the session's photo (in Variants mode
 * `target`'s, else the photo the last call worked on), and NO_PREVIEW_YET when that photo has none,
 * never another photo's (Greptile, PR #34); with no session open, this engine's last render.
 */
export async function getMetrics(ctx: ToolContext, args: MetricsArgs = {}): Promise<ToolOutput> {
  return run(ctx, "lr_get_metrics", args, { usesBridge: false }, async () => {
    checkTarget(args);
    const current = ctx.sessions?.current() ?? null;
    if (args.session_id !== undefined) openSession(ctx, args.session_id);
    const open = current ? (ctx.sessions as SessionManager).viewOf(current.id, args.target) : null;
    if (open) {
      if (!open.last) {
        throw new ToolError("NO_PREVIEW_YET", `The session's photo ${open.target === "master" ? "" : `(copy ${open.target}) `}has no preview yet; call lr_get_preview with session_id.`, false);
      }
      const json = { ok: true, session_id: open.id, target: open.target, uuid: open.uuid, preview_hash: open.last.hash, width: open.last.width, height: open.last.height, metrics: open.last.metrics };
      return { json, log: { session_id: open.id, preview_hash: open.last.hash } };
    }
    const last = ctx.last;
    if (!last) throw new ToolError("NO_PREVIEW_YET", "No preview has been rendered yet in this engine run; call lr_get_preview first.", false);
    const json = {
      ok: true,
      uuid: last.uuid,
      preview_hash: last.preview_hash,
      rendered_at: last.rendered_at,
      width: last.width,
      height: last.height,
      metrics: last.metrics,
    };
    return { json, log: { uuid: last.uuid, preview_hash: last.preview_hash } };
  });
}
