// Phase 7 row 4a (spec docs\hud\lrc-avg-hud-spec-v2.md D5 E12, Q6 and Q11; src\session\show-copy.ts,
// src\hud\deck.ts): choosing a copy's card on the Deck selects that copy in Lightroom while the edit
// waits for the pick, and only then; the photo the session works on stays; the last of several quick
// choices wins; a pick afterwards still selects the picked copy. And `cap_reached` marks an edit whose
// passes are all used.

import { describe, expect, it } from "vitest";
import type { HudChannelState } from "../src/hud/index.js";
import { SimHudClient, deckRig, type DeckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const selects = (): number => plugin.received.filter((r) => r.name === "select_photo").length;
const uuidOf = (state: HudChannelState, letter: string): string => state.copies?.find((c) => c.letter === letter)?.uuid as string;

/** A Variants edit at awaiting_pick, with the Deck connected. */
async function atPick(): Promise<{ rig: DeckRig; sim: SimHudClient; state: HudChannelState }> {
  clean();
  const rig = await deckRig();
  const sim = await SimHudClient.connect(rig.endpoint);
  await sim.welcomed();
  await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
  for (const target of ["A", "B", "C"] as const) await rig.manager.step({ session_id: ID, target, settings: { exposure: 0.1 }, rationale: "test" });
  return { rig, sim, state: await sim.at("awaiting_pick") };
}

// Each test makes a Variants edit with three passes first: seconds under a full parallel run.
describe("show a copy (E12)", { timeout: 30000 }, () => {
  it("selects the chosen copy in Lightroom, leaves the session's photo, and the selection reads as in the edit", async () => {
    const { rig, sim, state } = await atPick();
    expect(state.target.uuid).toBe(uuidOf(state, "C")); // the copy refined last
    sim.send({ type: "show", session_id: ID, variant: "A" });
    await waitUntil(() => rig.shows.some((r) => r.result === "selected"));
    expect(lr.selected).toBe(uuidOf(state, "A"));
    const shown = await sim.at("awaiting_pick", (s) => s.selection?.uuid === uuidOf(state, "A"));
    expect(shown.selection?.in_edit).toBe(true);
    expect(shown.target.uuid).toBe(uuidOf(state, "C")); // the session's photo stays

    // The pick is still its own click, and selects the picked copy.
    sim.click("hud_pick", { session_id: ID, variant: "B" });
    await waitUntil(() => lr.selected === uuidOf(state, "B"));
    expect((await sim.at("awaiting_claude", (s) => s.picked === "B")).target.uuid).toBe(uuidOf(state, "B"));
  });

  it("refuses outside awaiting_pick, for another edit and for a copy the edit lacks, and sends nothing", async () => {
    clean();
    const rig = await deckRig();
    await rig.manager.begin({ intent_id: "test_variants", mode: "variants" });
    const show = (id: string, v: "A" | "B"): void => rig.manager.showCopy(id, v, (r) => rig.shows.push(r));
    let before = selects();
    show(ID, "A"); // no copy refined yet
    show("not-this-edit", "A");
    await sleep(50);
    expect(selects()).toBe(before);
    for (const target of ["A", "B"] as const) await rig.manager.step({ session_id: ID, target, settings: { exposure: 0.1 }, rationale: "test" });
    before = selects();
    show(ID, "B"); // C not refined yet
    await sleep(50);
    expect(selects()).toBe(before);
    expect(rig.shows.map((r) => r.result)).toEqual([
      "refused: the edit is not waiting for a pick",
      "refused: the edit is not open",
      "refused: the edit is not waiting for a pick",
    ]);
    expect(rig.shows.every((r) => !r.ok)).toBe(true);
  });

  it("refuses a copy the edit lacks", async () => {
    const { rig } = await atPick();
    const before = selects();
    rig.manager.showCopy(ID, "D" as "A", (r) => rig.shows.push(r));
    await sleep(50);
    expect(rig.shows.map((r) => r.result)).toEqual(["refused: the edit has no such copy"]);
    expect(selects()).toBe(before);
  });

  it("selects only the last of quick choices", async () => {
    const { rig, state } = await atPick();
    const before = selects();
    for (const v of ["A", "C", "B"] as const) rig.manager.showCopy(ID, v, (r) => rig.shows.push(r));
    await waitUntil(() => rig.shows.some((r) => r.result === "selected"));
    expect(rig.shows.map((r) => r.result)).toEqual(["queued", "queued, replacing an earlier choice", "queued, replacing an earlier choice", "selected"]);
    expect(rig.shows.at(-1)?.variant).toBe("B");
    expect(selects() - before).toBe(1);
    expect(lr.selected).toBe(uuidOf(state, "B"));
  });

  it("selects nothing once an Abort failed or is queued (Greptile, PR #86)", async () => {
    const { rig, sim } = await atPick();
    plugin.handlers.set("apply_snapshot", () => ({ ok: false, error: { code: "snapshot_failed", message: "no", recoverable: true } }));
    sim.click("hud_abort", { session_id: ID });
    await sim.at("awaiting_claude", (s) => s.note === "Abort could not put the photo back. Click Abort again.");
    const before = selects();
    rig.manager.showCopy(ID, "A", (r) => rig.shows.push(r));
    await sleep(50);
    expect(rig.shows.map((r) => r.result)).toEqual(["refused: the edit is being aborted"]);
    expect(selects()).toBe(before);
  });

  it("drops a choice queued behind an Abort", async () => {
    const { rig, sim } = await atPick();
    // A preview of copy B holds the queue (its select is slow); the show queues behind it, then the Abort. The show runs while the Abort is pending.
    const select = plugin.handlers.get("select_photo");
    let entered = false;
    plugin.handlers.set("select_photo", async (p, id) => {
      if (!entered) {
        entered = true;
        await sleep(200);
      }
      return select ? select(p, id) : "silent";
    });
    const preview = rig.manager.preview(ID, 800, "B");
    await waitUntil(() => entered);
    rig.manager.showCopy(ID, "A", (r) => rig.shows.push(r));
    sim.click("hud_abort", { session_id: ID });
    await preview.catch(() => undefined);
    await waitUntil(() => rig.shows.length === 2);
    expect(rig.shows.map((r) => r.result)).toEqual(["queued", "dropped: the edit no longer waits for a pick"]);
  });

  it("drops a choice queued behind the pick", async () => {
    const { rig, state } = await atPick();
    const pick = rig.manager.selectVariant({ session_id: ID, variant: "C" }); // in the queue first
    rig.manager.showCopy(ID, "A", (r) => rig.shows.push(r));
    await pick;
    await waitUntil(() => rig.shows.length === 2);
    expect(rig.shows.map((r) => r.result)).toEqual(["queued", "dropped: the edit no longer waits for a pick"]);
    expect(lr.selected).toBe(uuidOf(state, "C"));
  });
});

describe("cap reached (Q6)", () => {
  it("is set once all passes are used, and not before", async () => {
    clean();
    const rig = await deckRig({ exe: null });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain", max_passes: 2 });
    await rig.manager.step({ session_id: ID, settings: { shadows: 10 }, rationale: "r" });
    expect((await sim.at("awaiting_claude", (s) => s.pass === 1)).cap_reached).toBeUndefined();
    await rig.manager.step({ session_id: ID, settings: { shadows: 20 }, rationale: "r" });
    expect((await sim.at("awaiting_claude", (s) => s.pass === 2)).cap_reached).toBe(true);
    await rig.manager.end({ session_id: ID, outcome: "accept" });
    expect((await sim.at("accepted")).cap_reached).toBeUndefined();
  });
});
