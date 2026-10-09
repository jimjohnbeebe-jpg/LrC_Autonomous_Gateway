// Shared set-up of the lr_sync_series tests (sync.test.ts, sync-adaptive.test.ts): the session
// harness (the simulated Lightroom in its "tonal" model behind a fake plugin), plus the Tools class
// on the same client, so a sync goes through the tool layer and the session queue as it does from
// Claude Desktop. Photos to sync to are virtual copies of the master put straight into the sim.

import path from "node:path";
import { beforeEach } from "vitest";
import { IntentLibrary } from "../../src/intents/index.js";
import { Tools, toToolError, type ToolError } from "../../src/mcp/index.js";
import type { SyncSeriesArgs } from "../../src/mcp/tools-propagation.js";
import type { Pipeline } from "../../src/params/index.js";
import { PreviewService } from "../../src/preview/index.js";
import { client, clean, logDir, lr, map, plugin, tmp, useSessionHarness, userDir } from "./session-harness.js";

export { clean, client, logDir, lr, map, plugin, tmp };

export let tools: Tools;

/** Register the per-test set-up; call once at the top of a sync test file. */
export function useSyncHarness(pipeline: Pipeline = "raw"): void {
  useSessionHarness(pipeline);
  beforeEach(() => {
    tools = new Tools({
      client,
      map,
      previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
      intents: new IntentLibrary({ map, userDir }),
      sessionLogDir: logDir,
      engineVersion: "test",
      ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    });
  });
}

/** A virtual copy of the master in the sim, with the master's settings and `changes` on top. */
export function addCopy(n: number, changes: Record<string, unknown> = {}): string {
  const uuid = `SIM-COPY-${n}`;
  lr.copies.set(uuid, { uuid, local_id: 100 + n, copy_name: `Burst ${n}`, settings: { ...structuredClone(lr.settings), ...changes } });
  return uuid;
}

export const sync = (args: SyncSeriesArgs) => tools.syncSeries(args);

/** The error a failed call reaches Claude as. */
export async function syncFails(args: SyncSeriesArgs): Promise<ToolError> {
  try {
    await tools.syncSeries(args);
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected lr_sync_series to fail");
}

/** Begin and accept a Converge session on the master, after `steps`; returns its id and recipe path. */
export async function acceptedSession(steps: Array<Record<string, unknown>> = []): Promise<{ id: string; recipe: string }> {
  const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
  const id = begun.json["session_id"] as string;
  for (const settings of steps) await tools.step({ session_id: id, settings, rationale: "test", return_image: "none" });
  const ended = await tools.endSession({ session_id: id, outcome: "accept" });
  return { id, recipe: ended.json["recipe_path"] as string };
}

/** Commands the fake plugin received, by name. */
export const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);
