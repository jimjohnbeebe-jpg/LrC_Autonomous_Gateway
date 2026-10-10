// fix/offline-original (plugin 0.19.0, engine 0.23.0): a photo whose original file is missing, against
// the simulated Lightroom (lightroom-sim.ts `missing`, which refuses writes and exports as Photos.lua
// missing() does). lr_begin_session refuses it before anything is written; lr_sync_series skips it
// [stated: Jim, 2026-10-09, "Go with recommendations", D2 A]; the context reports it; a file lost
// during an edit is named to Claude and on the HUD, and the snapshot still puts the photo back.

import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lightroomNotices } from "../src/bridge/index.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { PreviewService } from "../src/preview/index.js";
import { MISSING_NOTE } from "../src/session/hud-actions.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { hudRig } from "./helpers/hud-harness.js";
import { ID, client, map, userDir } from "./helpers/session-harness.js";
import { addCopy, clean, logDir, lr, plugin, sent, sync, tmp, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

const quiet = { return_image: "none" } as const;
const fails = async (p: Promise<unknown>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};

describe("a photo whose original file is missing", () => {
  it("is refused by lr_begin_session with ORIGINAL_MISSING, before any snapshot or write", async () => {
    clean();
    lr.missing.add("SIM-UUID");
    const e = await fails(tools.beginSession({ intent_id: "test_plain", ...quiet }));
    expect(e.body()).toMatchObject({ code: "ORIGINAL_MISSING", recoverable: true, details: { filename: "20260907-_OZ80093.NEF", path: "D:\\Photos\\20260907-_OZ80093.NEF", smart_preview: false } });
    expect(e.message).toMatch(/original file of 20260907-_OZ80093\.NEF is missing \(last known at D:\\Photos\\20260907-_OZ80093\.NEF\).*Nothing was written\. Tell the user.*Library > Find All Missing Photos/);
    expect([sent("create_snapshot"), sent("apply_settings"), sent("export_preview")]).toEqual([[], [], []]);
    expect(existsSync(logDir) ? readdirSync(logDir) : []).toEqual([]); // no session log either
  });

  it("is reported by lr_get_active_photo_context, with what to tell the user", async () => {
    clean();
    expect((await tools.getActivePhotoContext()).json).toMatchObject({ original_missing: false, smart_preview: false });
    lr.missing.add("SIM-UUID");
    const json = (await tools.getActivePhotoContext()).json;
    expect(json).toMatchObject({ original_missing: true, original_missing_note: expect.stringMatching(/is missing/) });
  });

  it("is skipped by lr_sync_series with its reason, and the other targets are synced", async () => {
    clean();
    const [a, b] = [addCopy(1), addCopy(2)];
    lr.missing.add(a);
    const out = await sync({ source: { settings: { contrast: 15 } }, targets: { uuids: [a, b] }, adaptive_exposure: false, return_image: "none" });
    expect(out.json).toMatchObject({ applied: 1, skipped: [{ uuid: a, filename: "20260907-_OZ80093.NEF", code: "ORIGINAL_MISSING", reason: expect.stringMatching(/is missing/) }] });
    expect(sent("create_snapshot").map((p) => p["photo_uuid"])).toEqual([b]);
    expect(lr.writes.map((w) => w.uuid)).toEqual([b]);
  });

  it("is listed as failed by lr_export_photos, and the others are exported", async () => {
    clean();
    const exportDir = path.join(tmp, "exports");
    lr.files.exportDir = exportDir;
    const t = new Tools({ client, map, previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }), intents: new IntentLibrary({ map, userDir }), sessionLogDir: logDir, exportDir, engineVersion: "test", ensureBridge: () => client.waitConnected(2000).then(() => undefined) });
    const [gone, here] = lr.library.photos.slice(0, 2).map((p) => p.uuid) as [string, string];
    lr.missing.add(gone);
    const json = (await t.exportPhotos({ uuids: [gone, here], folder: path.join(tmp, "out"), format: "jpeg" })).json;
    expect(json["failed"]).toEqual([{ uuid: gone, code: "ORIGINAL_MISSING", message: expect.stringMatching(/is missing/) }]);
    expect((json["exported"] as Array<{ uuid: string }>).map((x) => x.uuid)).toEqual([here]);
  });

  it("lost during an edit: the step names it, the HUD says it, and lr_end_session revert puts the photo back", async () => {
    clean();
    const rig = hudRig();
    const before = structuredClone(lr.settings);
    await rig.manager.begin({ intent_id: "test_plain" });
    lr.missing.add("SIM-UUID");
    const e = await fails(rig.manager.step({ session_id: ID, settings: { exposure: 0.3 }, rationale: "test" }));
    expect(e.code).toBe("ORIGINAL_MISSING");
    expect(e.message).toMatch(/is missing.*session .* is still open/);
    await waitUntil(() => lr.hud.last()?.note === MISSING_NOTE);
    expect(lr.hud.last()?.stage).toBe("awaiting_claude");
    await rig.manager.end({ session_id: ID, outcome: "revert" }); // apply_snapshot stays allowed
    expect(lr.settings).toEqual(before);
  });

  it("lost during a probe: the probe's put-back still goes through, so no probe value stays (Greptile, PR #101)", async () => {
    clean();
    const rig = hudRig();
    await rig.manager.begin({ intent_id: "test_plain" });
    const exposure = lr.settings["Exposure2012"];
    const apply = plugin.handlers.get("apply_settings") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("apply_settings", (p, id) => {
      const reply = apply(p, id);
      if (String(p["history_name"]).endsWith("probe exposure")) lr.missing.add("SIM-UUID"); // gone before the probe's render
      return reply;
    });
    const e = await fails(rig.manager.probe({ session_id: ID, sliders: ["exposure"] }));
    expect(e.code).toBe("ORIGINAL_MISSING");
    expect(sent("apply_settings").at(-1)).toMatchObject({ put_back: true, history_name: expect.stringMatching(/probe revert$/) });
    expect(lr.settings["Exposure2012"]).toBe(exposure);
  });

  it("the HUD's missing-file line outranks a note waiting to be shown, e.g. a version notice (Greptile, PR #101)", async () => {
    clean();
    lr.lrcVersion = "99.0"; // outside the tested versions: begin leaves a notice for the HUD
    plugin.dropEventClient(); // the next hello reports 99.0
    await waitUntil(() => client.stats.drops === 1);
    await client.waitConnected(2000);
    expect(lightroomNotices(client.hello()?.lrc_version)).not.toEqual([]);
    const snap = plugin.handlers.get("create_snapshot") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("create_snapshot", (p, id) => {
      lr.missing.add("SIM-UUID"); // gone between the begin's checks and pass 0
      return snap(p, id);
    });
    const rig = hudRig();
    expect((await fails(rig.manager.begin({ intent_id: "test_plain" }))).code).toBe("ORIGINAL_MISSING");
    await waitUntil(() => lr.hud.last()?.note === MISSING_NOTE);
  });
});
