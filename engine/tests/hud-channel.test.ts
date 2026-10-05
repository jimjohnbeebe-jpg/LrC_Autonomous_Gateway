// The HUD channel (Phase 7 row 3, E1; src\hud\channel.ts, deck.ts; spec docs\hud\lrc-avg-hud-spec-v2.md
// 3.3, 3.7, 11.2 "hud-channel.test.ts") against the simulated Lightroom, with SimHudClient as the Deck:
// the endpoint file, the handshake, the welcome, the whole state with a rising seq, the heartbeat drop,
// and one client at a time.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import path from "node:path";
import { HudChannel, hudEndpointSchema } from "../src/hud/index.js";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, tmp, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

describe("HUD channel", () => {
  it("writes the endpoint file when it opens and deletes it when it closes", async () => {
    const rig = await deckRig();
    const file = hudEndpointSchema.parse(JSON.parse(readFileSync(rig.endpoint, "utf8")));
    expect(file).toMatchObject({ pid: process.pid, engine_version: "test", token: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(rig.deck.channel.listening()).toBe(true);
    rig.deck.close();
    expect(existsSync(rig.endpoint)).toBe(false);
    expect(rig.deck.channel.listening()).toBe(false);
  });

  it("leaves an endpoint file another engine wrote since", async () => {
    const rig = await deckRig();
    const other = { ...JSON.parse(readFileSync(rig.endpoint, "utf8")), token: "f".repeat(64) };
    writeFileSync(rig.endpoint, JSON.stringify(other));
    rig.deck.close();
    expect(JSON.parse(readFileSync(rig.endpoint, "utf8"))).toEqual(other);
  });

  it("stays closed when close() comes while it opens, and does not listen when the endpoint file cannot be written", async () => {
    const endpointPath = path.join(tmp, "early", "hud_endpoint.json");
    const early = new HudChannel({ engineVersion: "test", endpointPath, welcome: () => ({ session_id: null, lightroom: "down" }) });
    const opening = early.open();
    early.close();
    await opening;
    expect([early.listening(), existsSync(endpointPath)]).toEqual([false, false]);

    writeFileSync(path.join(tmp, "a-file"), "");
    const blocked = new HudChannel({ engineVersion: "test", endpointPath: path.join(tmp, "a-file", "hud_endpoint.json"), welcome: () => ({ session_id: null, lightroom: "down" }) });
    await expect(blocked.open()).rejects.toThrow();
    expect(blocked.listening()).toBe(false);
  });

  it("closes a socket whose hello has the wrong token, and sends it nothing", async () => {
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint, { token: "0".repeat(64) });
    await waitUntil(() => sim.closed);
    expect(sim.received).toEqual([]);
    expect(rig.deck.connected()).toBe(false);
  });

  it("welcomes a Deck with no edit open, then with the open edit's id and its whole state", async () => {
    clean();
    const rig = await deckRig();
    const before = await SimHudClient.connect(rig.endpoint);
    expect(await before.welcomed()).toMatchObject({ engine_version: "test", session_id: null, lightroom: "connected" });
    await rig.manager.begin({ intent_id: "test_plain" });
    const after = await SimHudClient.connect(rig.endpoint);
    expect(await after.welcomed()).toMatchObject({ session_id: ID });
    const state = await after.at("awaiting_claude");
    expect(state).toMatchObject({ session_id: ID, mode: "converge", lightroom: "connected", target: { uuid: "SIM-UUID" }, rows: [] });
    expect(before.closed).toBe(true); // replaced by the newer client
  });

  it("sends the whole state at each stage, with seq rising by 1 from 1, and every state valid", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await rig.manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test" });
    await sim.at("awaiting_claude", (s) => s.pass === 1);
    const seqs = sim.states().map((m) => m.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    expect(sim.invalid).toEqual([]);
    expect(rig.deck.stats.invalid).toBe(0);
    expect(sim.states().every((m) => m.state.session_id === ID && m.state.target.uuid === "SIM-UUID")).toBe(true);
  });

  it("starts seq at 1 again for the next edit", async () => {
    clean();
    const ids = [ID, "fedcba98-7654-3210-fedc-ba9876543210"];
    const rig = await deckRig({ newId: () => ids.shift() as string });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude");
    await rig.manager.end({ session_id: ID, outcome: "revert" });
    await sim.at("ended");
    const firstEdit = sim.states().length;
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude", (s) => s.session_id !== ID);
    const second = sim.states().slice(firstEdit);
    expect(second.map((m) => m.seq)).toEqual(second.map((_, i) => i + 1));
  });

  it("drops a Deck that stops answering after 3 pings, and takes it back when it says hello again", async () => {
    const rig = await deckRig({ pingMs: 50 });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    sim.pong = false;
    await waitUntil(() => sim.closed, 1000);
    expect(rig.deck.connected()).toBe(false);
    expect(rig.records.filter((r) => r.what === "client").map((r) => r.connected)).toEqual([true, false]);
    const again = await SimHudClient.connect(rig.endpoint);
    await again.welcomed();
    expect(rig.deck.connected()).toBe(true);
  });

  it("keeps one client: a second hello replaces the first", async () => {
    const rig = await deckRig();
    const first = await SimHudClient.connect(rig.endpoint);
    await first.welcomed();
    const second = await SimHudClient.connect(rig.endpoint);
    await second.welcomed();
    await waitUntil(() => first.closed);
    expect(rig.deck.connected()).toBe(true);
    expect(rig.records.filter((r) => r.what === "client").map((r) => r.connected)).toEqual([true, true]);
  });
});
