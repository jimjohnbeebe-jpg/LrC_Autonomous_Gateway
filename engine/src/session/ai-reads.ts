// The two reads of the wait for an AI mask (ai-update.ts): the mask table, and the plugin's write-gate probe with its
// record of the update. Moved out of ai-update.ts in issue #181, for settlePending to use them as well: a leaf file
// on purpose (arch-check fails any new import cycle), so the context and the job are written structurally.

import type { BridgeClient, CommandResult } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import { firstComponent, readTable, type SdkSettings } from "../params/index.js";
import type { AiTimings } from "./ai-timings.js";

/** An AiJob as the reads need it: the entry's id and its photo. */
export type JobRef = { id: string; t: { uuid: string } };
/** The plugin's record of the last update_ai_settings. */
export type UpdateRecord = NonNullable<CommandResult<"probe_write_gate">["update"]>;

/** The probe's record of an update: this request's (its token), or of the photo when the plugin sent no token. */
export const ownUpdate = (p: CommandResult<"probe_write_gate"> | null, job: JobRef, token: string): UpdateRecord | null => {
  const u = p?.update;
  if (!u) return null;
  return (u.request_id !== undefined ? u.request_id === token : u.uuid === undefined || u.uuid === job.t.uuid) ? u : null;
};

/** The table and the entry's component; null when Lightroom did not answer the read in time. */
export async function look(ctx: { deps: { client: BridgeClient } }, job: JobRef): Promise<{ sdk: SdkSettings; m: Record<string, unknown> | null } | null> {
  try {
    const sdk = (await ctx.deps.client.request("get_settings", { photo_uuid: job.t.uuid })).settings;
    return { sdk, m: firstComponent(readTable(sdk), job.id) };
  } catch (err) {
    if (toToolError(err).code === "BRIDGE_TIMEOUT") return null;
    throw err;
  }
}

/** probe_write_gate; null when the plugin lacks it or did not answer. */
export async function probe(ctx: { deps: { client: BridgeClient } }, T: Pick<AiTimings, "probeReplyMs">): Promise<CommandResult<"probe_write_gate"> | null> {
  try {
    return await ctx.deps.client.request("probe_write_gate", {}, { timeoutMs: T.probeReplyMs });
  } catch (err) {
    if (toToolError(err).code === "BRIDGE_DISCONNECTED") throw err;
    return null;
  }
}
