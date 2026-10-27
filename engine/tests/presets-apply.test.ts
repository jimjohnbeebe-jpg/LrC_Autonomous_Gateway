// lr_apply_preset and lr_create_checkpoint (issue #215; tools-presets.ts, presets\apply.ts, checkpoint.ts) against the
// fake plugin (helpers\presets-sim.ts): the safety layer (snapshot, "AVG …" History name, before and after, the AI
// update in its own command, refusal while a session is open), the budget, and the versioned checkpoint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Tools } from "../src/mcp/index.js";
import { installPresets, newTools, SKY_TABLE } from "./helpers/presets-sim.js";
import { fails, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();
let tools: Tools;
let sim: ReturnType<typeof installPresets>;
beforeEach(() => {
  sim = installPresets();
  tools = newTools();
});
afterEach(() => vi.restoreAllMocks());
const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload as Record<string, unknown>);
const order = () => plugin.received.map((r) => r.name).filter((n) => ["create_snapshot", "apply_preset", "update_ai_settings"].includes(n));
const ticking = (step: number, ms: number) => {
  let t = 0;
  return { now: () => (t += step), ms };
};

describe("lr_apply_preset", () => {
  it("snapshots each photo first, applies under an AVG History name, and returns the settings before and after", async () => {
    lr.settings["Exposure2012"] = 0;
    const out = (await tools.applyPreset({ preset_uuid: "U-WARM", uuids: ["SIM-UUID"] })).json;
    expect(order()).toEqual(["create_snapshot", "apply_preset"]);
    const snapName = String(sent("create_snapshot")[0]?.["name"]);
    expect(snapName).toMatch(/^AVG pre-preset [0-9a-f]{6}$/);
    expect(String(sent("apply_preset")[0]?.["history_name"])).toMatch(/^AVG preset [0-9a-f]{6}: Warm$/);
    expect(sent("apply_preset")[0]).toMatchObject({ photo_uuid: "SIM-UUID", preset_uuid: "U-WARM", scope: "lightroom" });
    const [applied] = out["applied"] as Array<Record<string, unknown>>;
    expect(applied).toMatchObject({ uuid: "SIM-UUID", snapshot: { id: "SNAP-1", name: snapName }, before: { exposure: 0 }, after: { exposure: 0.5, contrast: 10 } });
    expect(applied?.["ai_update"]).toBeUndefined();
    expect(String(out["undo"])).toContain(snapName);
  });

  it("puts a photo back from its snapshot", async () => {
    const before = structuredClone(lr.settings);
    await tools.applyPreset({ preset_uuid: "U-WARM", uuids: ["SIM-UUID"] });
    expect(lr.settings["Exposure2012"]).toBe(0.5);
    await plugin.handlers.get("apply_snapshot")?.({ photo_uuid: "SIM-UUID", snapshot_id: "SNAP-1" }, "x");
    expect(lr.settings).toEqual(before);
  });

  it("asks for the AI update in its own command, with the guard over the preset's AI entries, never in apply_preset", async () => {
    const out = (await tools.applyPreset({ preset_uuid: "U-SKY", uuids: ["SIM-UUID"] })).json;
    expect(order()).toEqual(["create_snapshot", "apply_preset", "update_ai_settings"]);
    expect(Object.keys(sent("apply_preset")[0] ?? {})).not.toContain("updateAISettings");
    expect(sent("update_ai_settings")[0]).toMatchObject({ photo_uuid: "SIM-UUID", watch: { ids: [SKY_TABLE[0]?.CorrectionID] } });
    expect((out["applied"] as Array<Record<string, unknown>>)[0]?.["ai_update"]).toBe("started");
    expect(out["ai_note"]).toBeDefined();
  });

  it("reports a Lightroom too old for the AI update on the photo, and keeps the preset applied", async () => {
    lr.masks.tableRoute = "unavailable";
    const out = (await tools.applyPreset({ preset_uuid: "U-SKY", uuids: ["SIM-UUID"] })).json;
    expect(String((out["applied"] as Array<Record<string, unknown>>)[0]?.["ai_update"])).toMatch(/^not started: .*13\.3/);
  });

  it("lists a photo that fails and goes on with the others; stops at the budget with not_yet", async () => {
    const out = (await tools.applyPreset({ preset_uuid: "P-1", uuids: ["GONE", "SIM-UUID"] })).json;
    expect((out["failed"] as Array<{ uuid: string }>).map((f) => f.uuid)).toEqual(["GONE"]);
    expect((out["applied"] as unknown[]).length).toBe(1);
    expect(sent("apply_preset").map((p) => p["scope"])).toEqual(["plugin"]);
    const timed = (await tools.applyPreset({ preset_uuid: "P-1", uuids: ["SIM-UUID", "B", "C"] }, ticking(20_000, 30_000))).json;
    expect(timed["not_yet"]).toEqual(["C"]);
  });

  it("refuses a photo a stopped engine's session was left open on, and writes nothing to it", async () => {
    const left = [{ file: "x.json", log: { session_id: "20261027-aaaaaa", target: { uuid: "SIM-UUID" }, variants: [], snapshot: { name: "AVG pre-session", id: "S-LEFT" } } }];
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValue(left as never);
    const out = (await tools.applyPreset({ preset_uuid: "U-WARM", uuids: ["SIM-UUID"] })).json;
    expect(out["failed"]).toEqual([{ uuid: "SIM-UUID", code: "SESSION_LEFT_OPEN", message: expect.stringContaining("20261027-aaaaaa") }]);
    expect(order()).toEqual([]);
  });

  it("refuses an ambiguous name and an open session before anything is written", async () => {
    expect((await fails(tools.applyPreset({ preset_name: "Warm", uuids: ["SIM-UUID"] }))).code).toBe("PRESET_AMBIGUOUS");
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    plugin.received.length = 0;
    expect((await fails(tools.applyPreset({ preset_uuid: "U-WARM", uuids: ["SIM-UUID"] }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(order()).toEqual([]);
  });
});

describe("lr_create_checkpoint", () => {
  it("captures the selected photo's settings as a plugin checkpoint, not visible in the Develop panel", async () => {
    const out = (await tools.createCheckpoint({ name: "Warm v2", categories: ["basic_tone"] })).json;
    expect(out).toMatchObject({ ok: true, checkpoint: { name: "Warm v2", scope: "plugin" }, source: { uuid: "SIM-UUID" }, visible_in_develop_panel: false });
    const [made] = sim.created;
    expect(made?.settings).toMatchObject({ ProcessVersion: lr.settings["ProcessVersion"], Exposure2012: lr.settings["Exposure2012"] });
    expect(Object.keys(made?.settings ?? {})).not.toContain("Temperature");
  });

  it("stores exactly the canonical settings given, for the photo's process version", async () => {
    await tools.createCheckpoint({ name: "Look v1", settings: { contrast: 15, exposure: 0.25 } });
    expect(sim.created[0]?.settings).toEqual({ ProcessVersion: lr.settings["ProcessVersion"], Contrast2012: 15, Exposure2012: 0.25 });
  });

  it("refuses a name in use with the next version, and a bad parameter, before anything is created", async () => {
    const e = await fails(tools.createCheckpoint({ name: "Warm v1" }));
    expect([e.code, (e.details as { suggested_name: string }).suggested_name]).toEqual(["PRESET_EXISTS", "Warm v2"]);
    expect((await fails(tools.createCheckpoint({ name: "Bad", settings: { nonsense: 1 } }))).code).toBe("UNKNOWN_PARAMETER");
    expect((await fails(tools.createCheckpoint({ name: "a/b" }))).code).toBe("INVALID_PRESET_NAME");
    expect(sent("create_checkpoint")).toEqual([]);
  });
});
