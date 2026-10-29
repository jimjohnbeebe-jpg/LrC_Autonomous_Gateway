// The session tools (Phase 3; the loop itself is session\manager.ts): lr_begin_session, lr_step,
// lr_probe, lr_set_regions, lr_end_session, lr_get_session_log; Variants mode's lr_select_variant
// (Phase 4); approve_each_pass mode's lr_approve_pass (Phase 5); the mask tools lr_list_masks,
// lr_create_mask, lr_edit_mask and lr_delete_mask (engine 0.16.0, GitHub issue #59).

import { endedAlike, endedError, type SessionManager, type ApproveArgs, type BeginArgs, type CreateMaskArgs, type DeleteMaskArgs, type EditMaskArgs, type EndArgs, type ListMasksArgs, type ProbeArgs, type RegionArgs, type SelectArgs, type StepArgs } from "../session/index.js";
import { callClient } from "./call-context.js";
import { ToolError } from "./errors.js";
import { pageBridgeUse, readPageFolders, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** A session tool's arguments with session_id optional (issue #164): withOpen fills it in. */
export type OpenArgs<T> = T extends unknown ? Omit<T, "session_id"> & { session_id?: string | undefined } : never;

/**
 * Issue #164: a call that leaves session_id out names the session open in this engine (one at a time,
 * sessionmanager.ts); with none open it is refused with SESSION_NOT_ACTIVE, as a wrong id is.
 */
function withOpen<T extends { session_id?: string | undefined }>(sessions: SessionManager, args: T): T & { session_id: string } {
  if (args.session_id !== undefined) return { ...args, session_id: args.session_id };
  const open = sessions.current();
  if (!open) {
    throw new ToolError("SESSION_NOT_ACTIVE", "No session is open, so session_id cannot be left out: start one with lr_begin_session, or give the session_id you mean (a session the user ended on the Deck is closed).", true, { session_id: null, open_session_id: null });
  }
  return { ...args, session_id: open.id };
}

export async function beginSession(ctx: ToolContext, args: BeginArgs): Promise<ToolOutput> {
  return run(ctx, "lr_begin_session", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    // The client that sent the call (clientInfo, issue #155 R1); run() has logged the args as sent.
    return sessions.begin({ ...args, client: callClient() });
  });
}

export async function step(ctx: ToolContext, args: OpenArgs<StepArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_step", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.step(withOpen(sessions, args));
  });
}

export async function selectVariant(ctx: ToolContext, args: OpenArgs<SelectArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_select_variant", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.selectVariant(withOpen(sessions, args));
  });
}

/** No Lightroom call (the HUD hears of it through the publisher), and never queued behind a waiting lr_step (session\approval.ts). */
export async function approvePass(ctx: ToolContext, args: OpenArgs<ApproveArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_approve_pass", args, { usesBridge: false }, async () => {
    const sessions = sessionTools(ctx);
    return sessions.approvePass(withOpen(sessions, args));
  });
}

export async function probe(ctx: ToolContext, args: OpenArgs<ProbeArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_probe", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.probe(withOpen(sessions, args));
  });
}

export async function setRegions(ctx: ToolContext, args: OpenArgs<RegionArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_set_regions", args, { usesBridge: false }, async () => {
    const sessions = sessionTools(ctx);
    return sessions.setRegions(withOpen(sessions, args));
  });
}

export async function endSession(ctx: ToolContext, given: OpenArgs<EndArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_end_session", given, async () => {
    const sessions = sessionTools(ctx);
    const args = withOpen(sessions, given);
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

export async function listMasks(ctx: ToolContext, args: OpenArgs<ListMasksArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_list_masks", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.listMasks(withOpen(sessions, args));
  });
}

export async function createMask(ctx: ToolContext, args: OpenArgs<CreateMaskArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_create_mask", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.createMask(withOpen(sessions, args));
  });
}

export async function editMask(ctx: ToolContext, args: OpenArgs<EditMaskArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_edit_mask", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.editMask(withOpen(sessions, args));
  });
}

export async function deleteMask(ctx: ToolContext, args: OpenArgs<DeleteMaskArgs>): Promise<ToolOutput> {
  return run(ctx, "lr_delete_mask", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.deleteMask(withOpen(sessions, args));
  });
}
