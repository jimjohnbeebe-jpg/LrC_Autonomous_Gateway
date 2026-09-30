// Accept and Pick from the HUD (src/session/hud-actions.ts, pick.ts; PRD 6.3, AC-3, PHASE5_PLAN
// row 5) against the simulated Lightroom: Accept keeps the edit and waits for a running step, needs a
// pick in Variants mode; Pick continues the session on the copy, and Claude hears of it once.

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { ID, clean, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

type Rig = ReturnType<typeof hudRig>;
const step = (rig: Rig, settings: Record<string, unknown> = { exposure: 0.1 }, target?: "A" | "B" | "C") =>
  rig.manager.step({ session_id: ID, ...(target ? { target } : {}), settings, rationale: "test" });

/** A Variants session whose copies have each had their refined pass. */
async function awaitingPick(rig: Rig): Promise<void> {
  await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
  for (const t of ["A", "B", "C"] as const) await step(rig, { exposure: 0.1 }, t);
  await hudAt("awaiting_pick");
}

describe("Accept from the HUD", () => {
  it("keeps the edit, writes the recipe, and ends the session", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await step(rig, { exposure: 0.2 });
    const click = hudEvent(plugin, "hud_accept", { session_id: ID });
    expect((await hudAt("accepted")).note).toBe("Accepted: the edit is kept and the recipe written.");
    expect(lr.settings["Exposure2012"]).toBe(0.2);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "accept", ended_by: { source: "hud", click_id: click }, revert: null });
    expect(existsSync(log.recipe_path ?? "")).toBe(true);
    const e = await fails(step(rig));
    expect([e.code, e.details]).toEqual(["SESSION_ENDED", expect.objectContaining({ outcome: "accept", source: "hud" })]);
  });

  it("during a step waits for it: the step's result reaches Claude, then the session ends", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const apply = plugin.handlers.get("apply_settings");
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    plugin.handlers.set("apply_settings", async (p, id) => {
      await held;
      return apply ? apply(p, id) : "silent";
    });
    const pending = step(rig, { exposure: 0.2 });
    await waitUntil(() => plugin.received.some((r) => r.name === "apply_settings"));
    hudEvent(plugin, "hud_accept", { session_id: ID });
    await waitUntil(() => rig.events.length === 1);
    expect(rig.events[0]?.note).toBe("Accept: keeping the edit once the running call is done.");
    if (apply) plugin.handlers.set("apply_settings", apply);
    release();
    expect((await pending).json).toMatchObject({ ok: true, pass: "1/4" });
    await hudAt("accepted");
    expect(readLog()).toMatchObject({ outcome: "accept", passes: [{ n: 0 }, { n: 1 }] });
  });

  it("in Variants mode needs a pick first", async () => {
    clean();
    const rig = hudRig();
    await awaitingPick(rig);
    hudEvent(plugin, "hud_accept", { session_id: ID });
    await waitUntil(() => rig.events.length === 1);
    expect(rig.events[0]?.note).toBe("Accept keeps the pick's edit: click Pick first, or Abort.");
    await waitUntil(() => lr.hud.last()?.note === "Accept keeps the pick's edit: click Pick first, or Abort.");
    expect(rig.manager.current()?.id).toBe(ID);
    expect(readLog().outcome).toBeNull();
  });
});

describe("Pick from the HUD", () => {
  it("Pick from the HUD: the session continues on the copy, and Claude hears of it once", async () => {
    clean();
    const rig = hudRig();
    await awaitingPick(rig);
    hudEvent(plugin, "hud_pick", { session_id: ID, variant: "B" });
    await waitUntil(() => lr.hud.last()?.note === "Picked B: Claude continues on copy B at its next call.");
    expect(lr.hud.last()).toMatchObject({ stage: "awaiting_claude", pass: 1, target: { uuid: "SIM-COPY-2", copy_name: "AVG test_variants B" } });
    expect(lr.selected).toBe("SIM-COPY-2");
    expect(rig.events[0]?.note).toBe("Pick B: selecting copy B.");
    // lr_select_variant with the same letter confirms it; another letter is refused.
    const confirm = await rig.manager.selectVariant({ session_id: ID, variant: "B" });
    expect(confirm.json).toMatchObject({ picked: { id: "B" }, picked_by: "hud", hud_actions: [{ action: "pick", variant: "B", source: "hud" }] });
    expect((await fails(rig.manager.selectVariant({ session_id: ID, variant: "A" }))).message).toMatch(/^Copy B is already picked by the user in the HUD/);
    const out = await step(rig);
    expect(out.json).toMatchObject({ target: "B", pass: "2/4" });
    expect(out.json["hud_actions"]).toBeUndefined();
    expect(readLog()).toMatchObject({ picked: "B", hud_events: [expect.objectContaining({ name: "hud_pick", variant: "B" })] });
  });

  it("tells Claude of the pick in the next step's result, and refuses a second pick", async () => {
    clean();
    const rig = hudRig();
    await awaitingPick(rig);
    hudEvent(plugin, "hud_pick", { session_id: ID, variant: "C" });
    await waitUntil(() => lr.selected === "SIM-COPY-3" && lr.hud.last()?.stage === "awaiting_claude");
    hudEvent(plugin, "hud_pick", { session_id: ID, variant: "A" });
    await waitUntil(() => rig.events.length === 2);
    expect(rig.events[1]?.note).toBe("Copy C is already picked.");
    const out = await step(rig);
    expect(out.json).toMatchObject({ target: "C", hud_actions: [{ action: "pick", variant: "C", source: "hud" }] });
  });
});
