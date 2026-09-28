// lr_sync_series' targets: "selected" (the photos selected in Lightroom) or a list of uuids
// [stated: Jim, 2026-09-27, "go with recommendations" on the row 8 plan, decision 1: MCP_TOOLS'
// `collection:<id>` and local-id list are not in v1; photos are named by uuid, as select_photo does].
// The source photo is never a target of its own sync. The plugin refuses "selected" when no photo
// is selected, since Lightroom would then give the whole filmstrip [handle:
// plugin\LrC-AVG.lrplugin\Catalog.lua getSelection].

import type { BridgeClient } from "../bridge/index.js";
import { ToolError, toToolError } from "../mcp/errors.js";

export type SyncTargets = "selected" | { uuids: string[] };
/**
 * A photo the sync did not finish, and why. `snapshot` and `history_names`: a target that failed
 * after its snapshot, with the steps written before the failure.
 */
export type Skip = {
  uuid: string | null;
  filename: string | null;
  code: string;
  reason: string;
  snapshot?: { name: string; id: string };
  history_names?: string[];
};
/** What a failed target's error details can carry (target.ts failedAfterSnapshot). */
export type FailureDetails = Partial<Skip> & { snapshot_name?: string; maybe_written?: string };

/**
 * The uuids to write to, in order, and the photos left out. More than `cap` photos to write is
 * refused before anything is written (TOO_MANY_TARGETS), as is a sync with no target left. The
 * source photo and photos without a uuid do not count (Greptile, PR #35) [handle: tests\sync.test.ts
 * '"selected": a photo without a uuid is skipped and does not count toward the cap']. A selection
 * the plugin did not describe in full is refused too: the photos it left out would be neither
 * synced nor listed as skipped.
 */
export async function resolveTargets(client: BridgeClient, targets: SyncTargets, sourceUuid: string | null, cap: number): Promise<{ uuids: string[]; skipped: Skip[] }> {
  const unique = targets === "selected" ? [] : [...new Set(targets.uuids)];
  const listed = targets === "selected" ? await selected(client) : { uuids: unique, skipped: [], count: unique.length, described: unique.length };
  const skipped = [...listed.skipped];
  const uuids: string[] = [];
  for (const uuid of listed.uuids) {
    if (uuid === sourceUuid) skipped.push({ uuid, filename: null, code: "SOURCE", reason: "the source photo is not synced to itself" });
    else uuids.push(uuid);
  }
  const unseen = listed.count - listed.described;
  if (uuids.length > cap || unseen > 0) {
    const n = unseen > 0 ? `${listed.count} photos are selected` : `${uuids.length} target photos`;
    throw new ToolError(
      "TOO_MANY_TARGETS",
      `${n}; one lr_sync_series call takes at most ${cap} (see the tool description). Sync them in groups of ${cap} or fewer; nothing was written.`,
      false,
      { targets: uuids.length + unseen, cap },
    );
  }
  if (uuids.length === 0) {
    throw new ToolError("NO_TARGETS", "No photo to sync to: the targets are only the source photo, or have no uuid. Nothing was written.", false, { skipped });
  }
  return { uuids, skipped };
}

/**
 * How many selected photos the plugin is asked to describe: more than any cap, so the source photo
 * and photos without a uuid can be among them and still leave `cap` photos to write [inference: the
 * figure; it is the plugin's own default, plugin\LrC-AVG.lrplugin\Catalog.lua getSelection].
 */
export const SELECTION_DESCRIBED = 100;

async function selected(client: BridgeClient): Promise<{ uuids: string[]; skipped: Skip[]; count: number; described: number }> {
  let res;
  try {
    res = await client.request("get_selection", { max: SELECTION_DESCRIBED });
  } catch (err) {
    const error = toToolError(err);
    if (error.code !== "NO_ACTIVE_PHOTO") throw error;
    throw new ToolError("NO_ACTIVE_PHOTO", "No photo is selected in Lightroom: select the photos to sync to, or name them with targets {uuids}.", true);
  }
  const skipped: Skip[] = [];
  const uuids: string[] = [];
  for (const p of res.photos) {
    if (typeof p.uuid === "string") uuids.push(p.uuid);
    else skipped.push({ uuid: null, filename: p.filename ?? null, code: "NO_UUID", reason: `Lightroom gave no uuid for photo ${p.local_id}` });
  }
  return { uuids, skipped, count: res.count, described: res.photos.length };
}
