// The Deck's clicks (Phase 7 row 3; src\hud\deck.ts, events.ts; spec docs\hud\lrc-avg-hud-spec-v2.md 3.3
// "Events: one control path", 11.2 "hud-channel-events.test.ts"): a click from the Deck reaches the
// session manager once, a click id sent on both HUDs acts once, the answer goes back to the HUD clicked,
// and the tool log's record says which HUD sent it.

import { describe, expect, it } from "vitest";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { ID, clean, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

async function openEdit() {
  clean();
  const rig = await deckRig();
  const sim = await SimHudClient.connect(rig.endpoint);
  await sim.welcomed();
  await rig.manager.begin({ intent_id: "test_plain" });
  await sim.at("awaiting_claude");
  return { rig, sim };
}

describe("Deck clicks", () => {
  it("reach the session manager once: an Abort from the Deck puts the photo back and ends the edit", async () => {
    const { rig, sim } = await openEdit();
    const click = sim.click("hud_abort", { session_id: ID });
    const done = await sim.at("aborted");
    expect(rig.manager.current()).toBeNull();
    expect(rig.events).toEqual([expect.objectContaining({ ok: true, name: "hud_abort", click_id: click, via: "channel", answered: true })]);
    expect(done.close_after).toBe(10);
    expect(lr.hud.last()?.stage).toBe("aborted"); // the classic HUD got the end too
  });

  it("act once when the same click id comes from both HUDs", async () => {
    const { rig, sim } = await openEdit();
    sim.click("hud_accept", { session_id: ID }, "same-click");
    await waitUntil(() => rig.events.length === 1);
    hudEvent(plugin, "hud_accept", { session_id: ID }, "same-click");
    await waitUntil(() => rig.events.length === 2);
    expect(rig.events.map((e) => [e.via, e.ok, e.error ?? null])).toEqual([
      ["channel", true, null],
      ["bridge", false, "a repeat of a click already handled"],
    ]);
  });

  it("answer the Deck's click on the Deck, at once and in its next state, and not on the classic HUD", async () => {
    const { sim } = await openEdit();
    const click = sim.click("hud_pick", { session_id: ID, variant: "A" }); // refused in Converge mode: answered, nothing else
    await waitUntil(() => sim.received.some((m) => m.type === "answer" && m.click_id === click));
    // In the next state sent; a later stage may replace that state, as on the classic HUD.
    await waitUntil(() => sim.states().some((m) => m.state.answered_click_id === click));
    expect(sim.states().find((m) => m.state.answered_click_id === click)?.state.note).toEqual(expect.any(String));
    expect(lr.hud.taken.some((u) => u.answered_click_id === click)).toBe(false);
  });

  it("answer a classic HUD click on the classic HUD, not on the Deck", async () => {
    const { rig, sim } = await openEdit();
    const click = hudEvent(plugin, "hud_pick", { session_id: ID, variant: "A" });
    await waitUntil(() => lr.hud.last()?.answered_click_id === click);
    expect(rig.events.at(-1)).toMatchObject({ via: "bridge", click_id: click, answered: true });
    expect(sim.received.some((m) => (m.type === "answer" && m.click_id === click) || (m.type === "state" && m.state.answered_click_id === click))).toBe(false);
  });

  it("are refused for Put back, the plugin's own action: the edit stays open (Greptile, PR #85)", async () => {
    const { rig, sim } = await openEdit();
    sim.click("hud_put_back", { session_id: ID, outcome: "done" });
    sim.click("hud_accept", { session_id: "not-this-edit" }); // a later click, to know the first was read
    await waitUntil(() => rig.events.length === 1);
    expect(rig.events.map((e) => e.name)).toEqual(["hud_accept"]);
    expect(rig.manager.current()?.id).toBe(ID);
    expect(readLog().outcome ?? null).toBeNull();
  });

  it("answer a Deck click on an edit that is not open, without an update to the classic HUD", async () => {
    const { rig, sim } = await openEdit();
    const taken = lr.hud.taken.length;
    const click = sim.click("hud_abort", { session_id: "not-this-edit" });
    await waitUntil(() => sim.received.some((m) => m.type === "answer" && m.click_id === click));
    expect(rig.events.at(-1)).toMatchObject({ via: "channel", answered: true, note: "This edit is no longer open in Claude, so nothing was done." });
    expect(rig.manager.current()?.id).toBe(ID);
    expect(lr.hud.taken.length).toBe(taken);
  });
});
