// The session tools (Phase 3; the loop itself is session\manager.ts): lr_begin_session, lr_step,
// lr_probe, lr_set_regions, lr_end_session, lr_get_session_log.

import type { BeginArgs, EndArgs, ProbeArgs, RegionArgs, StepArgs } from "../session/index.js";
import { run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

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

export async function getSessionLog(ctx: ToolContext, args: { session_id: string }): Promise<ToolOutput> {
  return run(ctx, "lr_get_session_log", args, { usesBridge: false }, async () => sessionTools(ctx).getLog(args));
}
