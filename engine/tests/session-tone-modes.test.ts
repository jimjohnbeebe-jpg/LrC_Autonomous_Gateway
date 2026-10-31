// Tone modes and look masks (PHASE10_PLAN "Third re-plan", rows 9+10; src/session/auto-tone.ts, look-brief.ts, pass0.ts)
// against the simulated Lightroom: "set" as before, "adapt" with its brief, "auto" with Lightroom's Auto Tone first
// (develop-sim's apply_auto sets Exposure2012 0.7), the begin argument over the intent's, the plugin check, the fallback
// when Auto fails, the dry run, revert after Auto, and a look's masks in the brief.

import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { installDevelop, type DevelopSim } from "./helpers/develop-sim.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { installPresets, newTools } from "./helpers/presets-sim.js";
import { ID, clean, client, fails, intent, lr, manager, map, plugin, readLog, tmp, useSessionHarness } from "./helpers/session-harness.js";

const LOOK = { schema_version: 3, set: { exposure: 0.3, contrast: 30, clarity: 10, vibrance: 15 } };
const sent = (name: string) => plugin.received.filter((r) => r.name === name);
const settings = () => map.fromSdk(lr.settings).settings;

describe("tone modes", () => {
  useSessionHarness();
  let develop: DevelopSim;
  beforeEach(() => {
    develop = installDevelop(plugin, lr);
    clean();
  });

  it('"set" (no tone_mode): writes the look\'s tones as given, sends no Auto, and adds no tone note', async () => {
    intent("look_set", LOOK);
    const out = await manager.begin({ intent_id: "look_set", return_image: "none" });
    expect(sent("apply_auto")).toEqual([]);
    expect(settings()).toMatchObject({ exposure: 0.3, contrast: 30, clarity: 10 });
    expect(out.json["intent_brief"]).toMatchObject({ tone_mode: "set" });
    expect((out.json["intent_brief"] as Record<string, unknown>)["tone_note"]).toBeUndefined();
    expect(out.json["auto_tone"]).toBeUndefined();
    expect(readLog().tone_mode).toBe("set");
  });

  it('"adapt": writes the tones as given and says they are a start to adapt toward the references', async () => {
    intent("look_adapt", { ...LOOK, tone_mode: "adapt" });
    const out = await manager.begin({ intent_id: "look_adapt", return_image: "none" });
    expect(sent("apply_auto")).toEqual([]);
    expect(settings()).toMatchObject({ exposure: 0.3, contrast: 30 });
    const brief = out.json["intent_brief"] as { tone_mode: string; tone_note: string };
    expect(brief.tone_mode).toBe("adapt");
    expect(brief.tone_note).toMatch(/starting point.*reference_gap/s);
  });

  it('"auto": Auto Tone first (tone only, its snapshot deleted), then the look\'s other values; revert puts the photo back', async () => {
    intent("look_auto", { ...LOOK, tone_mode: "auto", priors: { shadows: 10 } });
    const start = settings();
    const out = await manager.begin({ intent_id: "look_auto", return_image: "none" });
    const [auto] = sent("apply_auto");
    expect(auto?.payload).toMatchObject({ photo_uuid: "SIM-UUID", tone: true, white_balance: false, snapshot_name: "AVG abcdef pass 0/8 auto" });
    expect(develop.snapshots.get("SIM-UUID")?.map((s) => s.name)).not.toContain("AVG abcdef pass 0/8 auto");
    // Auto's exposure stays; the look's contrast and the shadows prior are skipped; clarity and vibrance are written on top.
    expect(settings()).toMatchObject({ exposure: 0.7, contrast: start["contrast"], shadows: start["shadows"], clarity: 10, vibrance: 15 });
    expect(out.json["auto_tone"]).toMatchObject({ status: "applied", changed: { exposure: { before: 0, after: 0.7 } } });
    expect((out.json["pass0_applied"] as Array<{ name: string }>).map((c) => c.name).sort()).toEqual(["clarity", "vibrance"]);
    expect(lr.history).toContain(`AVG ${ID.slice(0, 6)} pass 0/8`);
    expect(out.json["intent_brief"]).toMatchObject({ tone_mode: "auto", tone_note: expect.stringContaining("Auto Tone") });
    expect(readLog().passes[0]?.rationale).toContain("Lightroom Auto Tone first");
    await manager.end({ session_id: ID, outcome: "revert" });
    expect(settings()).toMatchObject({ exposure: start["exposure"], clarity: start["clarity"], vibrance: start["vibrance"] });
  });

  it("takes the begin argument over the intent's tone_mode", async () => {
    intent("look_auto", { ...LOOK, tone_mode: "auto" });
    const out = await manager.begin({ intent_id: "look_auto", tone_mode: "set", return_image: "none" });
    expect(sent("apply_auto")).toEqual([]);
    expect(settings()).toMatchObject({ exposure: 0.3, contrast: 30 });
    expect(out.json["intent_brief"]).toMatchObject({ tone_mode: "set" });
  });

  it("refuses tone_mode auto on a plugin without apply_auto, before the snapshot", async () => {
    lr.pluginVersion = "1.4.0"; // reconnect, so the next hello reports it
    const drops = client.stats.drops;
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === drops + 1);
    await client.waitConnected(2000);
    intent("look_auto", { ...LOOK, tone_mode: "auto" });
    const err = await fails(manager.begin({ intent_id: "look_auto", return_image: "none" }));
    expect(err.code).toBe("PLUGIN_TOO_OLD");
    expect(sent("create_snapshot")).toEqual([]);
  });

  it("writes the look's tonal values when Auto fails, and says so", async () => {
    plugin.handlers.set("apply_auto", (p) => ({ ok: true, payload: { uuid: String(p["photo_uuid"]), status: "failed", reason: "tone: no change in 8 s", read_back: structuredClone(lr.settings), ms: 5 } }));
    intent("look_auto", { ...LOOK, tone_mode: "auto" });
    const out = await manager.begin({ intent_id: "look_auto", return_image: "none" });
    expect(out.json["auto_tone"]).toMatchObject({ status: "failed", reason: "tone: no change in 8 s", changed: {} });
    expect(settings()).toMatchObject({ exposure: 0.3, contrast: 30, clarity: 10 });
  });

  it("dry run: lists the look's values Auto takes over, sends nothing", async () => {
    intent("look_auto", { ...LOOK, tone_mode: "auto" });
    const out = await manager.begin({ intent_id: "look_auto", dry_run: true });
    expect(out.json).toMatchObject({ dry_run: true, tone_mode: "auto", pass0: { skipped_for_auto: ["exposure", "contrast"] } });
    expect(Object.keys((out.json["pass0"] as { changes: object }).changes).sort()).toEqual(["clarity", "vibrance"]);
    expect(String(out.json["note"])).toContain("Auto Tone");
    expect(sent("apply_auto")).toEqual([]);
  });

  it("keeps lr_apply_auto itself refused while a session is open", async () => {
    installPresets();
    const tools = newTools();
    await tools.beginSession({ return_image: "none" });
    await expect(tools.applyAuto({ uuids: ["SIM-UUID"], tone: true })).rejects.toMatchObject({ code: expect.stringMatching(/SESSION/) });
    expect(sent("apply_auto")).toEqual([]);
  });
});

