// The propagation tools (Phase 4): lr_sync_series (the sync is sync\sync.ts) and
// lr_create_preset_from_active (the preset is presets\create.ts).

import { loadDefaultPresetFormat } from "../params/index.js";
import { createPreset, type CreatePresetArgs } from "../presets/index.js";
import { folderOf } from "../session/index.js";
import { syncSeries as runSync, type MaskGroup, type SyncSource, type SyncTargets } from "../sync/index.js";
import { ToolError } from "./errors.js";
import { DEFAULT_LONG_EDGE, PREVIEW_QUALITY, renderRequest, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export type SyncSeriesArgs = {
  source: SyncSource;
  targets: SyncTargets;
  parameter_mask?: MaskGroup[] | undefined;
  adaptive_exposure: boolean;
  return_image?: "sheet" | "none" | undefined;
  long_edge?: number | undefined;
};

export type { CreatePresetArgs };

/**
 * In the session queue, so no session is open or can begin while it writes (SessionManager.whenIdle).
 * Inside the queue it reads the settings page first, so a recipe is looked up in the page's log
 * folder (settings\folders.ts; a failed read keeps the folder read before). Reading it there keeps
 * the call's place in the queue: a session begun while the page is read still waits for the sync
 * [handle: tests\sync.test.ts "refuses while a session is open, and a session begun during a sync
 * waits for it"; tests\settings-tools.test.ts "lr_sync_series looks for the recipe in the page's log folder"].
 */
export async function syncSeries(ctx: ToolContext, args: SyncSeriesArgs): Promise<ToolOutput> {
  return run(ctx, "lr_sync_series", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    const settings = ctx.deps.settings;
    return sessions.whenIdle("lr_sync_series", async () => {
      if (settings) await settings.read();
      const deps = {
        client: ctx.deps.client,
        map: ctx.deps.map,
        render: (request: Parameters<typeof renderRequest>[1]) => renderRequest(ctx, request),
        logDir: folderOf(ctx.deps.sessionLogDir as string | (() => string)), // sessionTools() refuses an engine without it
      };
      return runSync(deps, { ...args, long_edge: args.long_edge ?? DEFAULT_LONG_EDGE, quality: PREVIEW_QUALITY });
    });
  });
}

/**
 * In the session queue too: a preset reads the photo's settings between sessions, not a pass in
 * progress [inference: as lr_sync_series, PHASE4_PLAN row 8 decision 6].
 */
export async function createPresetFromActive(ctx: ToolContext, args: CreatePresetArgs): Promise<ToolOutput> {
  return run(ctx, "lr_create_preset_from_active", args, async () => {
    const dir = ctx.deps.presetDir;
    if (!dir) throw new ToolError("PRESET_FOLDER_MISSING", "This engine has no preset folder: %APPDATA% is not set, nor LRC_AVG_PRESET_DIR.", false);
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    const deps = { client: ctx.deps.client, map: ctx.deps.map, format: ctx.deps.presetFormat ?? loadDefaultPresetFormat(), dir };
    return sessions.whenIdle("lr_create_preset_from_active", () => createPreset(deps, args));
  });
}
