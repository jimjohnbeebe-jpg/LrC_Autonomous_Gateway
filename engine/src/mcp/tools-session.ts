// The session tools (Phase 3; the loop itself is session\manager.ts): lr_begin_session, lr_step,
// lr_probe, lr_set_regions, lr_end_session, lr_get_session_log; Variants mode's lr_select_variant
// (Phase 4); approve_each_pass mode's lr_approve_pass (Phase 5); the mask tools lr_list_masks,
// lr_create_mask, lr_edit_mask and lr_delete_mask (engine 0.16.0, GitHub issue #59).

import { endedAlike, endedError, type ApproveArgs, type BeginArgs, type CreateMaskArgs, type DeleteMaskArgs, type EditMaskArgs, type EndArgs, type ListMasksArgs, type ProbeArgs, type RegionArgs, type SelectArgs, type StepArgs } from "../session/index.js";
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

/** No Lightroom call (the HUD hears of it through the publisher), and never queued behind a waiting lr_step (session\approval.ts). */
export async function approvePass(ctx: ToolContext, args: ApproveArgs): Promise<ToolOutput> {
  return run(ctx, "lr_approve_pass", args, { usesBridge: false }, async () => sessionTools(ctx).approvePass(args));
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
    // A session this engine does not hold may be one an engine that stopped left open (session\left-open.ts): it is
    // looked for in the page's log folder once read (Greptile, PR #141), with the bridge held, so no live engine holds
    // it, abandon included.
    if (sessions.current()?.id !== args.session_id && !sessions.userEnded(args.session_id)) {
      await ctx.deps.ensureBridge();
      if (ctx.deps.settings && !ctx.deps.settings.last()) await readPageFolders(ctx);
      const left = sessions.endLeftOpen(args);
      if (left) return left;
    }
    // "abandon" must work with Lightroom gone: it does not wait for the bridge (session\abandon.ts).
    if (args.outcome === "abandon") return sessions.end(args);
    // Nor does a session the user already ended on the Deck (issue #126): the same outcome succeeds, another
    // gets SESSION_ENDED, and neither needs a Lightroom call (Greptile, PR #137).
    const ended = sessions.userEnded(args.session_id);
    if (ended) {
      const alike = endedAlike(ended, args.outcome);
      if (alike) return alike;
      throw endedError(ended);
    }
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

export async function listMasks(ctx: ToolContext, args: ListMasksArgs): Promise<ToolOutput> {
  return run(ctx, "lr_list_masks", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.listMasks(args);
  });
}

export async function createMask(ctx: ToolContext, args: CreateMaskArgs): Promise<ToolOutput> {
  return run(ctx, "lr_create_mask", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.createMask(args);
  });
}

export async function editMask(ctx: ToolContext, args: EditMaskArgs): Promise<ToolOutput> {
  return run(ctx, "lr_edit_mask", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.editMask(args);
  });
}

export async function deleteMask(ctx: ToolContext, args: DeleteMaskArgs): Promise<ToolOutput> {
  return run(ctx, "lr_delete_mask", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.deleteMask(args);
  });
}
