// Decisions D1-D3 of epic #207: lr_set_develop_settings (params\sdk-passthrough.ts, tools-develop.ts), lr_undo_last_step
// (tools-develop.ts) and lr_remove_photos (tools-remove.ts), against the simulated Lightroom with stand-ins for the
// plugin's set_develop_settings, undo_last_step and remove_photos (DevelopTools.lua, Remove.lua). What Lightroom does
// with each is Jim's `npm run develop-catalog:check` (docs\reports\phase11\DEVELOP-CATALOG-D123.md).

import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { DEVELOP_DEFS } from "../src/mcp/defs-develop.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import { DECISIONS_PLUGIN, setDevelopSettings, undoLastStep } from "../src/mcp/tools-develop.js";
import { removePhotos } from "../src/mcp/tools-remove.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { ParamError, sdkPassthrough } from "../src/params/index.js";
import { PreviewService } from "../src/preview/index.js";
import type { LeftOpen } from "../src/session/index.js";
import type { FakeReply } from "./helpers/fake-plugin.js";
import { luaize } from "./helpers/lightroom-sim.js";
import { client, logDir, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

/** Lightroom in Develop does not take this value of an unranged key (the stand-in leaves the key as it was). */
const REFUSED = 1000;
let tools: Tools;
let removeReply: FakeReply;
beforeEach(() => {
  tools = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
  vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: DECISIONS_PLUGIN });
  const create = plugin.handlers.get("create_snapshot")!;
  plugin.handlers.set("set_develop_settings", async (p, id) => {
    const u = String(p["photo_uuid"]);
    const snap = (await create({ photo_uuid: u, name: p["snapshot_name"] }, id)) as { ok: true; payload: { snapshot_id: string } };
    const s = lr.settingsOf(u);
    for (const [k, v] of Object.entries(p["settings"] as Record<string, unknown>)) if (v !== REFUSED) s[k] = v;
    return { ok: true, payload: { uuid: u, status: "set", snapshot: { id: snap.payload.snapshot_id, name: p["snapshot_name"] }, read_back: luaize(s), ms: 5 } };
  });
  plugin.handlers.set("undo_last_step", () => ({ ok: true, payload: { undone: true, can_undo: false } }));
  removeReply = { ok: true, payload: { status: "removed", removed: ["COPY-A", "COPY-B"], not_removed: [], missing: ["NOPE"] } };
  plugin.handlers.set("remove_photos", () => removeReply);
});

const fails = async (p: Promise<ToolOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};
const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);
const schema = (name: string) => DEVELOP_DEFS.find((d) => d.name === name)?.schema;
const photo0 = (out: ToolOutput) => (out.json["photos"] as Array<Record<string, unknown>>)[0];
const raw = { processVersion: "15.4", pipeline: "raw" } as const;
const paramCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    if (err instanceof ParamError) return `${err.code}: ${err.message}`;
    throw err;
  }
  return "taken";
};
const leftOpen = (uuid: string, variants: string[] = []): LeftOpen[] =>
  [{ file: "x.json", log: { session_id: "20261028-bbbbbb", target: { uuid: "MASTER" }, variants: [uuid, ...variants].map((u) => ({ uuid: u })), snapshot: { name: "AVG pre-session 2026", id: "S-LEFT" } } }] as unknown as LeftOpen[];

