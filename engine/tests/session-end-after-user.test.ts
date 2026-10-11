// lr_end_session after the user ended the session on the Deck (issue #126, hud-actions.ts endedAlike):
// an outcome matching the user's own (accept after Accept; revert after Abort or Put back) succeeds with
// `already_ended_by_user`; a mismatch, or "abandon", still answers SESSION_ENDED. Against the Lightroom sim.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { ToolError } from "../src/mcp/errors.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { ID, clean, client, fails, logDir, logFile, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

type Rig = ReturnType<typeof hudRig>;
const step = (rig: Rig) => rig.manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test" });

describe("lr_end_session after the user ended the session", () => {
  it("accept after the user's Accept succeeds, naming the user's end; revert and abandon are refused", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await step(rig);
    hudEvent(plugin, "hud_accept", { session_id: ID });
    await hudAt("accepted");
    const logPath = logFile();
    const out = await rig.manager.end({ session_id: ID, outcome: "accept" });
    expect(out.json).toEqual({
      ok: true,
      session_id: ID,
      outcome: "accept",
      already_ended_by_user: { outcome: "accept", source: "hud", at: expect.any(String), log_path: logPath },
      log_path: logPath,
    });
    expect((await fails(rig.manager.end({ session_id: ID, outcome: "revert" }))).code).toBe("SESSION_ENDED");
    expect((await fails(rig.manager.end({ session_id: ID, outcome: "abandon" }))).code).toBe("SESSION_ENDED");
  });

  it("revert after the user's Abort succeeds; accept is refused", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    hudEvent(plugin, "hud_abort", { session_id: ID });
    await hudAt("aborted");
    const out = await rig.manager.end({ session_id: ID, outcome: "revert" });
    expect(out.json).toMatchObject({ ok: true, outcome: "revert", already_ended_by_user: { outcome: "aborted", source: "hud" } });
    expect((await fails(rig.manager.end({ session_id: ID, outcome: "accept" }))).code).toBe("SESSION_ENDED");
  });

  // Review, 2026-10-11: lr_end_session waited for the bridge first, so with Lightroom quit after the
  // Deck's Accept the matching outcome failed as not connected.
  it("lr_end_session answers the user's own outcome without waiting for Lightroom", async () => {
    clean();
    let gone = false;
    let waits = 0;
    const tools = new Tools({
      client,
      map,
      previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
      intents: new IntentLibrary({ map, userDir }),
      sessionLogDir: logDir,
      engineVersion: "test",
      ensureBridge: async () => {
        waits++;
        if (gone) throw new ToolError("NOT_CONNECTED", "Lightroom is not connected.", true);
        await client.waitConnected(2000);
      },
    });
    const id = String((await tools.beginSession({ intent_id: "test_plain" })).json["session_id"]);
    await tools.step({ session_id: id, settings: { exposure: 0.2 }, rationale: "test" });
    hudEvent(plugin, "hud_accept", { session_id: id });
    await waitUntil(() => tools.sessionManager()?.current() === null);
    gone = true;
    const before = waits;
    const out = await tools.endSession({ session_id: id, outcome: "accept" });
    expect(out.json).toMatchObject({ ok: true, already_ended_by_user: { outcome: "accept", source: "hud" } });
    expect(waits).toBe(before);
  });

  it("revert after the HUD's Put back succeeds", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    Object.assign(lr.settings, structuredClone(lr.snapshots.get("SNAP-1") ?? {}));
    hudEvent(plugin, "hud_put_back", { session_id: ID, outcome: "done" });
    await waitUntil(() => rig.manager.current() === null);
    const out = await rig.manager.end({ session_id: ID, outcome: "revert" });
    expect(out.json).toMatchObject({ ok: true, already_ended_by_user: { outcome: "put_back", source: "hud" } });
  });
});
