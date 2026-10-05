// Starting the Deck (Phase 7 row 3, E8; src\hud\launch.ts, sinks.ts; spec docs\hud\
// lrc-avg-hud-spec-v2.md 3.2, 11.2 "hud-launch.test.ts"): once at begin when no Deck is connected, once
// more after a crash, then the classic HUD; none when the executable is missing (the classic HUD opens
// instead, hud-fallback.test.ts), and none after the listener closed.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HUD_EXE_NAME, HudLauncher, findHudExe } from "../src/hud/launch.js";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, lr, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

describe("finding the Deck", () => {
  it("takes LRC_AVG_HUD_EXE, else the per-user install folder, and only a file that is there", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-hud-exe-"));
    try {
      const given = path.join(dir, "deck.exe");
      writeFileSync(given, "");
      expect(findHudExe({ LRC_AVG_HUD_EXE: given })).toBe(given);
      expect(findHudExe({ LRC_AVG_HUD_EXE: path.join(dir, "missing.exe") })).toBeNull();
      const installed = path.join(dir, "Programs", "LrC-AVG HUD", HUD_EXE_NAME);
      expect(findHudExe({ LOCALAPPDATA: dir })).toBeNull();
      mkdirSync(path.dirname(installed), { recursive: true });
      writeFileSync(installed, "");
      expect(findHudExe({ LOCALAPPDATA: dir })).toBe(installed);
      expect(findHudExe({})).toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("HudLauncher", () => {
  it("starts twice per edit at most, again for a new edit, and never without an executable", () => {
    const started: string[] = [];
    const launcher = new HudLauncher({ exe: () => "deck.exe", start: (e) => void started.push(e) });
    expect([launcher.start("a"), launcher.start("a"), launcher.start("a")]).toEqual([true, true, false]);
    expect(launcher.start("b")).toBe(true);
    expect(started).toEqual(["deck.exe", "deck.exe", "deck.exe"]);
    expect(new HudLauncher({ exe: () => null, start: () => started.push("x") }).start("c")).toBe(false);
    expect(started.length).toBe(3);
  });

  it("says false when the start throws", () => {
    const launcher = new HudLauncher({
      exe: () => "deck.exe",
      start: () => {
        throw new Error("ENOENT");
      },
    });
    expect(launcher.start("a")).toBe(false);
  });
});

describe("starting the Deck during an edit", () => {
  it("starts it once at begin, once more after a crash, then opens the classic HUD", async () => {
    clean();
    const sims: SimHudClient[] = [];
    const rig = await deckRig({ onStart: () => void SimHudClient.connect(rig.endpoint).then((s) => sims.push(s)) });
    await rig.manager.begin({ intent_id: "test_plain" });
    await waitUntil(() => sims[0]?.last()?.stage === "awaiting_claude");
    expect(rig.started.length).toBe(1);

    sims[0]?.close(); // the Deck crashed
    await waitUntil(() => sims[1]?.last()?.session_id === ID);
    expect(rig.started.length).toBe(2);
    expect(lr.hud.opened).toBe(0);

    sims[1]?.close(); // and again: no third start
    await waitUntil(() => lr.hud.opened === 1);
    expect(rig.started.length).toBe(2);
    expect(rig.manager.current()?.id).toBe(ID);
  });

  it("starts nothing when the Deck is lost because the listener closed, or with no edit open", async () => {
    clean();
    const rig = await deckRig();
    const idle = await SimHudClient.connect(rig.endpoint);
    await idle.welcomed();
    idle.close();
    await waitUntil(() => !rig.deck.connected());
    expect(rig.started).toEqual([]);

    const sim = await SimHudClient.connect(rig.endpoint);
    await sim.welcomed();
    await rig.manager.begin({ intent_id: "test_plain" });
    await sim.at("awaiting_claude");
    rig.deck.close(); // the engine gave the bridge back, or exits
    await waitUntil(() => sim.closed);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(rig.started).toEqual([]);
    expect(lr.hud.opened).toBe(0);
  });
});
