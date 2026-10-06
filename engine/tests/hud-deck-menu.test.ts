// Phase 7 row 5 (spec docs\hud\lrc-avg-hud-spec-v2.md D1, "Known conflict"; Q4; src\hud\deck-menu.ts):
// the plugin hears whether a Deck is connected (hud_deck, plugin 0.18.0), at each change and after each
// bridge connection, never to an older plugin; and the menu's "Show Vision Gateway HUD" (hud_show)
// reaches the Deck as `reveal` for the open edit only, and only a Deck that knows it.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HUD_SHOW_EVENT } from "../src/bridge/index.js";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, client, lr, plugin, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deckSent = (): number => plugin.received.filter((r) => r.name === "hud_deck").length;
let events = 0;
const hudShow = (payload: Record<string, unknown>): void =>
  plugin.send({ id: `evt-show-${++events}`, type: "evt", name: "hud_show", ts: new Date().toISOString(), payload });

describe("hud_deck: the plugin hears whether a Deck is connected", () => {
  it("at each connect and loss of the Deck", async () => {
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await waitUntil(() => lr.hud.deck.at(-1) === true);
    sim.close();
    await waitUntil(() => lr.hud.deck.at(-1) === false);
    expect(lr.hud.deck).toEqual([true, false]);
    expect(rig.menu.every((r) => r.ok)).toBe(true);
  });

  it("again after a bridge reconnection (a restarted plugin starts with no Deck)", async () => {
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await waitUntil(() => lr.hud.deck.length === 1);
    plugin.dropEventClient();
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    await waitUntil(() => lr.hud.deck.length === 2);
    expect(lr.hud.deck).toEqual([true, true]);
  });

  it("the newest value follows one that was in flight", async () => {
    const rig = await deckRig();
    const handler = plugin.handlers.get("hud_deck");
    let held = 1; // the first answer comes late, so the Deck's loss happens while it is in flight
    plugin.handlers.set("hud_deck", async (p, id) => {
      if (held-- > 0) await sleep(200);
      return handler?.(p, id) ?? "silent";
    });
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await waitUntil(() => deckSent() === 1);
    sim.close();
    await waitUntil(() => !rig.deck.connected());
    await waitUntil(() => lr.hud.deck.length === 2, 1000);
    expect(lr.hud.deck).toEqual([true, false]);
  });

  it("tries a failed one again", async () => {
    const rig = await deckRig();
    const handler = plugin.handlers.get("hud_deck");
    let refusals = 1;
    plugin.handlers.set("hud_deck", (p, id) =>
      refusals-- > 0 ? { ok: false, error: { code: "internal", message: "test", recoverable: true } } : (handler?.(p, id) ?? "silent"),
    );
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await waitUntil(() => lr.hud.deck.at(-1) === true);
    expect(rig.menu.map((r) => r.ok)).toEqual([false, true]);
  });

  it("is never sent to a plugin before 0.18.0", async () => {
    lr.pluginVersion = "0.17.0";
    plugin.dropEventClient(); // the next hello reports 0.17.0
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await sleep(100);
    expect(deckSent()).toBe(0);
  });
});

describe("hud_show: the menu brings up the Deck (Q4)", () => {
  it("sends `reveal` for the open edit, to a Deck from 0.3.0", async () => {
    clean();
    const rig = await deckRig();
    const sim = await SimHudClient.connect(rig.endpoint, { hudVersion: "0.3.0" });
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude");
    hudShow({ session_id: ID });
    await waitUntil(() => sim.received.some((m) => m.type === "reveal"));
    expect(sim.received.find((m) => m.type === "reveal")).toEqual({ type: "reveal", session_id: ID });
    expect(rig.menu.at(-1)).toMatchObject({ ok: true, what: "hud_show", session_id: ID });
  });

  it("sends nothing for another edit, an ended one, a bad payload, or a Deck before 0.3.0", async () => {
    clean();
    const rig = await deckRig();
    const old = await SimHudClient.connect(rig.endpoint, { hudVersion: "0.2.0" });
    await old.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await old.at("awaiting_claude");
    hudShow({ session_id: ID });
    hudShow({ session_id: "not-this-edit" });
    hudShow({ session: ID });
    await waitUntil(() => rig.menu.filter((r) => r.what === "hud_show").length === 3);
    expect(rig.menu.filter((r) => r.what === "hud_show").map((r) => r.error ?? "")).toEqual([
      expect.stringContaining("no Deck that knows reveal (0.2.0)"),
      "not the open edit",
      expect.stringContaining("session_id"),
    ]);
    const sim = await SimHudClient.connect(rig.endpoint, { hudVersion: "0.3.0" });
    await sim.welcomed();
    await rig.manager.end({ session_id: ID, outcome: "accept" });
    await sim.at("accepted");
    hudShow({ session_id: ID });
    await waitUntil(() => rig.menu.filter((r) => r.what === "hud_show").length === 4);
    expect(rig.menu.at(-1)?.error).toBe("not the open edit");
    expect([...old.received, ...sim.received].some((m) => m.type === "reveal")).toBe(false);
  });
});

// The plugin side (plugin 0.18.0), read as text: the Lua runs only in Lightroom (the row 5 probe).
describe("the plugin's menu items with a Deck (Hud.lua, HudClick.lua, MenuHud.lua)", () => {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "plugin", "LrC-AVG.lrplugin");
  /** The file with every run of whitespace as one space, so the checks below are plain substrings. */
  const lua = (name: string): string => readFileSync(path.join(dir, name), "utf8").replace(/\s+/g, " ");

  it("a sent menu item leaves the classic window closed only while a Deck is live; anything else opens it", () => {
    const click = lua("HudClick.lua");
    expect(click).toContain('if sent and HudClick.deckLive() then Log.info("hud: menu " .. name .. ": the Deck shows the outcome") else show() end');
    expect(click).toContain("return H.deck == true and Events.connection().engine");
  });

  it("Show asks the engine for the Deck (hud_show) for an open, known edit, else opens the classic window", () => {
    const hud = lua("Hud.lua");
    expect(hud).toContain(`Events.send("${HUD_SHOW_EVENT}", { session_id = s.session_id })`);
    expect(hud).toContain("if s and not HudState.isEnd(s.stage) and not H.unknownAt and HudClick.deckLive() then");
    expect(hud).toContain("if ok then return end end Hud.show() end");
    // A new engine connection starts with no Deck.
    expect(hud).toMatch(/function Hud\.markUnknown\(\) HudClick\.resendReport\(\) --[^]*? H\.deck = false --[^]*? local s = H\.state/);
    expect(lua("MenuHud.lua")).toContain("LrTasks.startAsyncTask(function() Hud.showFromMenu() end)");
  });
});
