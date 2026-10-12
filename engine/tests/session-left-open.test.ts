// Sessions an engine that stopped left open (src/session/left-open.ts; the 2026-10-11 crash, session 7ae27134): a new
// engine lists them, refuses a new session on their photo, and ends them with revert, accept or abandon; against the
// Lightroom sim. "The engine stopped" is a new manager on the same bridge and log folder, the old one dropped.

import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { leftOpenJson } from "../src/session/index.js";
import { ID, clean, client, fails, logDir, logFile, lr, map, newManager, plugin, readLog, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

const FAST = { computeMs: 10_000, dcWaitMs: 300, pollMs: 5, pollMaxMs: 10, dialogAfterMs: 30, probeEveryMs: 10, probeReplyMs: 50, stuckProbesMs: 10_000, settleMs: 50, clearMs: 100 };
const OTHER = "fedcba98-7654-3210-fedc-ba9876543210";
const sent = (name: string): number => plugin.received.filter((r) => r.name === name).length;

/** A session with one pass (exposure +0.2) whose engine then stops; the new engine. */
async function leftBehind() {
  clean();
  const old = newManager();
  await old.begin({ intent_id: "test_plain", return_image: "none" });
  await old.step({ session_id: ID, settings: { exposure: 0.2 }, rationale: "test", return_image: "none" });
  expect(lr.settings["Exposure2012"]).toBe(0.2);
  return newManager({ newId: () => OTHER });
}

describe("a session an engine that stopped left open", () => {
  it("is listed by a new engine, with what the user needs to choose; this engine's own open session is not", async () => {
    const m = await leftBehind();
    const left = m.leftOpen();
    expect(left.map((l) => l.log.session_id)).toEqual([ID]);
    expect(leftOpenJson(left)[0]).toMatchObject({ session_id: ID, passes: 2, snapshot: expect.stringMatching(/^AVG pre-session /), last_failure: null, log_path: logFile() });
    expect(readLog().start?.masks).toEqual(expect.any(String)); // engine 0.29.0 logs the masks before the session
  });

  it("refuses a new session on its photo, nothing written, until it is ended", async () => {
    const m = await leftBehind();
    const snapshots = sent("create_snapshot");
    const e = await fails(m.begin({ intent_id: "test_plain", return_image: "none" }));
    expect(e).toMatchObject({ code: "SESSION_LEFT_OPEN", details: { session_id: ID } });
    expect(sent("create_snapshot")).toBe(snapshots);
    await m.endLeftOpen({ session_id: ID, outcome: "abandon" });
    expect((await m.begin({ intent_id: "test_plain", return_image: "none" })).json).toMatchObject({ ok: true, session_id: OTHER });
    expect(m.leftOpen()).toEqual([]); // the open session is this engine's own
  });

  it("revert: applies its snapshot, checks settings and masks, and finishes its log as a recovery", async () => {
    const m = await leftBehind();
    lr.selected = ""; // the user has moved on: the photo need not be selected (photo_uuid; the review of f5eb667)
    const out = (await m.endLeftOpen({ session_id: ID, outcome: "revert" }))?.json;
    expect(out).toMatchObject({ ok: true, outcome: "revert", left_open: true, ended_by: { source: "recovery" }, revert: { differing: [] }, checked: "settings and masks" });
    expect(lr.settings["Exposure2012"]).toBe(0);
    expect(readLog()).toMatchObject({ outcome: "revert", ended_by: { source: "recovery", reason: expect.stringMatching(/engine test ended a session/) }, revert: { differing: [] } });
    expect(m.leftOpen()).toEqual([]);
    expect(m.endLeftOpen({ session_id: ID, outcome: "revert" })).toBeNull(); // ended: no more a left-open session
  });

  it("accept: keeps the photo as it is now and writes the recipe", async () => {
    const m = await leftBehind();
    lr.selected = "";
    const out = (await m.endLeftOpen({ session_id: ID, outcome: "accept" }))?.json;
    expect(out).toMatchObject({ outcome: "accept", final_settings: { exposure: 0.2 } });
    expect(lr.settings["Exposure2012"]).toBe(0.2);
    const log = readLog();
    expect(log).toMatchObject({ outcome: "accept", final_settings: { exposure: 0.2 } });
    expect(log.recipe_path && existsSync(log.recipe_path)).toBe(true);
  });

  it("after AI_MASK_FAILED: revert is refused by the plugin's guard and logged; abandon drops the guard and a session begins", async () => {
    clean();
    const old = newManager({ aiTimings: FAST });
    await old.begin({ intent_id: "test_plain", return_image: "none", max_passes: 4 });
    lr.masks.tableRoute = "late";
    expect((await fails(old.createMask({ session_id: ID, rationale: "test", return_image: "none", kind: "landscape_vegetation" }))).code).toBe("AI_MASK_FAILED");
    const m = newManager({ newId: () => OTHER, aiTimings: FAST });
    expect(leftOpenJson(m.leftOpen())[0]).toMatchObject({ last_failure: "AI_MASK_FAILED" });

    const e = await fails(m.endLeftOpen({ session_id: ID, outcome: "revert" }) ?? Promise.reject(new Error("not left open")));
    expect(e.message).toMatch(/computing an AI mask/);
    expect(readLog()).toMatchObject({ ended: null, failures: expect.arrayContaining([expect.objectContaining({ stage: "end left open (revert)" })]) });

    const out = (await m.endLeftOpen({ session_id: ID, outcome: "abandon" }))?.json;
    expect(out).toMatchObject({ outcome: "abandoned", lightroom_guard: "cleared", note: expect.stringMatching(/Snapshots panel/) });
    expect(lr.masks.guard.size).toBe(0);
    lr.masks.tableRoute = "computes";
    expect((await m.begin({ intent_id: "test_plain", return_image: "none" })).json).toMatchObject({ ok: true });
  });

  it("abandon with no guard to drop says so", async () => {
    const m = await leftBehind();
    expect((await m.endLeftOpen({ session_id: ID, outcome: "abandon" }))?.json).toMatchObject({ outcome: "abandoned", lightroom_guard: "none" });
    expect(lr.settings["Exposure2012"]).toBe(0.2);
  });
});

describe("through the tools Claude calls", () => {
  it("lr_get_active_photo_context lists it with the note, and lr_end_session ends it", async () => {
    clean();
    const engine = () => new Tools({ client, map, previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }), intents: new IntentLibrary({ map, userDir }), sessionLogDir: logDir, engineVersion: "test", ensureBridge: () => client.waitConnected(2000).then(() => undefined) });
    const old = engine();
    const id = String((await old.beginSession({ intent_id: "test_plain", return_image: "none" })).json["session_id"]);
    const t = engine(); // the old engine stopped
    const context = (await t.getActivePhotoContext()).json;
    expect(context).toMatchObject({ left_open: [{ session_id: id }], left_open_note: expect.stringMatching(/ask, for each, what to do/) });
    expect((await t.endSession({ session_id: id, outcome: "revert" })).json).toMatchObject({ ok: true, left_open: true, outcome: "revert" });
    expect((await t.getActivePhotoContext()).json["left_open"]).toBeUndefined();
  });
});
