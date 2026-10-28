// GitHub issue #218 row 9 (plugin 1.5.0): lr_set_ai_metadata, lr_get_ai_metadata and the AVG stamp an accepted
// session leaves, against the simulated Lightroom with a stand-in for PluginMetadata.lua's two commands.

import { beforeEach, describe, expect, it } from "vitest";
import { AI_METADATA_DEFS } from "../src/mcp/defs-ai-metadata.js";
import { getAiMetadata, setAiMetadata } from "../src/mcp/tools-ai-metadata.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { plugin, sent, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

const EMPTY = { aiScore: "", aiReason: "", avgSession: "", avgLook: "", avgDate: "" };
let held: Map<string, Record<string, string>>;
const photos = (out: ToolOutput) => out.json["photos"] as Array<Record<string, unknown>>;

beforeEach(() => {
  held = new Map();
  const of = (uuid: string) => held.get(uuid) ?? { ...EMPTY };
  plugin.handlers.set("set_plugin_metadata", (p) => {
    const uuid = String(p["photo_uuid"]);
    const before = of(uuid);
    held.set(uuid, { ...before, ...(p["fields"] as Record<string, string>) });
    return { ok: true, payload: { uuid, before, after: of(uuid) } };
  });
  plugin.handlers.set("get_plugin_metadata", (p) => ({ ok: true, payload: { uuid: p["photo_uuid"], fields: of(String(p["photo_uuid"])) } }));
});

describe("lr_set_ai_metadata and lr_get_ai_metadata", () => {
  it("keeps a score and a reason, gives before and after, and null clears", async () => {
    const out = await tools.call(setAiMetadata, { uuids: ["SIM-UUID"], score: 87, reason: "sharp eye" });
    expect(sent("set_plugin_metadata")).toEqual([{ photo_uuid: "SIM-UUID", fields: { aiScore: "87", aiReason: "sharp eye" } }]);
    expect(photos(out)[0]).toMatchObject({ before: { score: null, reason: null }, after: { score: 87, reason: "sharp eye" }, changed: true });
    const read = await tools.call(getAiMetadata, { uuids: ["SIM-UUID"] });
    expect(photos(read)[0]).toMatchObject({ uuid: "SIM-UUID", score: 87, reason: "sharp eye", avg_edit: null });
    await tools.call(setAiMetadata, { uuids: ["SIM-UUID"], score: null });
    expect(sent("set_plugin_metadata")[1]).toEqual({ photo_uuid: "SIM-UUID", fields: { aiScore: "" } });
    expect(photos(await tools.call(getAiMetadata, { uuids: ["SIM-UUID"] }))[0]).toMatchObject({ score: null, reason: "sharp eye" });
  });

  it("takes scores 0-100 only and needs a score or a reason", () => {
    const schema = AI_METADATA_DEFS[0]?.schema;
    expect(schema?.safeParse({ uuids: ["A"], score: 101 }).success).toBe(false);
    expect(schema?.safeParse({ uuids: ["A"], score: 2.5 }).success).toBe(false);
    expect(schema?.safeParse({ uuids: ["A"] }).success).toBe(false);
    expect(schema?.safeParse({ uuids: ["A"], reason: null }).success).toBe(true);
  });
});

describe("the AVG stamp of an accepted session (session\\avg-stamp.ts)", () => {
  it("stamps the kept photo with the session id, the intent and the date; lr_get_ai_metadata reads it back", async () => {
    const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    const id = begun.json["session_id"] as string;
    const ended = await tools.endSession({ session_id: id, outcome: "accept" });
    expect(ended.json["avg_stamp"]).toBe("written");
    const stamp = sent("set_plugin_metadata")[0] as { photo_uuid: string; fields: Record<string, string> };
    expect(stamp).toMatchObject({ photo_uuid: "SIM-UUID", fields: { avgSession: id, avgLook: "test_plain" } });
    const read = await tools.call(getAiMetadata, { uuids: ["SIM-UUID"] });
    expect(photos(read)[0]).toMatchObject({ avg_edit: { session_id: id, look: "test_plain", date: stamp.fields["avgDate"] } });
  });

  it("keeps the edit when the plugin has no such command, and says so", async () => {
    plugin.handlers.delete("set_plugin_metadata");
    const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    const ended = await tools.endSession({ session_id: begun.json["session_id"] as string, outcome: "accept" });
    expect(ended.json).toMatchObject({ outcome: "accept", avg_stamp: expect.stringMatching(/^not written: /) });
  });

  it("writes no stamp on a revert", async () => {
    const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    const ended = await tools.endSession({ session_id: begun.json["session_id"] as string, outcome: "revert" });
    expect(ended.json).not.toHaveProperty("avg_stamp");
    expect(sent("set_plugin_metadata")).toEqual([]);
  });
});
