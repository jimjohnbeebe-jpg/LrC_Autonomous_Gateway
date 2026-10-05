// The selection for the Deck (Phase 7 row 3, E7; src\hud\selection.ts, deck.ts; spec docs\hud\
// lrc-avg-hud-spec-v2.md 3.5, 11.2 "hud-selection-poll.test.ts"): polled only while an edit is open, a
// Deck is connected and the edit's queue is idle; none during a step or copy creation; the copies count
// as in the edit; nothing selected reads as a null uuid (the Deck builds "Target changed: No photo is
// selected. …" from it, row 3 decision 3).

import { describe, expect, it } from "vitest";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const selectionReads = (): number => plugin.received.filter((r) => r.name === "get_selection").length;

describe("selection polling", () => {
  it("asks only while an edit is open and a Deck is connected", async () => {
    clean();
    const rig = await deckRig({ exe: null, pingMs: 50 });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await sleep(150);
    expect(selectionReads()).toBe(0); // no edit

    await rig.manager.begin({ intent_id: "test_plain" });
    const state = await sim.at("awaiting_claude", (s) => s.selection !== undefined);
    expect(state.selection).toEqual({ uuid: "SIM-UUID", name: "20260907-_OZ80093.NEF", in_edit: true });

    sim.close();
    await waitUntil(() => !rig.deck.connected());
    await sleep(60);
    const reads = selectionReads();
    await sleep(150);
    expect(selectionReads()).toBe(reads); // no Deck

    const back = await SimHudClient.connect(rig.endpoint);
    await back.welcomed();
    await waitUntil(() => selectionReads() > reads);
    await rig.manager.end({ session_id: ID, outcome: "revert" });
    await back.at("ended");
    expect(back.last()?.selection).toBeUndefined();
    const ended = selectionReads();
    await sleep(150);
    expect(selectionReads()).toBe(ended); // the edit is over
  });

  it("does not ask while a step runs, and says when the selection is another photo or none", async () => {
    clean();
    const rig = await deckRig({ pingMs: 50 });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude", (s) => s.selection?.in_edit === true);

    const apply = plugin.handlers.get("apply_settings");
    let during = -1;
    plugin.handlers.set("apply_settings", async (p, id) => {
      const at = selectionReads();
      await sleep(250); // five ticks
      during = selectionReads() - at;
      return apply ? apply(p, id) : "silent";
    });
    await rig.manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test" });
    expect(during).toBe(0);

    lr.selected = "SOME-OTHER-PHOTO";
    expect((await sim.at("awaiting_claude", (s) => s.selection?.uuid === "SOME-OTHER-PHOTO")).selection?.in_edit).toBe(false);
    lr.selected = "";
    expect((await sim.at("awaiting_claude", (s) => s.selection?.uuid === null)).selection).toEqual({ uuid: null, name: null, in_edit: false });
  });

  it("drops an answer that comes after its edit ended and the next one began (Greptile, PR #85)", async () => {
    clean();
    const ids = [ID, "fedcba98-7654-3210-fedc-ba9876543210"];
    const rig = await deckRig({ pingMs: 50, newId: () => ids.shift() as string });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude", (st) => st.selection?.in_edit === true);

    const getSelection = plugin.handlers.get("get_selection");
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    plugin.handlers.set("get_selection", async () => {
      await held; // answered only once the next edit is open and idle
      return { ok: true, payload: { count: 1, photos: [{ uuid: "STALE-PHOTO", local_id: 9, filename: "stale.NEF" }] } };
    });
    const asked = selectionReads();
    await waitUntil(() => selectionReads() > asked);
    await rig.manager.end({ session_id: ID, outcome: "revert" });
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude", (st) => st.session_id !== ID);
    if (getSelection) plugin.handlers.set("get_selection", getSelection); // later polls answer as Lightroom would
    release();
    await sleep(150);
    await sim.at("awaiting_claude", (st) => st.session_id !== ID && st.selection?.uuid === "SIM-UUID");
    expect(sim.states().some((m) => m.state.session_id !== ID && m.state.selection?.uuid === "STALE-PHOTO")).toBe(false);
  });

  it("does not ask while the copies are made, and counts a copy as in the edit", async () => {
    clean();
    // The default ping: at 50 ms the busy Variants begin dropped the client under a full parallel run (PR #86).
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    const commands = plugin.received.length;
    await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
    const duringBegin = plugin.received.slice(commands).map((r) => r.name);
    expect(duringBegin).toContain("create_virtual_copies");
    // Polling may start once begin's work is over; none before its last select_photo or write.
    const lastWork = Math.max(duringBegin.lastIndexOf("select_photo"), duringBegin.lastIndexOf("apply_settings"));
    expect(duringBegin.slice(0, lastWork).includes("get_selection")).toBe(false);

    lr.selected = "SIM-COPY-2";

    const state = await sim.at("awaiting_claude", (s) => s.selection?.uuid === "SIM-COPY-2");
    expect(state.selection?.in_edit).toBe(true);
  });
});
