// lr_get_preview with quality "fast" (issue #216): Lightroom's cached preview (plugin thumbnail_preview,
// Preview.lua thumbnailPreview) instead of the exact export, for looking through a shoot (culling,
// keywording, #111, #112). It may be stale: Lightroom answered "error loading thumb" right after a write
// [handle: docs\reports\phase0\S1.md Run 2], and Automaat says it is stale right after a photo enters
// Develop [upstream claim: Automaat/lightroom-mcp 1040453 CLAUDE.md:100]. When Lightroom sends no
// thumbnail, or the plugin is older than the command, the exact export is rendered instead and
// `fast_fallback` says why. A fast preview is never a session's render and never the engine's last
// render, so lr_get_metrics and the session's deltas keep describing exact exports.

import { BridgeError } from "../bridge/index.js";
import { summarize } from "../metrics/index.js";
import type { PreviewRequest, RenderedPreview } from "../preview/index.js";
import { ToolError } from "./errors.js";
import { DEFAULT_LONG_EDGE, PREVIEW_QUALITY, describe, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** The plugin's refusals that make a fast preview fall back to the export; unknown_command: a plugin without thumbnail_preview. */
const FALL_BACK = new Set(["thumbnail_failed", "thumbnail_timeout", "unknown_command"]);

export const STALE_NOTE =
  "From Lightroom's preview cache: quick, but it can lag behind the photo's current settings (right after an edit or after the photo enters Develop). " +
  "For judging an edit, call lr_get_preview without quality.";

/**
 * Lightroom's cached preview for `request`, or the exact export when the plugin sends none; `fallback` is
 * then the plugin's code and message. lr_get_preview "fast" and lr_get_contact_sheet (tools-sheet.ts) use it.
 */
export async function renderFast(ctx: ToolContext, request: PreviewRequest): Promise<{ preview: RenderedPreview; fallback: string | null }> {
  try {
    return { preview: await ctx.deps.previews.render({ ...request, fast: true }), fallback: null };
  } catch (err) {
    if (!(err instanceof BridgeError) || !FALL_BACK.has(err.code)) throw err;
    return { preview: await ctx.deps.previews.render({ ...request, fast: false }), fallback: `${err.code}: ${err.message}` };
  }
}

export type FastPreviewArgs = { long_edge?: number | undefined; uuid?: string | undefined; session_id?: string | undefined; target?: unknown; region?: unknown };

export async function fastPreview(ctx: ToolContext, args: FastPreviewArgs): Promise<ToolOutput> {
  if (args.session_id !== undefined || args.target !== undefined || args.region !== undefined) {
    throw new ToolError("INVALID_ARGUMENTS", 'quality "fast" is for browsing photos: not with session_id, target or region, which use the exact export.', false);
  }
  await ctx.deps.ensureBridge();
  const request: PreviewRequest = { longEdge: args.long_edge ?? DEFAULT_LONG_EDGE, quality: PREVIEW_QUALITY, ...(args.uuid !== undefined ? { photoUuid: args.uuid } : {}) };
  const { preview, fallback } = await renderFast(ctx, request);
  const thumbnail = preview.source === "thumbnail";
  const json = {
    ok: true,
    ...describe(preview),
    source: preview.source,
    stale_possible: thumbnail,
    ...(thumbnail ? { stale_note: STALE_NOTE } : {}),
    ...(fallback ? { fast_fallback: `Lightroom sent no cached preview (${fallback}), so this is the exact export.` } : {}),
    metrics: summarize(preview.metrics),
    timings: preview.timings,
  };
  return { json, image: preview.jpeg, log: { uuid: preview.uuid, source: preview.source, ...(fallback ? { fast_fallback: fallback } : {}), timings: preview.timings } };
}
