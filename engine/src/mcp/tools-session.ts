// The session tools (Phase 3; the loop itself is session\manager.ts): lr_begin_session, lr_step,
// lr_probe, lr_set_regions, lr_end_session, lr_get_session_log; and Variants mode's
// lr_select_variant (Phase 4).

import type { BeginArgs, EndArgs, ProbeArgs, RegionArgs, SelectArgs, StepArgs } from "../session/index.js";
import { pageBridgeUse, readPageFolders, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

export async function beginSession(ctx: ToolContext, args: BeginArgs): Promise<ToolOutput> {
  return run(ctx, "lr_begin_session", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.begin(args);
  });
}

export async function step(ctx: ToolContext, args: StepArgs): Promise<ToolOutput> {
  return run(ctx, "lr_step", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.step(args);
  });
}

export async function selectVariant(ctx: ToolContext, args: SelectArgs): Promise<ToolOutput> {
  return run(ctx, "lr_select_variant", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.selectVariant(args);
  });
}

export async function probe(ctx: ToolContext, args: ProbeArgs): Promise<ToolOutput> {
  return run(ctx, "lr_probe", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.probe(args);
  });
}

export async function setRegions(ctx: ToolContext, args: RegionArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_regions", args, { usesBridge: false }, async () => sessionTools(ctx).setRegions(args));
}

export async function endSession(ctx: ToolContext, args: EndArgs): Promise<ToolOutput> {
  return run(ctx, "lr_end_session", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.end(args);
  });
}

/** With the settings page, it reads the page's log folder first, as the intent tools read theirs (tools-intents.ts). */
export async function getSessionLog(ctx: ToolContext, args: { session_id: string }): Promise<ToolOutput> {
  return run(ctx, "lr_get_session_log", args, pageBridgeUse(ctx), async () => {
    const page = await readPageFolders(ctx);
    const out = sessionTools(ctx).getLog(args);
    const settings = ctx.deps.settings;
    return page === null || !settings ? out : { ...out, json: { ...out.json, log_folder: { ...settings.folders.log(), page } } };
  });
}
