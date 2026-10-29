// lr_get_contact_sheet (issues #111, #112): up to MAX_SHEET_CELLS photos named by uuid in one numbered
// grid image (preview\sheet.ts), each cell with its metrics summary, for culling and keywording a shoot
// one sheet at a time. Each photo is rendered at MIN_LONG_EDGE through the uuid preview path, the
// selection untouched: Lightroom's cached preview by default (tools-preview-fast.ts renderFast, with
// its exact-export fallback), or the exact export with quality "exact". Like lr_get_photo_stats
// (tools-stats.ts): photos are rendered one at a time in the order given, a photo that fails is left
// out of the grid and listed with its error, the call stops starting photos when the client cancels
// it or after the call budget and returns the rest as `not_yet`, it runs between sessions, and it is
// never the engine's last render.

import { CALL_BUDGET_MS } from "../library/index.js";
import { summarize } from "../metrics/index.js";
import { MAX_SHEET_CELLS, contactSheet, type RenderedPreview } from "../preview/index.js";
import { callCancelled } from "./call-context.js";
import { toToolError } from "./errors.js";
import { IMAGE_MAX_EDGE } from "./image-cap.js";
import type { Budget } from "./tools-files.js";
import { STALE_NOTE, renderFast } from "./tools-preview-fast.js";
import { MIN_LONG_EDGE, PREVIEW_QUALITY, ms, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

export const MAX_SHEET_PHOTOS = MAX_SHEET_CELLS;
export const SHEET_CELL_LONG_EDGE = MIN_LONG_EDGE;

export const SHARPNESS_NOTE =
  "Sharpness is comparable only between cells of one sheet: it depends on the export size. For a doubtful frame (eyes, focus), call lr_get_preview with uuid and region.";

export type ContactSheetArgs = { uuids: string[]; quality?: "fast" | "exact" | undefined };

type Cell = { n: number; uuid: string; source: string; stale_possible: boolean; fast_fallback?: string; width: number; height: number; metrics: Record<string, unknown> };
type Failed = { n: number; uuid: string; error: { code: string; message: string } };

export async function getContactSheet(ctx: ToolContext, args: ContactSheetArgs, budget: Budget = { now: () => performance.now(), ms: CALL_BUDGET_MS }): Promise<ToolOutput> {
  return run(ctx, "lr_get_contact_sheet", args, async () => {
    await ctx.deps.ensureBridge();
    const build = () => buildSheet(ctx, args, budget);
    return ctx.sessions ? ctx.sessions.whenIdle("lr_get_contact_sheet", build) : build();
  });
}

async function buildSheet(ctx: ToolContext, args: ContactSheetArgs, budget: Budget): Promise<ToolOutput> {
  const started = performance.now();
  const start = budget.now();
  const fast = args.quality !== "exact";
  const cells: Cell[] = [];
  const images: Buffer[] = [];
  const failed: Failed[] = [];
  let left: string[] = [];
  let cancelled = false;
  for (const [i, uuid] of args.uuids.entries()) {
    cancelled = callCancelled();
    if (cancelled || (i > 0 && budget.now() - start > budget.ms)) {
      left = args.uuids.slice(i);
      break;
    }
    try {
      const request = { longEdge: SHEET_CELL_LONG_EDGE, quality: PREVIEW_QUALITY, photoUuid: uuid };
      const { preview, fallback } = fast ? await renderFast(ctx, request) : { preview: await ctx.deps.previews.render(request), fallback: null };
      cells.push(cellOf(i + 1, uuid, preview, fallback));
      images.push(preview.jpeg);
    } catch (err) {
      const e = toToolError(err);
      failed.push({ n: i + 1, uuid, error: { code: e.code, message: e.message } });
    }
  }
  const sheet = images.length > 0 ? await contactSheet(images.map((image, i) => ({ image, label: String(cells[i]!.n) })), { longEdge: IMAGE_MAX_EDGE, quality: PREVIEW_QUALITY }) : null;
  const counts = { shown: cells.length, failed: failed.length, fast_fallbacks: cells.filter((c) => c.fast_fallback).length };
  const notYet = left.length > 0 ? { not_yet: left, next: `${cancelled ? "The call was cancelled" : "Time is up for this call"}: call again with uuids = not_yet (${left.length} photos).` } : {};
  const timings = { total_ms: ms(started) };
  const json = {
    ok: true,
    ...(sheet ? { sheet: { width: sheet.width, height: sheet.height, cols: sheet.cols, rows: sheet.rows } } : {}),
    cells,
    failed,
    counts,
    ...notYet,
    ...(cells.some((c) => c.stale_possible) ? { stale_note: STALE_NOTE } : {}),
    sharpness_note: SHARPNESS_NOTE,
    timings,
  };
  const logCells = cells.map(({ metrics: _metrics, ...c }) => c);
  return { json, ...(sheet ? { image: sheet.jpeg } : {}), log: { cells: logCells, failed, counts, not_yet: left, ...(cancelled ? { cancelled: true } : {}), timings } };
}

function cellOf(n: number, uuid: string, preview: RenderedPreview, fallback: string | null): Cell {
  const { regions: _regions, ...metrics } = summarize(preview.metrics);
  const thumbnail = preview.source === "thumbnail";
  return {
    n,
    uuid,
    source: preview.source,
    stale_possible: thumbnail,
    ...(fallback ? { fast_fallback: `Lightroom sent no cached preview (${fallback}), so this cell is the exact export.` } : {}),
    width: preview.width,
    height: preview.height,
    metrics,
  };
}
