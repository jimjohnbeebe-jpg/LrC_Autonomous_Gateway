// The propagation tools (Phase 4; the sync itself is sync\sync.ts): lr_sync_series. The preset tool
// (lr_create_preset_from_active) joins this group in PHASE4_PLAN row 9.

import { syncSeries as runSync, type MaskGroup, type SyncSource, type SyncTargets } from "../sync/index.js";
import { DEFAULT_LONG_EDGE, PREVIEW_QUALITY, renderRequest, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SyncSeriesArgs = {
  source: SyncSource;
  targets: SyncTargets;
  parameter_mask?: MaskGroup[] | undefined;
  adaptive_exposure: boolean;
  return_image?: "sheet" | "none" | undefined;
  long_edge?: number | undefined;
};

/** In the session queue, so no session is open or can begin while it writes (SessionManager.whenIdle). */
export async function syncSeries(ctx: ToolContext, args: SyncSeriesArgs): Promise<ToolOutput> {
  return run(ctx, "lr_sync_series", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    const deps = {
      client: ctx.deps.client,
      map: ctx.deps.map,
      render: (request: Parameters<typeof renderRequest>[1]) => renderRequest(ctx, request),
      logDir: ctx.deps.sessionLogDir as string, // sessionTools() refuses an engine without it
    };
    return sessions.whenIdle("lr_sync_series", () =>
      runSync(deps, { ...args, long_edge: args.long_edge ?? DEFAULT_LONG_EDGE, quality: PREVIEW_QUALITY }),
    );
  });
}
