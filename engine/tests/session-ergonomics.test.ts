// Session ergonomics (issues #161-#164, #167) against the simulated Lightroom (tests/helpers/session-harness.ts):
// session_id left out while a session is open, lr_begin_session dry_run, regions kept into the next session on
// the photo, the advisory after repeated accepted sessions, and the pre-session snapshot deleted after a full revert.

import path from "node:path";
import { describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { client, clean, lr, map, newManager, tmp, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();

/** A manager whose sessions get ids 01, 02, … so several sessions in one test keep their own logs. */
const manyIds = () => {
  let n = 0;
  return newManager({ newId: () => `${String(++n).padStart(6, "0")}aa-0000-0000-0000-000000000000` });
};
const box = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };

describe("issue #164: session_id left out", () => {
  const tools = () =>
    new Tools({
      client,
      map,
      previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
      intents: new IntentLibrary({ map, userDir: path.join(tmp, "intents") }),
      sessionLogDir: path.join(tmp, "logs"),
      engineVersion: "test",
      ensureBridge: () => client.waitConnected(2000).then(() => undefined),
    });

  it("names the open session, and is refused with SESSION_NOT_ACTIVE when none is open", async () => {
    clean();
    const t = tools();
    await expect(t.setRegions({ regions: [] })).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
    const begun = await t.beginSession({ intent_id: "test_plain", max_passes: 2, return_image: "none" });
    const id = begun.json["session_id"];
    expect((await t.step({ settings: { exposure: 0.1 }, rationale: "r", return_image: "none" })).json["session_id"]).toBe(id);
    expect((await t.endSession({ outcome: "revert" })).json).toMatchObject({ session_id: id, outcome: "revert" });
    await expect(t.endSession({ outcome: "revert" })).rejects.toMatchObject({ code: "SESSION_NOT_ACTIVE" });
  });
});

describe("issue #161: lr_begin_session dry_run", () => {
  it("returns pass 0's plan with no snapshot, no write and no session", async () => {
    clean();
    const manager = newManager();
    const out = await manager.begin({ intent_id: "test_prior", dry_run: true });
    expect(out.json).toMatchObject({ ok: true, dry_run: true, mode: "converge", intent: { id: "test_prior" } });
    expect(out.json["pass0"]).toMatchObject({ changes: { exposure: 0.2, camera_profile: "Adobe Color" } });
    expect(lr.snapshots.size).toBe(0);
    expect(lr.history).toEqual([]);
    expect(manager.current()).toBeNull();
  });
});

describe("issues #163, #167, #162: the next session on the photo", () => {
  it("keeps the last session's regions on request, warns after two accepted sessions, and deletes the snapshot after a full revert", async () => {
    clean();
    const manager = manyIds();
    const regions = [{ kind: "sky" as const, label: "sky", box, preserve: true }];
    const first = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    await manager.setRegions({ session_id: String(first.json["session_id"]), regions });
    await manager.end({ session_id: String(first.json["session_id"]), outcome: "accept" });

    const second = await manager.begin({ intent_id: "test_plain", return_image: "none", keep_regions: true });
    expect(second.json["regions_kept"]).toMatchObject({ regions: [{ label: "sky" }], preserved: [{ label: "sky" }] });
    expect(second.json["advisory"]).toBeUndefined();
    await manager.end({ session_id: String(second.json["session_id"]), outcome: "accept" });

    const third = await manager.begin({ intent_id: "test_plain", return_image: "none" });
    expect(third.json["advisory"]).toMatch(/already had 2 accepted sessions/);
    expect(third.json["regions_kept"]).toBeUndefined();
    const end = await manager.end({ session_id: String(third.json["session_id"]), outcome: "revert" });
    expect(end.json).toMatchObject({ revert: { differing: [] }, snapshot_removed: true });
    expect(lr.deletedSnapshots).toEqual([(third.json["snapshot"] as { id: string }).id]);
  });
});