describe("a look's masks", () => {
  useSessionHarness();
  const masks = [
    { kind: "sky", name: "1. Sky - Deepen", purpose: "Darken and deepen the sky.", sliders: { "local.exposure": -0.5, "local.dehaze": 15 } },
    { kind: "subject", name: "2. Subject - Lift", purpose: "Lift the subject a little.", sliders: { "local.exposure": 0.2 } },
  ];

  it("returns them in the brief with how to make them; pass 0 creates none", async () => {
    clean();
    intent("look_masks", { schema_version: 3, masks });
    const out = await manager.begin({ intent_id: "look_masks", return_image: "none" });
    const brief = out.json["intent_brief"] as { masks: unknown; masks_note: string };
    expect(brief.masks).toEqual(masks);
    expect(brief.masks_note).toContain("lr_create_mask");
    expect(lr.settings["MaskGroupBasedCorrections"]).toBeUndefined();
  });

  it("validates kinds, sliders, the count and the schema version", () => {
    const lib = new IntentLibrary({ map, userDir: tmp });
    const look = { schema_version: 3, id: "x", label: "x", category: "c", brief: "b", priors: {} };
    expect(lib.check({ ...look, masks, tone_mode: "adapt" })).toMatchObject({ masks, tone_mode: "adapt" });
    expect(() => lib.check({ ...look, schema_version: 2, masks })).toThrow(/masks need schema_version 3/);
    expect(() => lib.check({ ...look, schema_version: 2, tone_mode: "auto" })).toThrow(/tone_mode needs schema_version 3/);
    expect(() => lib.check({ ...look, tone_mode: "bright" })).toThrow();
    expect(() => lib.check({ ...look, masks: [{ ...masks[0], kind: "person_entire" }] })).toThrow(/kind/); // needs a point
    expect(() => lib.check({ ...look, masks: [{ ...masks[0], sliders: { exposure: 1 } }] })).toThrow(/not a local slider/);
    expect(() => lib.check({ ...look, masks: [{ ...masks[0], sliders: { "local.exposure": 9 } }] })).toThrow(/outside -4..4/);
    expect(() => lib.check({ ...look, masks: Array.from({ length: 7 }, () => masks[1]) })).toThrow();
  });
});
