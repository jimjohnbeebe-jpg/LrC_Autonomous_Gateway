// lr_get_photo_stats (issue #216, after Automaat's get_photo_stats [upstream claim: Automaat/lightroom-mcp
// 1040453 server/src/photo-stats.ts getPhotoStats]): the metrics summary, sharpness included, of up to
// MAX_STATS_PHOTOS photos named by uuid, without a session and without changing anything. Each photo is
// the exact export at STATS_LONG_EDGE through the uuid preview path (export_preview with photo_uuid,
// preview\service.ts), the selection untouched; it is never the engine's last render, so lr_get_metrics
// keeps describing the photo last previewed. Photos are measured one at a time, in the order given; a
// photo that fails gets its own error and the next one runs. The call stops starting photos when the
// client cancels it (call-context.ts callCancelled) or after the call budget (library\files.ts
// CALL_BUDGET_MS), and returns the rest as `not_yet`. It runs between sessions, as lr_export_photos does:
// its exports would compete with a session's previews for Lightroom's exporter [inference].

import { CALL_BUDGET_MS } from "../library/index.js";
import { summarize } from "../metrics/index.js";
import { callCancelled } from "./call-context.js";
import { toToolError } from "./errors.js";
import type { Budget } from "./tools-files.js";
import { PREVIEW_QUALITY, ms, run, type ToolContext, type ToolOutput } from "./tools-shared.js";

export const MAX_STATS_PHOTOS = 20;
/** Enough for the metrics; sharpness is measured at 512 px whatever the size [inference: the smallest preview size, tools-shared.ts MIN_LONG_EDGE]. */
export const STATS_LONG_EDGE = 800;

export type PhotoStatsArgs = { uuids: string[] };

type PhotoStats =
  | { uuid: string; ok: true; width: number; height: number; metrics: Record<string, unknown>; ms: number }
  | { uuid: string; ok: false; error: { code: string; message: string } };

export async function getPhotoStats(ctx: ToolContext, args: PhotoStatsArgs, budget: Budget = { now: () => performance.now(), ms: CALL_BUDGET_MS }): Promise<ToolOutput> {
  return run(ctx, "lr_get_photo_stats", args, async () => {
    await ctx.deps.ensureBridge();
    const measure = () => measureAll(ctx, args.uuids, budget);
    return ctx.sessions ? ctx.sessions.whenIdle("lr_get_photo_stats", measure) : measure();
  });
}

async function measureAll(ctx: ToolContext, uuids: readonly string[], budget: Budget): Promise<ToolOutput> {
  const started = performance.now();
  const start = budget.now();
  const photos: PhotoStats[] = [];
  let left: string[] = [];
  let cancelled = false;
  for (const [i, uuid] of uuids.entries()) {
    cancelled = callCancelled();
    if (cancelled || (i > 0 && budget.now() - start > budget.ms)) {
      left = uuids.slice(i);
      break;
    }
    photos.push(await measureOne(ctx, uuid));
  }
  const measured = photos.filter((p) => p.ok).length;
  const json = {
    ok: true,
    long_edge: STATS_LONG_EDGE,
    photos,
    counts: { measured, failed: photos.length - measured },
    ...(left.length > 0 ? { not_yet: left, next: `${cancelled ? "The call was cancelled" : "Time is up for this call"}: call again with uuids = not_yet (${left.length} photos).` } : {}),
    timings: { total_ms: ms(started) },
  };
  return { json, log: { counts: json.counts, not_yet: left.length, ...(cancelled ? { cancelled: true } : {}), total_ms: json.timings.total_ms } };
}

async function measureOne(ctx: ToolContext, uuid: string): Promise<PhotoStats> {
  try {
    const preview = await ctx.deps.previews.render({ longEdge: STATS_LONG_EDGE, quality: PREVIEW_QUALITY, photoUuid: uuid });
    const { regions: _regions, ...metrics } = summarize(preview.metrics);
    return { uuid, ok: true, width: preview.width, height: preview.height, metrics, ms: preview.timings.total_ms };
  } catch (err) {
    const e = toToolError(err);
    return { uuid, ok: false, error: { code: e.code, message: e.message } };
  }
}
