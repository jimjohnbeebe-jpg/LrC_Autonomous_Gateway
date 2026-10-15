// Who edits (issue #155 R1, R2): the MCP client and the model the AI gave lr_begin_session are logged
// in the session log, and reach the classic HUD from plugin 0.23.0 (hud\publisher.ts AI_NAME_PLUGIN)
// and the Deck from 0.3.6 (hud\channel-protocol.ts AI_NAME_DECK) as ai_name and ai_model; older ones
// get neither, as they would refuse the update. Against the simulated Lightroom and Deck.

import { describe, expect, it } from "vitest";
import { SimHudClient, deckRig } from "./helpers/deck-harness.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { clean, client, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

const OPENCODE = { name: "opencode", version: "1" };
const MODEL = "openai/gpt-6-luna";

/** The simulated plugin reports `version` from the next hello on. */
async function pluginAt(version: string): Promise<void> {
  lr.pluginVersion = version;
  plugin.dropEventClient();
  await waitUntil(() => client.stats.drops === 1);
  await client.waitConnected(2000);
}

describe("The AI's name and model", () => {
  it("are in the session log and in the HUD's updates from plugin 0.23.0", async () => {
    await pluginAt("0.23.0");
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain", client: OPENCODE, model: MODEL });
    expect(readLog()).toMatchObject({ client: OPENCODE, model: MODEL });
    const last = await hudAt("awaiting_claude");
    expect(last).toMatchObject({ ai_name: "OpenCode", ai_model: MODEL });
    expect(lr.hud.taken.every((u) => u.ai_name === "OpenCode")).toBe(true);
    expect(rig.hud.stats.invalid).toBe(0);
  });

  it("are not sent to plugin 0.22.0, which does not know them", async () => {
    await pluginAt("0.22.0");
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain", client: OPENCODE, model: MODEL });
    await hudAt("awaiting_claude");
    expect(lr.hud.taken.length).toBeGreaterThan(0);
    expect(lr.hud.taken.some((u) => "ai_name" in u || "ai_model" in u)).toBe(false);
    expect(rig.hud.stats.invalid).toBe(0);
  });

  it("are not sent, nor logged, when the session has no client and no model", async () => {
    await pluginAt("0.23.0");
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const log = readLog();
    expect(["client" in log, "model" in log]).toEqual([false, false]);
    await hudAt("awaiting_claude");
    expect(lr.hud.taken.some((u) => "ai_name" in u || "ai_model" in u)).toBe(false);
  });

  it("a 200-character model is cut to fit and never makes an update invalid", async () => {
    await pluginAt("0.23.0");
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain", client: OPENCODE, model: "é".repeat(200) });
    const last = await hudAt("awaiting_claude");
    expect(String(last.ai_model)).toMatch(/^é+$/);
    expect(new TextEncoder().encode(String(last.ai_model)).length).toBeLessThanOrEqual(120);
    expect([rig.hud.stats.invalid, lr.hud.refused.length]).toEqual([0, 0]);
  });

  it("reach the Deck from 0.3.6, and not 0.3.5", async () => {
    clean();
    const rig = await deckRig();
    const newer = await SimHudClient.connect(rig.endpoint, { hudVersion: "0.3.6" });
    await newer.welcomed();
    await rig.manager.begin({ intent_id: "test_plain", client: OPENCODE, model: MODEL });
    expect(await newer.at("awaiting_claude")).toMatchObject({ ai_name: "OpenCode", ai_model: MODEL });

    const older = await SimHudClient.connect(rig.endpoint, { hudVersion: "0.3.5" });
    const state = await older.at("awaiting_claude");
    expect(["ai_name" in state, "ai_model" in state]).toEqual([false, false]);
    expect([newer.invalid, older.invalid, rig.deck.stats.invalid]).toEqual([[], [], 0]);
  });
});