describe("params: sdkPassthrough (D1)", () => {
  it("checks a key the canonical map holds by its range and writes it as the map does", () => {
    expect(sdkPassthrough(map, { Exposure2012: 0.5, Temperature: 5600 }, raw)).toEqual({ sdk: { Exposure2012: 0.5, Temperature: 5600, WhiteBalance: "Custom" }, unranged: [], raw: [] });
    expect(paramCode(() => sdkPassthrough(map, { Exposure2012: 9 }, raw))).toMatch(/^out_of_range: exposure = 9 is outside -5\.\.5/);
    // On a photo in HDR edit mode a point curve goes to its extended key (canonical.ts "Point curves").
    expect(sdkPassthrough(map, { ToneCurvePV2012: [0, 0, 255, 255] }, { ...raw, hdr: true }).sdk).toEqual({ ExtendedToneCurvePV2012: [0, 0, 255, 255] });
    expect(paramCode(() => sdkPassthrough(map, { ToneCurvePV2012: [0, 0, 255, 255], ExtendedToneCurvePV2012: [0, 0, 255, 255] }, raw))).toMatch(/^wrong_type: .*both set tone_curve\.master/);
  });

  it("takes another pinned number or boolean of the pinned type and lists the numbers as unranged", () => {
    expect(sdkPassthrough(map, { LensManualDistortionAmount: 10, AutoLateralCA: 1, EnableGrayscaleMix: false }, raw)).toEqual({
      sdk: { LensManualDistortionAmount: 10, AutoLateralCA: 1, EnableGrayscaleMix: false },
      unranged: ["LensManualDistortionAmount"], // AutoLateralCA is lens.ca_remove, a canonical switch
      raw: ["LensManualDistortionAmount", "EnableGrayscaleMix"],
    });
    expect(paramCode(() => sdkPassthrough(map, { LensManualDistortionAmount: true }, raw))).toMatch(/^wrong_type: LensManualDistortionAmount takes a finite number/);
    expect(paramCode(() => sdkPassthrough(map, { EnableGrayscaleMix: 1 }, raw))).toMatch(/^wrong_type: EnableGrayscaleMix takes a true or false/);
  });

  it("refuses unknown keys, keys of the other pipeline, text and table keys, and old process versions", () => {
    expect(paramCode(() => sdkPassthrough(map, { exposure2012: 0.5 }, raw))).toMatch(/^unknown_parameter: "exposure2012" is not a Lightroom key of raw photos/);
    expect(paramCode(() => sdkPassthrough(map, { IncrementalTemperature: 5 }, raw))).toMatch(/^unknown_parameter/);
    expect(paramCode(() => sdkPassthrough(map, { Temperature: 5600 }, { processVersion: "15.4", pipeline: "rendered" }))).toMatch(/^unknown_parameter: "Temperature" is not a Lightroom key of rendered photos/);
    expect(paramCode(() => sdkPassthrough(map, { ProcessVersion: "15.4" }, raw))).toMatch(/holds text.*use lr_set_process_version/);
    expect(paramCode(() => sdkPassthrough(map, { MaskGroupBasedCorrections: [] }, raw))).toMatch(/holds a table.*use the mask tools/);
    expect(paramCode(() => sdkPassthrough(map, { Exposure2012: 0.5 }, { processVersion: "6.7", pipeline: "raw" }))).toMatch(/^unsupported_process_version/);
  });
});

