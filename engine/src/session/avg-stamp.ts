// The AVG stamp (GitHub issue #218 row 9): when a session is accepted, the kept photo gets the session id, the intent
// (its look) and the date in the plugin's private metadata (plugin\LrC-AVG.lrplugin\PluginMetadata.lua), fields that
// Lightroom can show and search (MetadataDefinition.lua), so AVG edits can be found in Lightroom. The stamp is
// catalog metadata, not a Develop setting, and never stops an accept: a plugin without the command, or a refused
// write, leaves the edit kept and says why in lr_end_session's `avg_stamp`. Plain arguments, not the session types:
// importing types.ts here would close a file cycle (arch:check).

import type { BridgeClient } from "../bridge/index.js";

export type AvgStamp = { photoUuid: string; sessionId: string; look: string; date: Date; timeoutMs: number };

/** "written", or why the stamp was not. */
export async function stampAvg(client: BridgeClient, a: AvgStamp): Promise<string> {
  const fields = { avgSession: a.sessionId, avgLook: a.look, avgDate: a.date.toISOString() };
  try {
    const r = await client.request("set_plugin_metadata", { photo_uuid: a.photoUuid, fields }, { timeoutMs: a.timeoutMs });
    return r.write_error ?? r.after_error ?? (r.after?.avgSession === a.sessionId ? "written" : "Lightroom did not read the session id back");
  } catch (err) {
    return `not written: ${err instanceof Error ? err.message : String(err)}`;
  }
}
