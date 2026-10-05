// What the Deck gets beyond the classic HUD (Phase 7 row 3, E3, E6, E10; src\hud\extras.ts; spec docs\hud\
// lrc-avg-hud-spec-v2.md 7, 11.2 "hud-extras.test.ts", without the deferred whole-edit rows and
// history_prefix): the copies with the intent's labels and `picked`, the rows in panel order with their
// group, probed range and weight, the cap that keeps the heaviest rows, and Lightroom's state.

import { describe, expect, it } from "vitest";
import { HUD_LIMITS } from "../src/bridge/index.js";
import { deckRows, lightroomState, weight } from "../src/hud/extras.js";
import type { Session } from "../src/session/index.js";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { ID, clean, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

describe("the Deck's copies", () => {
  it("lists each copy with the intent's label, its pass, thumbnail key and guardrail, and the pick", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
    for (const target of ["A", "B", "C"] as const) await rig.manager.step({ session_id: ID, target, settings: { exposure: 0.1 }, rationale: "test" });
    const pick = await sim.at("awaiting_pick");
    expect(pick.picked).toBeNull();
    expect(pick.copies).toEqual(
      (["A", "B", "C"] as const).map((letter, i) => ({
        letter,
        label: ["natural", "dramatic", "bright"][i],
        copy_name: `AVG test_variants ${letter}`,
        uuid: `SIM-COPY-${i + 1}`,
        pass: 1,
        thumb: expect.stringMatching(new RegExp(`^${letter}:1:[0-9a-f]{12}$`)),
        guardrail: expect.objectContaining({ status: expect.any(String) }),
      })),
    );
    await rig.manager.selectVariant({ session_id: ID, variant: "B" });
    expect((await sim.at("awaiting_claude", (s) => s.picked === "B")).picked).toBe("B");
    expect(sim.invalid).toEqual([]);
    expect(rig.deck.stats.invalid).toBe(0);
  });

  it("sends no copies in Converge mode", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    const state = await sim.at("awaiting_claude");
    expect(state.copies).toBeUndefined();
    expect(state.picked).toBeUndefined();
  });
});

describe("the Deck's rows", () => {
  it("shows a step's changes in panel order, with labels, groups, probed ranges and weights", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await rig.manager.step({ session_id: ID, settings: { "sharpening.amount": 10, "hsl.orange.sat": -6, contrast: 10, exposure: 0.2 }, rationale: "test" });
    const state = await sim.at("awaiting_claude", (s) => s.pass === 1);
    expect(state.rows?.map((r) => [r.name, r.label, r.group])).toEqual([
      ["exposure", "Exposure", "Basic"],
      ["contrast", "Contrast", "Basic"],
      ["hsl.orange.sat", "Orange Saturation", "HSL / Color"],
      ["sharpening.amount", "Sharpening Amount", "Detail"],
    ]);
    expect(state.rows?.[0]).toMatchObject({ before: 0, after: 0.2, delta: 0.2, min: -5, max: 5, weight: 0.2 });
    expect(state.rows?.[1]).toMatchObject({ min: -100, max: 100, weight: 0.25 });
    expect(state.rows?.[3]).toMatchObject({ min: 0, max: 150 });
  });

  it("over the cap, keeps the heaviest rows and shows them in panel order", () => {
    const names = ["temperature", "tint", "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "texture", "clarity", "dehaze", "vibrance", "saturation", "sharpening.amount"];
    // Every change 1, except exposure (weight 1) and sharpening (40 -> weight 1): those must stay.
    const changes = names.map((name) => ({ name, before: name === "temperature" ? 5000 : 0, requested: 0, after: 0, delta: name === "sharpening.amount" ? 40 : 1 }));
    const s = { work: null, active: { id: "master" }, log: { passes: [{ target: "master", changes, guardrail_actions: [] }] } } as unknown as Session;
    const rows = deckRows(s);
    expect(rows.length).toBe(HUD_LIMITS.rows);
    expect(rows.map((r) => r.name)).toContain("exposure");
    expect(rows.at(-1)?.name).toBe("sharpening.amount");
    expect(rows.map((r) => r.name)).not.toContain("temperature"); // 1 K of 5000 weighs 0
  });

  it("weighs a change by the slider's full scale (spec 7)", () => {
    expect(weight("exposure", 0, 0.5)).toBe(0.5);
    expect(weight("temperature", 5000, 375)).toBe(0.5);
    expect(weight("hsl.red.hue", 0, 15)).toBe(0.5);
    expect(weight("grading.shadows.hue", 0, 30)).toBe(0.5);
    expect(weight("grading.shadows.sat", 0, 10)).toBe(0.5);
    expect(weight("sharpening.radius", 1, 0.25)).toBe(0.5);
    expect(weight("noise.color", 0, 100)).toBe(1); // capped
    expect(weight("camera_profile", "Adobe Color", null)).toBe(1);
    expect(weight("tone_curve.master", null, null)).toBe(1);
  });
});

describe("Lightroom's state for the Deck", () => {
  it("is connected, waiting while the plugin is paused, else down", () => {
    const client = (state: string, paused: boolean) => ({ getState: () => state, pluginPaused: () => paused }) as Parameters<typeof lightroomState>[0];
    expect(lightroomState(client("connected", false))).toBe("connected");
    expect(lightroomState(client("connected", true))).toBe("waiting");
    for (const state of ["stopped", "connecting", "handshaking"]) expect(lightroomState(client(state, false))).toBe("down");
  });
});
