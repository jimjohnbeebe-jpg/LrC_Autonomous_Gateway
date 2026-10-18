// The plugin's guard on a photo whose AI mask has no result (plugin\LrC-AVG.lrplugin\Pending.lua, plugin 0.20.0) and how
// the engine drops it with clear_pending_ai: by an abandon (abandon.ts, issue #124), by a session left open (left-open.ts)
// and by a stuck mask Lightroom later ended with no result (ai-update.ts settlePending, issue #181). Moved out of abandon.ts
// for the last: a leaf file on purpose, as arch-check fails any new import cycle and ai-update.ts is reached from abandon.ts.

import { pluginVersionAtLeast, type BridgeClient } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";
import { aiTimings, type AiTimings } from "./ai-timings.js";

/** The plugin that has clear_pending_ai (Pending.lua); the engine waits for its answer aiTimings' clearMs, 5 s. */
export const CLEAR_PENDING_PLUGIN = "0.20.0";

/** What became of the plugin's guard on the photo. */
export type GuardOutcome = "none" | "cleared" | "not_cleared" | "plugin_too_old";

/**
 * Drop the plugin's guard on photo `uuid`, whose AI mask is pending (null: none is); never throws. `ifAny`: a photo that
 * may have none (left-open.ts), so the plugin's answer that it had none is "none". `ctx`: a SessionContext, written
 * structurally so that this file imports nothing of the session.
 */
export async function dropGuard(ctx: { deps: { client: BridgeClient; aiTimings?: Partial<AiTimings> } }, uuid: string | null, ifAny = false): Promise<{ guard: GuardOutcome; error?: string }> {
  if (!uuid) return { guard: "none" };
  const { client } = ctx.deps;
  if (client.getState() !== "connected") return { guard: "not_cleared", error: "Lightroom is not connected" };
  if (!pluginVersionAtLeast(client.hello()?.plugin_version, CLEAR_PENDING_PLUGIN)) return { guard: "plugin_too_old" };
  // The bridge's own timeout waits on while the plugin is paused (bridge\client.ts send), so a hung Lightroom with its
  // socket open would hold the queue until the heartbeat drops it (Greptile, PR #134): a deadline of its own.
  const ms = aiTimings(ctx).clearMs;
  const sent = client.request("clear_pending_ai", { photo_uuid: uuid }, { timeoutMs: ms });
  sent.catch(() => undefined); // an answer after the deadline is dropped
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError("BRIDGE_TIMEOUT", `clear_pending_ai: no answer within ${ms} ms`, true)), ms);
  });
  try {
    const res = await Promise.race([sent, deadline]);
    return { guard: ifAny && !res.cleared ? "none" : "cleared" };
  } catch (err) {
    return { guard: "not_cleared", error: toToolError(err).code };
  } finally {
    clearTimeout(timer);
  }
}

export const GUARD_NOTE: Record<GuardOutcome, string> = {
  none: "",
  cleared:
    " Lightroom was told to stop holding writes to the photo for the AI mask; if Lightroom may still be working on it, restarting Lightroom first is the safe way.",
  not_cleared: " Lightroom could not be told to stop holding writes to the photo for the AI mask: it refuses them until it restarts.",
  plugin_too_old: ` Lightroom refuses writes to the photo until it restarts (the plugin before ${CLEAR_PENDING_PLUGIN} cannot be told to stop).`,
};
