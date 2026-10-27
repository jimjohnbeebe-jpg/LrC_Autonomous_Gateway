// lr_get_photo_stats (issue #216, src/mcp/tools-stats.ts) against the Lightroom sim: one export per photo
// by uuid, input order kept, per-photo errors, the budget, cancellation, and the session refusal.

import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { withCallContext } from "../src/mcp/call-context.js";
import { CONTEXT_DEFS } from "../src/mcp/defs-context.js";
import { Tools, toToolError } from "../src/mcp/index.js";
import { MAX_STATS_PHOTOS, STATS_LONG_EDGE } from "../src/mcp/tools-stats.js";
import { PreviewService } from "../src/preview/index.js";
import { client, intent, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

let tools: Tools;
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

const exports = () => plugin.received.filter((r) => r.name === "export_preview").map((r) => r.payload);
type Photo = { uuid: string; ok: boolean; metrics?: Record<string, unknown>; error?: { code: string } };

describe("lr_get_photo_stats", () => {
  it("measures each photo by uuid in the order given, with sharpness, and gives a failing photo its own error", async () => {
    const out = await tools.getPhotoStats({ uuids: ["SIM-UUID", "NO-SUCH-PHOTO", "SIM-UUID"] });
    expect(exports().map((p) => p["photo_uuid"])).toEqual(["SIM-UUID", "NO-SUCH-PHOTO", "SIM-UUID"]);
    expect(exports().every((p) => p["long_edge"] === STATS_LONG_EDGE)).toBe(true);
    const photos = out.json["photos"] as Photo[];
    expect(photos.map((p) => [p.uuid, p.ok])).toEqual([["SIM-UUID", true], ["NO-SUCH-PHOTO", false], ["SIM-UUID", true]]);
    expect(typeof photos[0]?.metrics?.["sharpness"]).toBe("number");
    expect(photos[0]?.metrics).not.toHaveProperty("regions");
    expect(photos[1]?.error?.code).toBeTruthy();
    expect(out.json["counts"]).toEqual({ measured: 2, failed: 1 });
    expect(out.image).toBeUndefined();
    expect(tools.lastRender()).toBeNull(); // lr_get_metrics still describes the last preview
    expect(plugin.received.some((r) => r.name === "select_photo" || r.name === "apply_settings")).toBe(false);
  });

  it("stops starting photos when the budget is spent and returns the rest as not_yet", async () => {
    let t = 0;
    const out = await tools.getPhotoStats({ uuids: ["SIM-UUID", "SIM-UUID", "SIM-UUID"] }, { now: () => (t += 40), ms: 30 });
    expect((out.json["photos"] as Photo[]).length).toBe(1);
    expect(out.json["not_yet"]).toEqual(["SIM-UUID", "SIM-UUID"]);
    expect(String(out.json["next"])).toContain("Time is up");
  });

  it("stops starting photos once the client cancels the call", async () => {
    const controller = new AbortController();
    const exportPreview = plugin.handlers.get("export_preview");
    plugin.handlers.set("export_preview", (p, id) => {
      controller.abort();
      return exportPreview!(p, id);
    });
    const out = await withCallContext({ progressToken: false, signal: controller.signal }, () => tools.getPhotoStats({ uuids: ["SIM-UUID", "SIM-UUID"] }));
    expect(exports()).toHaveLength(1);
    expect(out.json["not_yet"]).toEqual(["SIM-UUID"]);
    expect(String(out.json["next"])).toContain("cancelled");
  });

  it("is refused while a session is open", async () => {
    intent("look");
    await tools.beginSession({ intent_id: "look" });
    const err = await tools.getPhotoStats({ uuids: ["SIM-UUID"] }).then(() => null, toToolError);
    expect(err?.code).toBe("SESSION_ALREADY_ACTIVE");
  });

  it(`takes 1-${MAX_STATS_PHOTOS} uuids and is read-only`, () => {
    const def = CONTEXT_DEFS.find((d) => d.name === "lr_get_photo_stats");
    expect(def?.annotations?.readOnlyHint).toBe(true);
    expect(def?.schema.safeParse({ uuids: [] }).success).toBe(false);
    expect(def?.schema.safeParse({ uuids: new Array(MAX_STATS_PHOTOS + 1).fill("a") }).success).toBe(false);
    expect(def?.schema.safeParse({ uuids: new Array(MAX_STATS_PHOTOS).fill("a") }).success).toBe(true);
  });
});
