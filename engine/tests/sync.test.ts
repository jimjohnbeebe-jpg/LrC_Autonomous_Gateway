// lr_sync_series without adaptive exposure (src/sync/, src/mcp/tools-propagation.ts; PRD 6.10,
// PHASE4_PLAN row 8) against the simulated Lightroom: writes by uuid that leave the selection alone,
// the mask, the sources (AC-5's second half on a copy), the targets, the refusals, skipped targets,
// the session queue and the contact sheet.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { BridgeError } from "../src/bridge/index.js";
import { recipeSchema } from "../src/log/index.js";
import { toToolError } from "../src/mcp/index.js";
import type { SyncSeriesArgs } from "../src/mcp/tools-propagation.js";
import { differingSettings } from "../src/params/index.js";
import { PreviewService, type PreviewRequest } from "../src/preview/index.js";
import { syncSeries, type SyncArgs } from "../src/sync/index.js";
import { captureTable } from "./helpers/lightroom-sim-masks.js";
import { acceptedSession, addCopy, clean, client, logDir, lr, map, plugin, sent, sync, syncFails, tmp, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

const short = (out: { json: Record<string, unknown> }): string => (out.json["sync_id"] as string).replace(/-/g, "").slice(0, 4);
const targetsOf = (out: { json: Record<string, unknown> }) => out.json["targets"] as Array<Record<string, unknown>>;
const settingsOf = (uuid: string): Record<string, unknown> => (lr.copies.get(uuid) as { settings: Record<string, unknown> }).settings;
const quiet = { adaptive_exposure: false, return_image: "none" } as const;

describe("lr_sync_series: writes", () => {
  it("writes to photos by uuid and leaves the selection alone", async () => {
    clean();
    const [a, b] = [addCopy(1), addCopy(2)];
    const out = await sync({ source: { settings: { contrast: 15, vibrance: 10 } }, targets: { uuids: [a, b] }, ...quiet });
    expect([settingsOf(a)["Contrast2012"], settingsOf(a)["Vibrance"], settingsOf(b)["Contrast2012"], settingsOf(b)["Vibrance"]]).toEqual([15, 10, 15, 10]);
    expect(lr.settings["Contrast2012"]).toBe(0); // the master
    expect(lr.selected).toBe("SIM-UUID");
    expect(sent("select_photo")).toEqual([]);
    for (const name of ["get_context", "get_settings", "create_snapshot", "apply_settings"]) {
      expect(sent(name).every((p) => typeof p["photo_uuid"] === "string" && p["target_uuid"] === undefined), name).toBe(true);
    }
    const id = short(out);
    expect(lr.writes).toEqual([
      { uuid: a, name: `AVG sync ${id}` },
      { uuid: b, name: `AVG sync ${id}` },
    ]);
    expect(sent("create_snapshot").map((p) => [p["photo_uuid"], p["name"]])).toEqual([
      [a, `AVG pre-sync ${id}`],
      [b, `AVG pre-sync ${id}`],
    ]);
    expect(out.json).toMatchObject({ ok: true, applied: 2, skipped: [], per_target_exposure_offsets: null, copied: ["contrast", "vibrance"], source: { kind: "settings", uuid: null } });
    expect(targetsOf(out)[0]).toMatchObject({ uuid: a, copy_name: "Burst 1", snapshot: { name: `AVG pre-sync ${id}`, id: "SNAP-1" }, history_names: [`AVG sync ${id}`], changed: ["contrast", "vibrance"] });
    expect(out.image).toBeUndefined();
  });

  it("copies only the groups in parameter_mask, as absolute values", async () => {
    clean();
    const { id } = await acceptedSession([{ contrast: 20, "hsl.red.sat": 10 }]);
    const a = addCopy(1, { Contrast2012: -30, SaturationAdjustmentRed: -40 });
    const out = await sync({ source: { session_id: id }, targets: { uuids: [a] }, parameter_mask: ["hsl"], ...quiet });
    const written = sent("apply_settings").at(-1)?.["settings"] as Record<string, unknown>;
    expect(Object.keys(written).every((k) => /^(Hue|Saturation|Luminance)Adjustment/.test(k))).toBe(true);
    expect([settingsOf(a)["SaturationAdjustmentRed"], settingsOf(a)["Contrast2012"]]).toEqual([10, -30]);
    expect(targetsOf(out)[0]?.["changed"]).toEqual(["hsl.red.sat"]);
    expect(out.json["not_copied"]).toEqual(expect.arrayContaining(["contrast", "exposure", "temperature"]));
  });

  it("says the source photo's masks stay on it: masks are not synced (GitHub issue #59)", async () => {
    clean();
    lr.settings["MaskGroupBasedCorrections"] = [structuredClone(captureTable[0])];
    const { id } = await acceptedSession([{ contrast: 20 }]);
    const a = addCopy(1);
    const out = await sync({ source: { session_id: id }, targets: { uuids: [a] }, ...quiet });
    expect(out.json["left_out"]).toEqual([{ name: "masks", reason: expect.stringMatching(/1 mask\(s\) stay on it/) }]);
    expect(Object.keys(sent("apply_settings").at(-1)?.["settings"] as object)).not.toContain("MaskGroupBasedCorrections");
  });

  it('copies the white balance group with WhiteBalance "Custom", which the target reads back (docs\\reports\\phase4\\WB.md)', async () => {
    clean();
    const { id } = await acceptedSession([{ temperature: 400 }]);
    const a = addCopy(1, { Temperature: 4000, WhiteBalance: "As Shot" });
    await sync({ source: { session_id: id }, targets: { uuids: [a] }, parameter_mask: ["white_balance"], ...quiet });
    expect(sent("apply_settings").at(-1)?.["settings"]).toEqual({ Temperature: 5900, Tint: 6, WhiteBalance: "Custom" });
    expect([settingsOf(a)["Temperature"], settingsOf(a)["WhiteBalance"]]).toEqual([5900, "Custom"]);
  });

  it("replays an accepted session's recipe onto a virtual copy: it reads back as the final settings (AC-5, second half)", async () => {
    clean();
    const before = structuredClone(lr.settings);
    const { id, recipe } = await acceptedSession([{ exposure: 0.3, contrast: 20, "hsl.orange.sat": 10, temperature: 300 }]);
    const final = recipeSchema.parse(JSON.parse(readFileSync(recipe, "utf8"))).settings;
    const [a, b] = [addCopy(1, before), addCopy(2, before)];
    expect(differingSettings(map.fromSdk(settingsOf(a)).settings, final)).not.toEqual([]);
    const bySession = await sync({ source: { session_id: id }, targets: { uuids: [a] }, ...quiet });
    expect(bySession.json["source"]).toMatchObject({ kind: "session", session_id: id, recipe_path: recipe, uuid: "SIM-UUID" });
    expect(differingSettings(map.fromSdk(settingsOf(a)).settings, final)).toEqual([]);
    await sync({ source: { recipe_path: path.basename(recipe) }, targets: { uuids: [b] }, ...quiet });
    expect(differingSettings(map.fromSdk(settingsOf(b)).settings, final)).toEqual([]);
  });
});

describe("lr_sync_series: refused before anything is written", () => {
  it("refuses a bad source, mask, target list or plugin", async () => {
    clean();
    const a = addCopy(1);
    mkdirSync(logDir, { recursive: true });
    writeFileSync(path.join(logDir, "20260101-bad000.recipe.json"), "{}", "utf8");
    writeFileSync(path.join(tmp, "elsewhere.recipe.json"), "{}", "utf8");
    const on = (source: SyncSeriesArgs["source"], extra: Partial<SyncSeriesArgs> = {}): SyncSeriesArgs => ({ source, targets: { uuids: [a] }, ...quiet, ...extra });
    const many = Array.from({ length: 21 }, (_, i) => `X-${i}`);
    const cases: Array<[SyncSeriesArgs, string]> = [
      [on({ session_id: "no-such-session" }), "RECIPE_NOT_FOUND"],
      [on({ recipe_path: "20260101-bad000.recipe.json" }), "INVALID_RECIPE"],
      [on({ recipe_path: path.join(tmp, "elsewhere.recipe.json") }), "RECIPE_PATH_REFUSED"],
      [on({ recipe_path: "../elsewhere.recipe.json" }), "RECIPE_PATH_REFUSED"],
      [on({ recipe_path: "notes.json" }), "RECIPE_PATH_REFUSED"],
      [on({ settings: { no_such: 1 } }), "UNKNOWN_PARAMETER"],
      [on({ settings: { contrast: 500 } }), "OUT_OF_RANGE"],
      [on({ settings: { contrast: 5 } }, { adaptive_exposure: true }), "INVALID_ARGUMENTS"],
      [on({ settings: { contrast: 5 } }, { parameter_mask: ["hsl"] }), "INVALID_ARGUMENTS"],
      [on({ settings: { contrast: 5 } }, { targets: { uuids: many } }), "TOO_MANY_TARGETS"],
    ];
    for (const [args, code] of cases) expect((await syncFails(args)).code, JSON.stringify(args.source)).toBe(code);
    const hello = client.hello();
    const old = vi.spyOn(client, "hello").mockReturnValue(hello ? { ...hello, plugin_version: "0.3.0" } : null);
    expect(await syncFails(on({ settings: { contrast: 5 } }))).toMatchObject({ code: "PLUGIN_TOO_OLD", message: expect.stringMatching(/0\.4\.0 or later.*runs 0\.3\.0/) });
    old.mockRestore();
    expect([lr.writes, lr.snapshots.size, sent("get_context")]).toEqual([[], 0, []]);
  });

  it('"selected": refused with no photo selected, with only the source, or with too many', async () => {
    clean();
    const { id } = await acceptedSession();
    const n0 = lr.writes.length;
    lr.selected = "";
    expect(await syncFails({ source: { session_id: id }, targets: "selected", ...quiet })).toMatchObject({ code: "NO_ACTIVE_PHOTO", recoverable: true });
    lr.selected = "SIM-UUID";
    expect((await syncFails({ source: { session_id: id }, targets: "selected", ...quiet })).code).toBe("NO_TARGETS");
    lr.alsoSelected = Array.from({ length: 21 }, (_, i) => addCopy(i + 1));
    expect((await syncFails({ source: { session_id: id }, targets: "selected", ...quiet })).code).toBe("TOO_MANY_TARGETS");
    // More selected than the plugin described: the rest would be neither synced nor skipped.
    lr.alsoSelected = [addCopy(30)];
    const original = plugin.handlers.get("get_selection") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("get_selection", async (p, rid) => {
      const reply = await original(p, rid);
      if (reply !== "silent" && reply.ok) (reply.payload as { count: number }).count = 150;
      return reply;
    });
    expect(await syncFails({ source: { session_id: id }, targets: "selected", ...quiet })).toMatchObject({ code: "TOO_MANY_TARGETS", message: expect.stringMatching(/^150 photos are selected/) });
    expect(lr.writes.length).toBe(n0);
  });
});

describe("lr_sync_series: targets", () => {
  it('"selected": the photos selected in Lightroom, less the source photo; the selection stays', async () => {
    clean();
    const { id } = await acceptedSession([{ contrast: 20 }]);
    const [a, b] = [addCopy(1, { Contrast2012: -10 }), addCopy(2, { Contrast2012: -10 })];
    lr.selected = a;
    lr.alsoSelected = ["SIM-UUID", b];
    const out = await sync({ source: { session_id: id }, targets: "selected", ...quiet });
    expect(sent("get_selection")).toEqual([{ max: 100 }]);
    expect(out.json["skipped"]).toEqual([{ uuid: "SIM-UUID", filename: null, code: "SOURCE", reason: "the source photo is not synced to itself" }]);
    expect(targetsOf(out).map((t) => t["uuid"])).toEqual([a, b]);
    expect([settingsOf(a)["Contrast2012"], settingsOf(b)["Contrast2012"]]).toEqual([20, 20]);
    expect([lr.selected, lr.alsoSelected]).toEqual([a, ["SIM-UUID", b]]);
  });

  it('"selected": a photo without a uuid is skipped and does not count toward the cap (Greptile, PR #35)', async () => {
    clean();
    const { id } = await acceptedSession();
    const [a, b, c, d] = [1, 2, 3, 9].map((n) => addCopy(n));
    lr.selected = a as string;
    lr.alsoSelected = [b as string, c as string, d as string];
    const original = plugin.handlers.get("get_selection") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("get_selection", async (p, rid) => {
      const reply = await original(p, rid);
      if (reply !== "silent" && reply.ok) for (const photo of (reply.payload as { photos: Array<Record<string, unknown>> }).photos) if (photo["uuid"] === d) delete photo["uuid"];
      return reply;
    });
    const out = await sync({ source: { session_id: id }, targets: "selected", adaptive_exposure: true, return_image: "none" });
    expect(out.json["applied"]).toBe(3);
    expect(out.json["skipped"]).toEqual([{ uuid: null, filename: "20260907-_OZ80093.NEF", code: "NO_UUID", reason: "Lightroom gave no uuid for photo 109" }]);
  });

  it("stops when a write gets no answer in time: the step may still land, and the error says so (Greptile, PR #35)", async () => {
    clean();
    const [a, b, c] = [addCopy(1), addCopy(2), addCopy(3)];
    const original = plugin.handlers.get("apply_settings") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("apply_settings", (p, rid) => (p["photo_uuid"] === b ? "silent" : original(p, rid)));
    const previews = new PreviewService(client, { previewDir: path.join(tmp, "previews") });
    const deps = { client, map, logDir, render: (r: PreviewRequest) => previews.render(r), writeTimeoutMs: 150 };
    const args: SyncArgs = { source: { settings: { contrast: 15 } }, targets: { uuids: [a, b, c] }, adaptive_exposure: false, return_image: "none", long_edge: 1600, quality: 75 };
    const e = await syncSeries(deps, args).then(() => null, (err: unknown) => toToolError(err));
    expect(e).toMatchObject({
      code: "BRIDGE_TIMEOUT",
      recoverable: true,
      details: { synced: [a], stopped_at: b, snapshot: { name: expect.stringMatching(/^AVG pre-sync /) }, history_names: [], maybe_written: expect.stringMatching(/^AVG sync [0-9a-f]{4}$/) },
    });
    expect(e?.message).toMatch(/may still write "AVG sync [0-9a-f]{4}"/);
    expect(sent("get_context").map((p) => p["photo_uuid"])).toEqual([a, b]);
  });

  it("says a write or snapshot that was never sent was not written (Greptile, PR #35 round 2)", async () => {
    clean();
    const [a, b] = [addCopy(1), addCopy(2)];
    const real = client.request.bind(client);
    // The client refuses before sending when it is not connected (src/bridge/client.ts request()).
    const refuseFor = (command: string) =>
      vi.spyOn(client, "request").mockImplementation(((name: string, payload: Record<string, unknown>, options?: { timeoutMs?: number }) =>
        name === command && payload["photo_uuid"] === b ? Promise.reject(new BridgeError("not_connected", "bridge is reconnecting", true, name)) : real(name as never, payload as never, options)) as never);
    let spy = refuseFor("apply_settings");
    const write = await syncFails({ source: { settings: { contrast: 15 } }, targets: { uuids: [a, b] }, ...quiet });
    spy.mockRestore();
    expect(write).toMatchObject({ code: "BRIDGE_DISCONNECTED", details: { synced: [a], stopped_at: b, snapshot: { name: expect.stringMatching(/^AVG pre-sync /) }, history_names: [] } });
    expect(write.details).not.toHaveProperty("maybe_written");
    expect(write.message).not.toMatch(/may still/);
    spy = refuseFor("create_snapshot");
    const snapshot = await syncFails({ source: { settings: { contrast: 15 } }, targets: { uuids: [a, b] }, ...quiet });
    spy.mockRestore();
    expect(snapshot.details).toMatchObject({ synced: [a], stopped_at: b, history_names: [] });
    expect(snapshot.details).not.toHaveProperty("snapshot_name");
    expect(snapshot.message).toMatch(/Nothing was written to this photo/);
  });

  it("skips a target that fails and syncs the others; one that failed after its snapshot names it", async () => {
    clean();
    const [a, legacy, b] = [addCopy(1), addCopy(2, { ProcessVersion: "10.0" }), addCopy(3)];
    const out = await sync({ source: { settings: { contrast: 15 } }, targets: { uuids: [a, "NO-SUCH-UUID", legacy, b] }, ...quiet });
    expect(out.json["applied"]).toBe(2);
    expect((out.json["skipped"] as Array<Record<string, unknown>>).map((s) => [s["uuid"], s["code"], s["snapshot"]])).toEqual([
      ["NO-SUCH-UUID", "UNKNOWN_PHOTO", undefined],
      [legacy, "LEGACY_PROCESS_VERSION", undefined],
    ]);
    // Lightroom drops the value: the History step exists, and the snapshot puts the photo back.
    lr.ignored.add("Contrast2012");
    const c = addCopy(4);
    const dropped = await sync({ source: { settings: { contrast: 25 } }, targets: { uuids: [c] }, ...quiet });
    expect(dropped.json["applied"]).toBe(0);
    expect(dropped.json["skipped"]).toEqual([
      {
        uuid: c,
        filename: "20260907-_OZ80093.NEF",
        code: "WRITE_NOT_TAKEN",
        reason: expect.stringMatching(/Contrast2012.*snapshot "AVG pre-sync/),
        snapshot: { name: `AVG pre-sync ${short(dropped)}`, id: expect.any(String) },
        history_names: [`AVG sync ${short(dropped)}`],
      },
    ]);
  });

  it("stops when the bridge is lost, and says which targets were synced", async () => {
    clean();
    const [a, b, c] = [addCopy(1), addCopy(2), addCopy(3)];
    const original = plugin.handlers.get("get_context");
    plugin.handlers.set("get_context", (p, id) => {
      if (p["photo_uuid"] !== b) return (original as NonNullable<typeof original>)(p, id);
      setTimeout(() => plugin.dropEventClient(), 20);
      return "silent";
    });
    const e = await syncFails({ source: { settings: { contrast: 15 } }, targets: { uuids: [a, b, c] }, ...quiet });
    expect(e).toMatchObject({ code: "BRIDGE_DISCONNECTED", recoverable: true, details: { synced: [a], stopped_at: b } });
    expect(e.message).toMatch(/stopped at target 2 of 3/);
    expect(lr.writes.map((w) => w.uuid)).toEqual([a]);
  });
});

describe("lr_sync_series: the session queue and the image", () => {
  it("refuses while a session is open, and a session begun during a sync waits for it", async () => {
    clean();
    const a = addCopy(1);
    const begun = await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect(await syncFails({ source: { settings: { contrast: 15 } }, targets: { uuids: [a] }, ...quiet })).toMatchObject({ code: "SESSION_ALREADY_ACTIVE" });
    await tools.endSession({ session_id: begun.json["session_id"] as string, outcome: "revert" });
    const n0 = plugin.received.length;
    const syncing = sync({ source: { settings: { contrast: 15 } }, targets: { uuids: [a] }, ...quiet });
    const beginning = tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    await Promise.all([syncing, beginning]);
    const snapshots = plugin.received.slice(n0).filter((r) => r.name === "create_snapshot").map((r) => String(r.payload["name"]));
    expect(snapshots.map((n) => n.split(" ").slice(0, 2).join(" "))).toEqual(["AVG pre-sync", "AVG pre-session"]);
  });

  it("returns a contact sheet of the source and the first three targets", async () => {
    clean();
    const { id } = await acceptedSession();
    const uuids = [1, 2, 3, 4].map((n) => addCopy(n));
    const out = await sync({ source: { session_id: id }, targets: { uuids }, adaptive_exposure: false });
    expect(out.json["image"]).toMatchObject({ panels: ["source", "1", "2", "3"], layout: expect.any(String) });
    expect((await sharp(out.image as Buffer).metadata()).format).toBe("jpeg");
    const one = await sync({ source: { settings: { contrast: 5 } }, targets: { uuids: [uuids[0] as string] }, adaptive_exposure: false });
    expect(one.json["image"]).toEqual({ panels: ["1"] });
    expect(one.image).toBeInstanceOf(Buffer);
  });
});
