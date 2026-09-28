// Variants mode's refusals and failures (src/session/copies.ts, targets.ts): what lr_begin_session
// checks before it writes anything, create_virtual_copies failing the ways the plugin can (busy, a
// partial batch, a copy that fails its identity check, no answer: PHASE4_PLAN "For row 7, from
// PR #33"), a copy that cannot be selected; then regions and probes on the copies, and the context
// tools' `target`.

import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { SHORT, clean, client, fails, logDir, lr, manager, map, newManager, plugin, readLog, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

const begin = (extra: Record<string, unknown> = {}) => manager.begin({ intent_id: "test_variants", mode: "variants", ...extra });
const ID = (): string => readLog().session_id;
const sent = (name: string) => plugin.received.filter((r) => r.name === name);

describe("Variants mode: refused before anything is written", () => {
  it("refuses a plugin before 0.3.0, an intent without variants, 4 copies, and variant_count in Converge mode", async () => {
    clean();
    const hello = client.hello();
    const old = vi.spyOn(client, "hello").mockReturnValue(hello ? { ...hello, plugin_version: "0.2.0" } : null);
    expect(await fails(begin())).toMatchObject({ code: "PLUGIN_TOO_OLD", message: expect.stringMatching(/0\.3\.0 or later.*runs 0\.2\.0/) });
    old.mockRestore();
    expect((await fails(manager.begin({ intent_id: "test_plain", mode: "variants" }))).message).toMatch(/has no variants/);
    expect((await fails(begin({ variant_count: 4 }))).message).toMatch(/variant_count must be 2-3/);
    expect((await fails(manager.begin({ intent_id: "test_variants", variant_count: 3 }))).message).toMatch(/for mode "variants"/);
    expect(lr.snapshots.size).toBe(0);
    expect(sent("create_virtual_copies")).toEqual([]);
  });

  it("refuses a virtual copy as the master: the user selects the master", async () => {
    clean();
    lr.copies.set("SIM-COPY-9", { uuid: "SIM-COPY-9", local_id: 109, copy_name: "Copy 1", settings: structuredClone(lr.settings) });
    lr.selected = "SIM-COPY-9";
    expect(await fails(begin())).toMatchObject({ code: "VIRTUAL_COPY_SELECTED", recoverable: true });
    expect(lr.snapshots.size).toBe(0);
  });
});

describe("Variants mode: create_virtual_copies fails", () => {
  it("busy: no copy was made; the session stays open and revert ends it", async () => {
    clean();
    lr.copyFault = { kind: "busy" };
    const error = await fails(begin());
    expect(error).toMatchObject({ code: "BUSY", recoverable: true, message: expect.stringMatching(/No copy was made.*still open/) });
    expect(readLog().failures[0]).toMatchObject({ stage: "begin", error: { code: "BUSY" } });
    const end = await manager.end({ session_id: ID(), outcome: "revert" });
    expect(end.json).toMatchObject({ outcome: "revert", copies: [] });
  });

  it("a partial batch: names the copies made, logs them, and keeps them at revert", async () => {
    clean();
    lr.copyFault = { kind: "partial", made: 2, code: "lock_lost" };
    const error = await fails(begin());
    expect(error.code).toBe("VARIANTS_INCOMPLETE");
    expect(error.message).toMatch(/made 2 of 3 copies: "AVG test_variants A" \(SIM-COPY-1\), "AVG test_variants B" \(SIM-COPY-2\); it stopped because .*lock_lost/);
    expect(readLog().variants.map((v) => v.uuid)).toEqual(["SIM-COPY-1", "SIM-COPY-2"]);
    // The session only reverts now: no pass on the copies made, no pick.
    expect((await fails(manager.step({ session_id: ID(), target: "A", settings: { exposure: 0.1 }, rationale: "x" }))).code).toBe("VARIANTS_INCOMPLETE");
    expect((await fails(manager.selectVariant({ session_id: ID(), variant: "A" }))).code).toBe("VARIANTS_INCOMPLETE");
    expect((await fails(manager.end({ session_id: ID(), outcome: "accept" }))).code).toBe("AWAITING_PICK");
    const end = await manager.end({ session_id: ID(), outcome: "revert" });
    expect((end.json["copies"] as Array<{ id: string }>).map((c) => c.id)).toEqual(["A", "B"]);
  });

  it("a copy that fails its identity check is not used, nor any after it", async () => {
    clean();
    lr.copyFault = { kind: "wrong_identity", index: 1 };
    const error = await fails(begin());
    expect(error.code).toBe("VARIANTS_INCOMPLETE");
    expect(error.message).toMatch(/"not asked for" \(SIM-COPY-2, not a copy of the master with that name\)/);
    expect(readLog().variants.map((v) => v.id)).toEqual(["A"]);
  });

  it("no answer in time: says the copies may still come, and the session stays open for revert", async () => {
    clean();
    lr.copyFault = { kind: "silent" };
    const m = newManager({ copiesTimeoutMs: 300 });
    const error = await fails(m.begin({ intent_id: "test_variants", mode: "variants" }));
    expect(error).toMatchObject({ code: "BRIDGE_TIMEOUT", recoverable: false });
    expect(error.message).toMatch(/within 0\.3 s\. It may still be making the copies named "AVG test_variants A", "AVG test_variants B", "AVG test_variants C"/);
    expect(error.details).toMatchObject({ names: ["AVG test_variants A", "AVG test_variants B", "AVG test_variants C"] });
    expect((await m.end({ session_id: ID(), outcome: "revert" })).json).toMatchObject({ outcome: "revert", copies: [] });
  });
});

describe("Variants mode: a copy that cannot be selected", () => {
  it("stops lr_begin_session when Lightroom does not select a copy; revert still ends the session", async () => {
    clean();
    lr.selectFault = "Lightroom did not select photo 101";
    const error = await fails(begin());
    expect(error).toMatchObject({ code: "SELECT_FAILED", message: expect.stringMatching(/Could not select copy A \("AVG test_variants A"\) in Lightroom/) });
    expect((await fails(manager.step({ session_id: ID(), target: "A", settings: { exposure: 0.1 }, rationale: "x" }))).code).toBe("VARIANTS_INCOMPLETE");
    lr.selectFault = null;
    expect((await manager.end({ session_id: ID(), outcome: "revert" })).json).toMatchObject({ outcome: "revert" });
  });

  it("refuses a step on a copy removed from the catalog", async () => {
    clean();
    await begin();
    lr.copies.delete("SIM-COPY-2");
    const error = await fails(manager.step({ session_id: ID(), target: "B", settings: { exposure: 0.1 }, rationale: "x" }));
    expect(error).toMatchObject({ code: "UNKNOWN_PHOTO", message: expect.stringMatching(/Could not select copy B/) });
  });
});

describe("Variants mode: regions and probes on the copies", () => {
  it("measures regions on every copy and keeps a baseline per copy", async () => {
    clean();
    await begin();
    const out = await manager.setRegions({ session_id: ID(), regions: [{ kind: "custom", label: "orange", box: { x: 0.1, y: 0.6, w: 0.5, h: 0.3 }, preserve: true }] });
    expect(out.json).toMatchObject({ measured_on: "C", photos: ["A", "B", "C"] });
    const baselines = (out.json["preserved"] as Array<{ baselines: Record<string, unknown> }>)[0]?.baselines;
    expect(Object.keys(baselines ?? {})).toEqual(["A", "B", "C"]);
    expect(Object.keys(readLog().regions[0]?.baselines ?? {})).toEqual(["A", "B", "C"]);
  });

  it("probes a copy, names it in the History, and puts it back", async () => {
    clean();
    await begin();
    const before = lr.copies.get("SIM-COPY-2")?.settings["Exposure2012"];
    const out = await manager.probe({ session_id: ID(), target: "B", sliders: ["exposure"] });
    expect(out.json).toMatchObject({ target: "B", results: [{ name: "exposure" }] });
    expect(lr.history.slice(-2)).toEqual([`AVG ${SHORT} B probe exposure`, `AVG ${SHORT} B probe revert`]);
    expect(lr.copies.get("SIM-COPY-2")?.settings["Exposure2012"]).toBe(before);
    expect(readLog().probes.map((p) => p.target)).toEqual(["B"]);
    expect((await fails(manager.probe({ session_id: ID(), sliders: ["exposure"] }))).code).toBe("INVALID_ARGUMENTS");
  });
});

describe("Variants mode: the context tools' target", () => {
  const tools = (): Tools =>
    new Tools({
      client,
      map,
      previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
      intents: new IntentLibrary({ map, userDir }),
      sessionLogDir: logDir,
      ensureBridge: () => client.waitConnected(2000).then(() => undefined),
      historyPrefix: "AVG test",
    });

  it("previews and measures a named copy, and says a copy is a session photo", async () => {
    clean();
    const t = tools();
    const begun = await t.beginSession({ intent_id: "test_variants", mode: "variants", return_image: "none" });
    const id = begun.json["session_id"] as string;
    const preview = await t.getPreview({ session_id: id, target: "B", long_edge: 800 });
    expect(preview.json).toMatchObject({ target: "B", uuid: "SIM-COPY-2", width: 800 });
    expect(lr.selected).toBe("SIM-COPY-2");
    const metrics = await t.getMetrics({ session_id: id, target: "B" });
    expect(metrics.json).toMatchObject({ target: "B", uuid: "SIM-COPY-2", preview_hash: preview.json["preview_hash"] });
    expect((await t.getMetrics({ session_id: id, target: "A" })).json).toMatchObject({ target: "A", uuid: "SIM-COPY-1" });
    const region = await t.getPreview({ session_id: id, target: "A", region: { x: 0, y: 0, w: 0.5, h: 0.5 }, long_edge: 800 });
    expect(region.json).toMatchObject({ target: "A", uuid: "SIM-COPY-1" });
    const context = await t.getActivePhotoContext();
    expect(context.json).toMatchObject({ uuid: "SIM-COPY-1", is_virtual_copy: true, session_active: true, open_session: { mode: "variants", target: "A" } });
    // The user clicks copy C in Lightroom: the context describes C, not A that the session last worked on (Greptile, PR #34).
    lr.selected = "SIM-COPY-3";
    const clicked = await t.getActivePhotoContext();
    expect(clicked.json).toMatchObject({ uuid: "SIM-COPY-3", session_active: true, open_session: { target: "C", uuid: "SIM-COPY-3", pass: "0/4", describes: "the selected photo" } });
    lr.selected = "OTHER-UUID";
    expect((await t.getActivePhotoContext()).json).toMatchObject({ session_active: false, open_session: { target: "A", describes: "the photo the session last worked on" } });
    await expect(t.getPreview({ target: "A" })).rejects.toMatchObject({ code: "INVALID_ARGUMENTS" });
  });

  it("says a copy has no preview yet rather than answer with another photo's metrics", async () => {
    clean();
    lr.selectFault = "Lightroom did not select photo 101"; // lr_begin_session stops after making the copies
    const t = tools();
    await expect(t.beginSession({ intent_id: "test_variants", mode: "variants", return_image: "none" })).rejects.toMatchObject({ code: "SELECT_FAILED" });
    const id = t.sessionManager()?.current()?.id as string;
    expect(t.lastRender()).not.toBeNull(); // the master's render, from before the copies
    await expect(t.getMetrics({ session_id: id, target: "A" })).rejects.toMatchObject({ code: "NO_PREVIEW_YET", message: expect.stringMatching(/copy A/) });
    expect((await t.getMetrics({ session_id: id, target: "master" })).json).toMatchObject({ target: "master", uuid: "SIM-UUID" });
  });

  it("runs a region preview of one copy and a step on another sent at the same time one after the other", async () => {
    clean();
    const t = tools();
    const id = (await t.beginSession({ intent_id: "test_variants", mode: "variants", return_image: "none" })).json["session_id"] as string;
    const [region, stepped] = await Promise.all([
      t.getPreview({ session_id: id, target: "A", region: { x: 0, y: 0, w: 0.5, h: 0.5 }, long_edge: 800 }),
      t.step({ session_id: id, target: "B", settings: { contrast: 5 }, rationale: "x", return_image: "none" }),
    ]);
    expect(region.json).toMatchObject({ target: "A", uuid: "SIM-COPY-1" });
    expect(stepped.json).toMatchObject({ target: "B", pass: "1/4" });
  });
});
