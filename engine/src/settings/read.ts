// Reading the settings page through the bridge (get_prefs, plugin 0.5.0). AVG-006: the engine reads
// the settings at session start; the intent tools, lr_get_session_log and lr_sync_series read the
// page too, for its folders (folders.ts). A read never fails a tool: without an answer the caller
// keeps its defaults (or the folders read before), and `note` says why the page was not read, so a
// page value that was not used cannot pass unnoticed.

import { BridgeError, pluginVersionAtLeast, type BridgeClient } from "../bridge/index.js";
import { parsePage, type PageValues } from "./page.js";

/** get_prefs comes with plugin 0.5.0 (plugin\LrC-AVG.lrplugin\Prefs.lua). */
export const PREFS_PLUGIN = "0.5.0";

export type PageRead = {
  /** True when get_prefs answered. */
  read: boolean;
  /** The page's valid values; a field left out takes its default. */
  values: Partial<PageValues>;
  /** Each field left out, and why. */
  problems: string[];
  /** Why the page was not read; null when it was. */
  note: string | null;
};

/**
 * `timeoutMs`: how long get_prefs may take; the client's request timeout when absent. The tools that
 * only need the folders give it what is left of their wait (Greptile, PR #44).
 */
export async function readPage(client: BridgeClient, timeoutMs?: number): Promise<PageRead> {
  const hello = client.hello();
  if (!hello) return { read: false, values: {}, problems: [], note: "Lightroom is not connected" };
  const version = hello.plugin_version;
  if (!pluginVersionAtLeast(version, PREFS_PLUGIN)) {
    return { read: false, values: {}, problems: [], note: `the LrC-AVG plugin ${version} has no settings page (it comes with ${PREFS_PLUGIN})` };
  }
  try {
    const raw = await client.request("get_prefs", {}, timeoutMs !== undefined ? { timeoutMs } : {});
    return { read: true, ...parsePage(raw), note: null };
  } catch (err) {
    const why = err instanceof BridgeError ? `${err.code}: ${err.message}` : String(err);
    return { read: false, values: {}, problems: [], note: `get_prefs failed (${why})` };
  }
}
