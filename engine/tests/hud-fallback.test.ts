// The classic HUD as the Deck's fallback (Phase 7 row 3, E2; src\hud\sinks.ts; spec docs\hud\
// lrc-avg-hud-spec-v2.md 3.2, 3.4, 11.2 "hud-fallback.test.ts"): the plugin's HUD opens by itself only
// when no Deck is there; with a Deck it still gets every state, without `open`, and otherwise what it
// got before Phase 7.

import { describe, expect, it } from "vitest";
import type { HudUpdatePayload } from "../src/bridge/index.js";
import { HudPublisher } from "../src/hud/index.js";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { SimHud } from "./helpers/lightroom-sim-hud.js";
import { ID, clean, client, lr, newManager, useSessionHarness } from "./helpers/session-harness.js";
import type { SessionManager } from "../src/session/index.js";

useSessionHarness();

describe("the classic HUD as the fallback", () => {
  it("opens at begin at once when no Deck is installed, as before Phase 7", async () => {
    clean();
    const rig = await deckRig({ exe: null });
    await rig.manager.begin({ intent_id: "test_plain" });
    await waitUntil(() => lr.hud.last()?.stage === "awaiting_claude");
    expect(lr.hud.taken[0]).toMatchObject({ stage: "begin", open: true, seq: 1 });
    expect(lr.hud.opened).toBe(1);
    expect(rig.started).toEqual([]);
  });

  it("stays closed when the Deck started at begin connects in time", async () => {
    clean();
    const sims: SimHudClient[] = [];
    const rig = await deckRig({ onStart: () => void SimHudClient.connect(endpoint()).then((s) => sims.push(s)) });
    const endpoint = () => rig.endpoint;
    await rig.manager.begin({ intent_id: "test_plain" });
    await waitUntil(() => sims[0]?.last()?.stage === "awaiting_claude");
    await new Promise((resolve) => setTimeout(resolve, 400)); // past the 300 ms wait
    expect(rig.started.length).toBe(1);
    expect(lr.hud.taken.some((u) => u.open)).toBe(false);
    expect(lr.hud.opened).toBe(0);
    expect(lr.hud.last()?.stage).toBe("awaiting_claude"); // it still gets every state
  });

  it("opens after the wait when the Deck started at begin does not connect", async () => {
    clean();
    const rig = await deckRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    expect(rig.started.length).toBe(1);
    expect(lr.hud.taken[0]?.open).toBeUndefined();
    await waitUntil(() => lr.hud.opened === 1, 2000);
    expect(lr.hud.taken.filter((u) => u.open).length).toBe(1);
  });

  it("with a Deck connected, gets what it got before Phase 7, without `open`", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    const withDeck = await run(rig.manager);
    expect(rig.started).toEqual([]);
    expect(lr.hud.taken.some((u) => u.open)).toBe(false);

    // The same edit again, on the classic HUD alone, as another edit (its own id and log) in a fresh simulated window.
    (lr as unknown as { hud: SimHud }).hud = new SimHud();
    clean();
    const alone = await run(newManager({ hud: new HudPublisher(client), newId: () => OTHER }), OTHER);
    expect(lr.hud.taken[0]?.open).toBe(true);
    expect(withDeck).toEqual(alone);
  });
});

const OTHER = "fedcba98-7654-3210-fedc-ba9876543210";

/** begin, one step, Claude's revert: the classic HUD's state at each point, without seq, open, the edit's id and the snapshot's name and id (they hold the time). */
async function run(manager: SessionManager, id = ID): Promise<Array<Partial<HudUpdatePayload>>> {
  const states: Array<Partial<HudUpdatePayload>> = [];
  const at = async (stage: string, pass: number) => {
    await waitUntil(() => lr.hud.last()?.stage === stage && lr.hud.last()?.pass === pass);
    const { seq: _s, open: _o, session_id: _i, snapshot, put_back, ...rest } = lr.hud.last() as HudUpdatePayload;
    expect(snapshot).toEqual(expect.any(String));
    states.push({ ...rest, ...(put_back ? { put_back: { ...put_back, snapshot_id: "-", snapshot_name: "-" } } : {}) });
  };
  await manager.begin({ intent_id: "test_plain" });
  await at("awaiting_claude", 0);
  await manager.step({ session_id: id, settings: { exposure: 0.2, contrast: 10 }, rationale: "test" });
  await at("awaiting_claude", 1);
  await manager.end({ session_id: id, outcome: "revert" });
  await at("ended", 1);
  return states;
}
