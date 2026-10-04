// The HUD's Put back, reported to the engine (src/session/put-back.ts; GitHub issue #59, PR C step 2b,
// plugin 0.13.0) against the simulated Lightroom: "done" ends the session as reverted (log outcome
// "revert", ended_by the HUD) and later calls naming it answer SESSION_ENDED; "failed" leaves it open.

import { describe, expect, it } from "vitest";
import { hudAt, hudRig } from "./helpers/hud-harness.js";
import { hudEvent } from "./helpers/lightroom-sim-hud.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { ID, clean, fails, lr, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

type Rig = ReturnType<typeof hudRig>;
const step = (rig: Rig) => rig.manager.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test" });

describe("Put back from the HUD", () => {
  it("done: the session ends as reverted, with nothing written, and later calls are refused", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    await step(rig);
    const start = structuredClone(lr.snapshots.get("SNAP-1") ?? {});
    Object.assign(lr.settings, start); // the plugin applied the snapshot itself (HudClick.lua)
    const writes = lr.writes.length;
    const click = hudEvent(plugin, "hud_put_back", { session_id: ID, outcome: "done" });
    expect((await hudAt("ended")).note).toBe("Put back: the photo is back as it was before the edit; this edit is over.");
    await waitUntil(() => rig.manager.current() === null);
    expect(lr.writes.length).toBe(writes);
    expect(readLog()).toMatchObject({ outcome: "revert", ended_by: { source: "hud", click_id: click }, revert: { differing: [] } });
    const e = await fails(step(rig));
    expect([e.code, e.details]).toEqual(["SESSION_ENDED", expect.objectContaining({ outcome: "put_back", source: "hud" })]);
  });

  it("failed: the session stays open", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    hudEvent(plugin, "hud_put_back", { session_id: ID, outcome: "failed" });
    await waitUntil(() => rig.events.length === 1);
    expect(rig.events[0]?.note).toBe("Put back did not go through; the edit is still open.");
    expect(rig.manager.current()?.id).toBe(ID);
    expect((await step(rig)).json).toMatchObject({ ok: true });
  });
});
