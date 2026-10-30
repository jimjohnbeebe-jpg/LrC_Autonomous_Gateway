// Making and finding looks (PHASE10_PLAN "Third re-plan", rows 9+10): from_photo's AI masks and tone_mode, from_preset
// (src/mcp/look-capture.ts, tools-intents.ts) against the simulated Lightroom and its presets; the look prompts
// (src/mcp/prompts.ts) through a real MCP client; the server instructions and the edit profile.

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { beforeEach, describe, expect, it } from "vitest";
import type { IntentSummary } from "../src/intents/index.js";
import { INSTRUCTIONS } from "../src/mcp/defs-help.js";
import { createServer, type Tools } from "../src/mcp/index.js";
import { EDIT_TOOLS } from "../src/mcp/profiles.js";
import { installPresets, newTools } from "./helpers/presets-sim.js";
import { clean, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

const candidate = { id: "my_look", label: "My look", category: "look", brief: "A look." };

const correction = (id: string, name: string, part: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  What: "Correction",
  CorrectionID: id,
  CorrectionName: name,
  CorrectionActive: true,
  CorrectionMasks: [{ What: "Mask/Image", MaskID: `M-${id}`, MaskVersion: 1, ...part }],
  ...extra,
});

describe("lr_save_intent from_photo and from_preset", () => {
  useSessionHarness();
  let tools: Tools;
  beforeEach(() => {
    clean();
    installPresets();
    tools = newTools();
  });

  it("from_photo: tone_mode adapt, and the photo's AI masks with no point, without geometry", async () => {
    lr.settings["MaskGroupBasedCorrections"] = [
      correction("C-1", "1. Sky - Deepen", { MaskSubType: 2 }, { LocalExposure2012: -0.25, LocalDehaze: 0.2 }),
      correction("C-2", "2. Person", { MaskSubType: 0, MaskSubCategoryID: 20036 }), // one person: needs a point
      correction("C-3", "3. Vignette", { What: "Mask/CircularGradient" }),
      correction("C-4", "4. Sky - Faint", { MaskSubType: 2 }, { LocalExposure2012: -0.25, CorrectionAmount: 0.66 }), // made at Amount 1, it would be stronger
    ];
    const out = await tools.saveIntent({ intent: candidate, confirmed: false, from_photo: true, dry_run: true });
    const intent = out.json["intent"] as { tone_mode: string; masks: unknown[] };
    expect(intent.tone_mode).toBe("adapt");
    expect(intent.masks).toEqual([{ kind: "sky", name: "1. Sky - Deepen", purpose: expect.stringContaining("1. Sky - Deepen"), sliders: { "local.exposure": -1, "local.dehaze": 20 } }]);
    const info = out.json["from_photo"] as { masks_captured: number; masks_skipped: string[] };
    expect(info.masks_captured).toBe(1);
    expect(info.masks_skipped).toHaveLength(3);
    expect(info.masks_skipped[2]).toContain("Amount is 0.66");
  });

  it("from_photo keeps the candidate's own tone_mode and masks", async () => {
    lr.settings["MaskGroupBasedCorrections"] = [correction("C-1", "Sky", { MaskSubType: 2 }, { LocalExposure2012: -0.25 })];
    const own = { ...candidate, tone_mode: "set", masks: [] };
    const intent = (await tools.saveIntent({ intent: own, confirmed: false, from_photo: true, dry_run: true })).json["intent"] as Record<string, unknown>;
    expect(intent).toMatchObject({ tone_mode: "set", masks: [] });
  });

  it("from_preset by name: canonical settings into set, white balance by pipeline, other keys dropped and listed", async () => {
    const out = await tools.saveIntent({ intent: candidate, confirmed: false, from_preset: "U-WARM-2", dry_run: true });
    const intent = out.json["intent"] as { schema_version: number; set: Record<string, unknown>; set_by_pipeline: Record<string, unknown> };
    expect(intent.schema_version).toBe(3);
    expect(intent.set).toEqual({ contrast: 20 });
    expect(intent.set_by_pipeline).toEqual({ rendered: { temperature: 12 } }); // IncrementalTemperature: relative, so rendered
    expect(out.json["from_preset"]).toMatchObject({ preset: { name: "Warm", uuid: "U-WARM-2" }, captured: 2, dropped: ["ProcessVersion"] });
    const sky = (await tools.saveIntent({ intent: candidate, confirmed: false, from_preset: "Adaptive: Sky", dry_run: true })).json;
    expect((sky["from_preset"] as { dropped: string[] }).dropped).toContain("MaskGroupBasedCorrections");
  });

  it("from_preset: Kelvin white balance under raw; an ambiguous name, a save without dry_run and both captures are refused", async () => {
    const out = await tools.saveIntent({ intent: candidate, confirmed: false, from_preset: "U-WARM", dry_run: true });
    expect(out.json["intent"]).toMatchObject({ set: { exposure: 0.5, contrast: 10 }, set_by_pipeline: { raw: { temperature: 5600 } } });
    await expect(tools.saveIntent({ intent: candidate, confirmed: false, from_preset: "Warm", dry_run: true })).rejects.toMatchObject({ code: "PRESET_AMBIGUOUS" });
    await expect(tools.saveIntent({ intent: candidate, confirmed: true, from_preset: "U-WARM" })).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    await expect(tools.saveIntent({ intent: candidate, confirmed: false, from_photo: true, from_preset: "U-WARM", dry_run: true })).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
    expect(plugin.received.some((r) => r.name === "apply_settings")).toBe(false);
  });
});

describe("looks as MCP prompts", () => {
  let mcp: Client;
  let looks: IntentSummary[];
  beforeEach(async () => {
    looks = [{ id: "warm_film", label: "Warm film", category: "look", source: "user" }];
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer({ looks: () => looks } as unknown as Tools).connect(serverSide);
    mcp = new Client({ name: "test", version: "0" });
    await mcp.connect(clientSide);
  });

  it("lists one prompt per intent, read again on each call", async () => {
    const first = (await mcp.listPrompts()).prompts;
    expect(first.find((p) => p.name === "look-warm_film")).toMatchObject({ description: "Warm film" });
    looks.push({ id: "cold", label: "Cold", category: "look", source: "bundled" });
    expect((await mcp.listPrompts()).prompts.map((p) => p.name)).toContain("look-cold");
  });

  it("builds a request to edit the selected photo with that intent", async () => {
    const got = await mcp.getPrompt({ name: "look-warm_film", arguments: { request: "keep the sky blue" } });
    const text = (got.messages[0]?.content as { text: string }).text;
    expect(text).toContain('intent_id "warm_film"');
    expect(text).toContain("My request: keep the sky blue");
    expect(got.description).toBe("Warm film");
    await expect(mcp.getPrompt({ name: "look-gone" })).rejects.toThrow(/Unknown prompt/);
  });
});

describe("finding looks", () => {
  it("the instructions offer 2-3 looks and keep the guidance light", () => {
    expect(INSTRUCTIONS).toContain("2-3 fitting looks from lr_list_intents");
    expect(INSTRUCTIONS).toContain("starting points");
  });

  it("the edit profile has lr_save_intent", () => {
    expect(EDIT_TOOLS).toContain("lr_save_intent");
  });
});