describe("lr_set_develop_settings (D1)", () => {
  it("sends the validated table with an AVG History name and snapshot, and names what changed", async () => {
    Object.assign(lr.settingsOf(lr.uuid), { Exposure2012: 0, LensManualDistortionAmount: 0 });
    const out = await tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { Exposure2012: 0.5, LensManualDistortionAmount: 10 } });
    const [p] = sent("set_develop_settings");
    expect(p).toMatchObject({ photo_uuid: lr.uuid, settings: { Exposure2012: 0.5, LensManualDistortionAmount: 10 }, snapshot_name: expect.stringMatching(/^AVG pre-set [0-9a-f]{6}$/) });
    expect(p?.["history_name"]).toBe(`AVG set develop settings ${String(p?.["snapshot_name"]).slice(-6)}`);
    expect(photo0(out)).toMatchObject({ status: "set", unranged: ["LensManualDistortionAmount"], changed: { exposure: { before: 0, after: 0.5 } } });
  });

  it("names a changed key that no canonical name reads by its SDK key (Greptile, PR #249)", async () => {
    Object.assign(lr.settingsOf(lr.uuid), { LensManualDistortionAmount: 0 });
    const out = await tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { LensManualDistortionAmount: 10 } });
    expect(photo0(out)).toMatchObject({ status: "set", changed: { LensManualDistortionAmount: { before: 0, after: 10 } } });
    expect(photo0(out)).not.toHaveProperty("compare");
  });

  it("puts the photo back from the snapshot when Lightroom did not take a key as written", async () => {
    Object.assign(lr.settingsOf(lr.uuid), { Exposure2012: 0, LensManualDistortionAmount: 0 });
    const out = await tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { Exposure2012: 0.5, LensManualDistortionAmount: REFUSED } });
    expect(sent("apply_snapshot")).toEqual([expect.objectContaining({ photo_uuid: lr.uuid, restore_view: true })]);
    expect(photo0(out)).toMatchObject({ status: "not_taken", not_taken: [{ sdk_key: "LensManualDistortionAmount", written: REFUSED, read_back: 0 }], changed: {} });
    expect(lr.settingsOf(lr.uuid)["Exposure2012"]).toBe(0);
  });

  it("refuses an unknown key for the photo before sending, and refuses during a session and with an older plugin", async () => {
    const out = await tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { NotAKey: 1 } });
    expect(out.json["failed"]).toEqual([expect.objectContaining({ uuid: lr.uuid, code: "UNKNOWN_PARAMETER", message: expect.not.stringContaining("lr_get_active_photo_context") })]);
    expect(JSON.stringify(out.json["failed"])).toContain("lr_get_metadata with raw: true");
    vi.spyOn(client, "hello").mockReturnValueOnce({ ...(client.hello() as HelloResult), plugin_version: "1.6.0" });
    expect((await fails(tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { Exposure2012: 0.5 } }))).code).toBe("PLUGIN_TOO_OLD");
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { Exposure2012: 0.5 } }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent("set_develop_settings")).toEqual([]);
  });

  it("takes 1-100 photos and a non-empty table of numbers, booleans and number arrays; never text", () => {
    const s = schema("lr_set_develop_settings");
    expect(s?.safeParse({ uuids: ["A"], settings: { Exposure2012: 0.5 } }).success).toBe(true);
    for (const bad of [{ uuids: ["A"], settings: {} }, { uuids: ["A"], settings: { CameraProfile: "Adobe Color" } }, { uuids: [], settings: { Exposure2012: 1 } }]) {
      expect(s?.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("lr_undo_last_step (D2)", () => {
  it("sends confirm and answers undone and can_undo", async () => {
    const out = await tools.call(undoLastStep, { confirm: true });
    expect(sent("undo_last_step")).toEqual([{ confirm: true }]);
    expect(out.json).toMatchObject({ undone: true, can_undo: false });
  });

  it("after lr_set_develop_settings: sends that photo, reads it back, and says whether the write was undone", async () => {
    const uuid = lr.uuid;
    await tools.call(setDevelopSettings, { uuids: [uuid], settings: { Exposure2012: 1.25 } });
    const stays = await tools.call(undoLastStep, { confirm: true });
    expect(sent("undo_last_step")).toEqual([{ confirm: true, photo_uuid: uuid }]);
    expect(stays.json["last_write"]).toMatchObject({ uuid, reverted: false, snapshot: { name: expect.stringMatching(/^AVG pre-set /) } });
    expect(String(stays.json["warning"])).toMatch(/not this engine's last lr_set_develop_settings write/);

    const before = { ...lr.settingsOf(uuid) };
    await tools.call(setDevelopSettings, { uuids: [uuid], settings: { Exposure2012: 1.5 } });
    plugin.handlers.set("undo_last_step", () => {
      Object.assign(lr.settingsOf(uuid), before);
      return { ok: true, payload: { undone: true, can_undo: true } };
    });
    const undone = await tools.call(undoLastStep, { confirm: true });
    expect(undone.json["last_write"]).toEqual({ uuid, reverted: true });
    expect(undone.json["warning"]).toBeUndefined();

    await tools.call(undoLastStep, { confirm: true });
    expect(sent("undo_last_step").at(-1)).toEqual({ confirm: true });
  });

  it("is the plain undo after another write, or when the photo written is no longer in the catalog (Greptile, PR #251)", async () => {
    await tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { Exposure2012: 1.25 } });
    await tools.call(removePhotos, { uuids: ["COPY-A", "COPY-B", "NOPE"], confirm: true });
    const after = await tools.call(undoLastStep, { confirm: true });
    expect(sent("undo_last_step").at(-1)).toEqual({ confirm: true });
    expect(after.json["last_write"]).toBeUndefined();

    await tools.call(setDevelopSettings, { uuids: [lr.uuid], settings: { Exposure2012: 1.5 } });
    const getSettings = plugin.handlers.get("get_settings")!;
    plugin.handlers.set("get_settings", (p, id) => (p["photo_uuid"] === lr.uuid ? { ok: false, error: { code: "unknown_photo", message: "no photo in the catalog has uuid", recoverable: false } } : getSettings(p, id)));
    await tools.call(undoLastStep, { confirm: true });
    expect(sent("undo_last_step").at(-1)).toEqual({ confirm: true });
  });

  it("is refused while a session is open or left open, and without confirm: true", async () => {
    const def = DEVELOP_DEFS.find((d) => d.name === "lr_undo_last_step");
    expect(def?.annotations).toMatchObject({ destructiveHint: true, readOnlyHint: false });
    expect(def?.schema.safeParse({}).success).toBe(false);
    expect(def?.schema.safeParse({ confirm: false }).success).toBe(false);
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValueOnce(leftOpen("X"));
    expect((await fails(tools.call(undoLastStep, { confirm: true }))).code).toBe("SESSION_LEFT_OPEN");
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.call(undoLastStep, { confirm: true }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent("undo_last_step")).toEqual([]);
  });
});

describe("lr_remove_photos (D3)", () => {
  it("sends the uuids with confirm and passes on removed, not_removed and missing", async () => {
    const out = await tools.call(removePhotos, { uuids: ["COPY-A", "COPY-B", "NOPE"], confirm: true });
    expect(sent("remove_photos")).toEqual([{ photo_uuids: ["COPY-A", "COPY-B", "NOPE"], confirm: true }]);
    expect(out.json).toMatchObject({ status: "removed", removed: ["COPY-A", "COPY-B"], not_removed: [], missing: ["NOPE"] });
  });

  it("passes on the plugin's refusals: a master without its copies, and a Lightroom older than 14.3", async () => {
    removeReply = { ok: false, error: { code: "copies_not_included", message: "M is the master of 2 virtual copies not named here", recoverable: false } };
    expect((await fails(tools.call(removePhotos, { uuids: ["M"], confirm: true }))).code).toBe("COPIES_NOT_INCLUDED");
    removeReply = { ok: false, error: { code: "feature_unavailable", message: "Removing photos from the catalog needs Lightroom Classic 14.3 or later", recoverable: true } };
    expect((await fails(tools.call(removePhotos, { uuids: ["M"], confirm: true }))).code).toBe("FEATURE_UNAVAILABLE");
  });

  it("refuses a photo of a session left open, an open session and a missing confirm, before sending anything", async () => {
    vi.spyOn(tools.sessionManager()!, "leftOpen").mockReturnValue(leftOpen("COPY-B"));
    const left = await fails(tools.call(removePhotos, { uuids: ["COPY-A", "COPY-B"], confirm: true }));
    expect(left).toMatchObject({ code: "SESSION_LEFT_OPEN", details: { uuid: "COPY-B" } });
    vi.restoreAllMocks();
    vi.spyOn(client, "hello").mockReturnValue({ ...(client.hello() as HelloResult), plugin_version: DECISIONS_PLUGIN });
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.call(removePhotos, { uuids: ["COPY-A"], confirm: true }))).code).toBe("SESSION_ALREADY_ACTIVE");
    const def = DEVELOP_DEFS.find((d) => d.name === "lr_remove_photos");
    expect(def?.annotations).toMatchObject({ destructiveHint: true });
    for (const bad of [{ uuids: ["A"] }, { uuids: ["A"], confirm: false }, { uuids: ["A", "A"], confirm: true }, { uuids: Array.from({ length: 101 }, (_, i) => `P${i}`), confirm: true }]) {
      expect(def?.schema.safeParse(bad).success, JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
    expect(sent("remove_photos")).toEqual([]);
  });
});
