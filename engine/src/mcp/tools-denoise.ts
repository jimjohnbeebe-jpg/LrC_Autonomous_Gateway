// lr_apply_denoise (issue #190, the port of Automaat PR #288; plugin 1.1.0 Denoise.lua): Lightroom's AI Denoise
// on photos named by uuid, one plugin command per photo. Between sessions, in the session queue, as
// lr_export_photos (tools-files.ts): it drives the Develop module and the selection, which a session owns while
// it runs. Each photo Denoise changes gets a snapshot first, named in the result, as lr_sync_series does
// [stated: Jim, 2026-10-24, "Snapshot per photo"]; unchanged and skipped photos get none. Lightroom takes about
// 10 s per photo [upstream claim: Automaat PR #288], so a call does a few and returns `not_yet`.

import { randomUUID } from "node:crypto";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { eachInBudget, type Budget } from "./tools-files.js";
import { CALL_BUDGET_MS } from "../library/index.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** The plugin with apply_denoise (Denoise.lua). */
export const DENOISE_PLUGIN = "1.1.0";

export type ApplyDenoiseArgs = { uuids: string[]; amount: number };

type Outcome = { uuid: string; status: string; reason?: string | undefined; previous_amount?: number | undefined; snapshot?: { id: string; name: string } | undefined; ms: number };

export async function applyDenoise(ctx: ToolContext, args: ApplyDenoiseArgs, budget: Budget = { now: () => performance.now(), ms: CALL_BUDGET_MS }): Promise<ToolOutput> {
  return run(ctx, "lr_apply_denoise", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_apply_denoise", DENOISE_PLUGIN, "Lightroom's AI Denoise through the Develop module");
    const snapshotName = `AVG pre-denoise ${randomUUID().slice(0, 6)}`;
    return sessions.whenIdle("lr_apply_denoise", async () => {
      const photos: Outcome[] = [];
      // Lightroom can stop answering for 11 s or more just after a Denoise, more than the 6 s heartbeat
      // allowed outside a session [handle: issue #226, bridge.log "stall 10962 ms" after a Z8 NEF]: ride
      // it out, during the command and for a while after it.
      const { failed, left } = await eachInBudget(args.uuids, budget, () => photos, async (uuid) => {
        ctx.deps.allowQuiet?.();
        try {
          photos.push(await ctx.deps.client.request("apply_denoise", { photo_uuid: uuid, amount: args.amount, snapshot_name: snapshotName }, { timeoutMs: WRITE_TIMEOUT_MS }));
        } finally {
          ctx.deps.allowQuiet?.();
        }
      });
      const count = (s: string): number => photos.filter((p) => p.status === s).length;
      const json = {
        amount: args.amount,
        photos,
        counts: { applied: count("applied"), amount_changed: count("amount_changed"), unchanged: count("unchanged"), skipped: count("skipped"), failed: count("failed") + failed.length },
        failed: failed.map((f) => ({ uuid: f.item, code: f.code, message: f.message })),
        undo: `Each changed photo has the snapshot "${snapshotName}" (Develop, Snapshots panel) from just before Denoise.`,
        note: "Lightroom computes Denoise in the background (its Activity Center shows it); a render right after may not show it yet.",
        ...(left.length > 0 ? { not_yet: left, next: `Time is up for this call: call again with uuids = not_yet (${left.length} photos) and the same amount.` } : {}),
      };
      return { json, log: { amount: args.amount, snapshot_name: snapshotName, counts: json.counts, not_yet: left.length } };
    });
  });
}
