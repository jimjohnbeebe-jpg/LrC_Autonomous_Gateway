// Spike S10's check (devtools\s10-check.ts, `npm run s10:check`) against the simulated plugin with
// a rendered photo in a "fixtures" collection: the settings Lightroom 15.6 reported for DSC_0031.JPG
// on 2026-10-08 [handle: tests\fixtures\s10-rendered-dsc0031.json, from the read-only probe
// logs\nonraw-2026-10-08\probe-jpeg.mts], and CameraProfile/Look in `ignored`, as Lightroom kept
// "Embedded" when a raw pair was written to it [handle: logs\20261008-774c64.json failures[0]].
// The sim takes any numeric value, so what it records for the range probes is the shape, not
// Lightroom's answer.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient } from "../src/bridge/index.js";
import type { Answer } from "../src/devtools/phase1-check.js";
import { runS10Check, type S10Options } from "../src/devtools/s10-check.js";
import { COLLECTION, COPY_NAMES, pipelineOf } from "../src/devtools/s10-config.js";
import { EXTRA_VALUES } from "../src/devtools/s10-probe.js";
import { BridgeGate } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim, nefDump } from "./helpers/lightroom-sim.js";

const map = loadDefaultParamMap();
const rendered = JSON.parse(readFileSync(new URL("./fixtures/s10-rendered-dsc0031.json", import.meta.url), "utf8")) as { settings: Record<string, unknown> };
const JPG = "SIM-JPG";
let tmp = "";
let plugin: FakePlugin;
let lr: LightroomSim;
let client: BridgeClient;
const said: string[] = [];
const dirs = { dump: "", recorder: "", previews: "" };

const recorderFile = (captures: unknown[]): string =>
  JSON.stringify({ recorder: "AVG S10 profile recorder", started_at: "2026-10-09T10:00:00", captures });
const MONO = { Name: "Adobe Monochrome", UUID: "MONO-UUID", Parameters: { ConvertToGrayscale: true } };

beforeEach(async () => {
  tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-s10-"));
  dirs.dump = path.join(tmp, "census");
  dirs.recorder = path.join(tmp, "run1");
  dirs.previews = path.join(tmp, "previews");
  for (const d of Object.values(dirs)) mkdirSync(d);
  // Three captures as S10Recorder.lua writes them: Embedded (no Look: the field is absent), Monochrome as a Look, and Monochrome as ConvertToGrayscale (run 1's finding).
  writeFileSync(path.join(dirs.recorder, "s10_profiles_recorded_2026-10-09T10_00_00.json"), recorderFile([
    { filename: "DSC_0031.JPG", file_format: "JPG", camera_profile: "Embedded", look_name: null, look_uuid: null, convert_to_grayscale: false, profile_settings: { CameraProfile: "Embedded", Look: [], ConvertToGrayscale: false }, process_version: "15.4" },
    { filename: "DSC_0031.JPG", file_format: "JPG", camera_profile: "Embedded", look_name: MONO.Name, look_uuid: MONO.UUID, look: MONO, convert_to_grayscale: false, profile_settings: { CameraProfile: "Embedded", Look: MONO, ConvertToGrayscale: false }, process_version: "15.4" },
    { filename: "DSC_0031.JPG", file_format: "JPG", camera_profile: "Embedded", look_name: null, look_uuid: null, convert_to_grayscale: true, profile_settings: { CameraProfile: "Embedded", Look: [], ConvertToGrayscale: true }, process_version: "15.4" },
  ]));
  plugin = await FakePlugin.start();
  lr = new LightroomSim(dirs.previews);
  lr.library.photos.push({ uuid: JPG, local_id: 4, filename: "DSC_0031.JPG", rating: 0, keywords: [], day: "2004-09-25", gps: null, file_format: "JPG", settings: structuredClone(rendered.settings) });
  lr.library.collections.push({ local_id: 503, name: COLLECTION, smart: false, photos: [lr.uuid, JPG] });
  lr.install(plugin);
  said.length = 0;
});

afterEach(async () => {
  client?.stop();
  await plugin.close();
  rmSync(tmp, { recursive: true, force: true });
});

function run(answers: Answer[], options: S10Options = {}) {
  const queue = [...answers];
  client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
  const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
  return runS10Check({ client, gate, map, ask: async () => queue.shift() ?? "no answer", say: (l) => said.push(l), stamp: "2026-10-09T10-00-00-000Z", dumpDir: dirs.dump, recorderDir: dirs.recorder, previewDir: dirs.previews, connectTimeoutMs: 2000, settleMs: 0 }, options);
}

type J = Record<string, unknown>;
const sent = (name: string): J[] => plugin.received.filter((r) => r.name === name).map((r) => r.payload);
const jpgSettings = (): Record<string, unknown> => lr.library.find(JPG)?.settings as Record<string, unknown>;

describe("spike S10: the pipeline from the settings", () => {
  it("names raw from a Kelvin Temperature and rendered from Embedded with none; disagreement is unknown", () => {
    expect(pipelineOf(map, nefDump.settings).pipeline).toBe("raw");
    expect(pipelineOf(map, rendered.settings)).toMatchObject({ pipeline: "rendered", signals: { temperature_present: false, camera_profile: "Embedded", embedded: true } });
    expect(pipelineOf(map, { ...rendered.settings, Temperature: 5000 }).pipeline).toBe("unknown");
    expect(pipelineOf(map, { ...nefDump.settings, CameraProfile: "Embedded" }).pipeline).toBe("unknown");
  });
});

describe("npm run s10:check", () => {
  it("--census: reads every photo of the collection by uuid, saves a dump each, writes nothing", async () => {
    const { worked, results } = await run([], { censusOnly: true });
    expect(worked).toBe(true);
    const c = results["census"] as J;
    expect(c["pipelines"]).toEqual({ raw: 1, rendered: 1, unknown: 0 });
    expect((c["photos"] as J[]).map((p) => [p["filename"], p["pipeline"], p["selected"]])).toEqual([["20260907-_OZ80093.NEF", "raw", true], ["DSC_0031.JPG", "rendered", false]]);
    expect((c["photos"] as J[])[1]).toMatchObject({ file_format: "JPG", process_version: "15.4", extra_keys: expect.arrayContaining(["IncrementalTemperature", "IncrementalTint"]), missing_pinned_keys: expect.arrayContaining(["Temperature", "Tint", "Look"]) });
    expect(c["rendered"]).toMatchObject({ photos: 1, extra_keys_in_all: expect.arrayContaining(["IncrementalTemperature"]) });
    expect(readdirSync(dirs.dump).sort()).toEqual(["s10_20260907-_OZ80093.NEF__SIM-UUID.json", "s10_DSC_0031.JPG__SIM-JPG.json"]);
    const dump = JSON.parse(readFileSync(path.join(dirs.dump, "s10_DSC_0031.JPG__SIM-JPG.json"), "utf8")) as J;
    expect(dump["meta"]).toMatchObject({ spike: "S10", filename: "DSC_0031.JPG", pipeline: "rendered" });
    expect(dump["settings"]).toEqual(rendered.settings);
    expect(sent("get_settings").every((p) => typeof p["photo_uuid"] === "string" && p["target_uuid"] === undefined)).toBe(true);
    expect(sent("apply_settings")).toEqual([]);
    expect(sent("create_snapshot")).toEqual([]);
    expect(results).not.toHaveProperty("writes");
    // Every page of the collection is read (the sim's page is one here); a library-only photo without settings stays unknown to the Develop commands.
    expect(sent("search_photos").map((p) => [p["collection_id"], p["offset"]])).toEqual([[503, 0]]);
    const getSettings = plugin.handlers.get("get_settings") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    expect(await getSettings({ photo_uuid: "SIM-LIB-2" }, "x")).toMatchObject({ ok: false, error: { code: "unknown_photo" } });
  });

  it("--fixtures: refuses to add anything while two collections carry the name", async () => {
    lr.library.collections.push({ local_id: 504, name: COLLECTION, smart: false, photos: [] });
    const { worked, results } = await run([], { fixtures: true });
    expect(worked).toBe(false);
    // The fixtures step refuses first; the census then refuses by the same rule.
    expect(results["errors"]).toEqual([expect.stringContaining("2 collections named"), expect.stringContaining("2 collections named")]);
    expect(sent("collection_photos")).toEqual([]);
    expect(sent("create_collection")).toEqual([]);
  });

  it("writes the battery to each photo behind a snapshot, rendered first, and puts every one back", async () => {
    lr.ignored.add("CameraProfile");
    lr.ignored.add("Look");
    const { worked, results } = await run(["y", "y", "y", "y"]);
    expect(worked).toBe(true);
    expect(results["summary"]).toMatchObject({ suggestion: "WORKED", put_back_all: true, exports: { ok: 2, of: 2 } });
    const writes = results["writes"] as J[];
    expect(writes.map((w) => [w["filename"], w["pipeline"]])).toEqual([["DSC_0031.JPG", "rendered"], ["20260907-_OZ80093.NEF", "raw"]]);
    const jpg = writes[0] as J;
    // The range probe skips the two Kelvin parameters the photo lacks; the keys beyond the pin get every value.
    expect(jpg["range"]).toMatchObject({ completed: true, absent: ["temperature", "tint"], parameters: (jpg["range"] as J)["min_accepted"] });
    const extra = jpg["extra_keys"] as J;
    expect(extra["keys"]).toEqual(expect.arrayContaining(["IncrementalTemperature", "IncrementalTint"]));
    // The sim takes the relative white balance on a selected rendered photo only with "Custom", as S10 run 2
    // observed (helpers/lightroom-sim-rendered.ts): alone, under "As Shot", each value reads back the photo's 0.
    expect(((extra["per_key"] as J[])[0] as J)["results"]).toEqual(EXTRA_VALUES.map((v) => (v === 0 ? { written: 0, read_back: 0, outcome: "taken" } : { written: v, read_back: 0, outcome: "ignored" })));
    expect(jpg["white_balance"]).toMatchObject({ keys: ["IncrementalTemperature", "IncrementalTint"], custom_taken: true, values_taken: true });
    expect((jpg["lens"] as J)["steps"]).toMatchObject([{ label: "lens off", taken: true }, { label: "lens on", taken: true }]);
    // Lightroom keeping Embedded: the recorded Monochrome Look and the raw control are both "not taken"; the ConvertToGrayscale form is written verbatim and taken.
    const pairs = (jpg["profiles"] as J)["pairs"] as J[];
    expect(pairs.map((p) => [p["label"], p["taken"]])).toEqual([["recorded: Embedded", true], ["recorded: Adobe Monochrome", false], ["recorded: Embedded + ConvertToGrayscale", true], ["control: raw pair Adobe Color", false], ["Look cleared, CameraProfile as at the start", true]]);
    expect(pairs[2]).toMatchObject({ written: { camera_profile: "Embedded", ConvertToGrayscale: true }, read_back: { ConvertToGrayscale: true } });
    expect(jpg["put_back"]).toMatchObject({ ok: true, differing: [] });
    // Each photo is selected before its battery (Lightroom checks writes on the photo in Develop only), and Jim's selection is put back at the end.
    expect(sent("select_photo").map((p) => p["uuid"])).toEqual([JPG, lr.uuid, lr.uuid]);
    expect(jpg["selected_for_writes"]).toBe(true);
    expect(results["selection_restored"]).toEqual({ uuid: lr.uuid, photo: "20260907-_OZ80093.NEF", ok: true });
    expect(lr.selected).toBe(lr.uuid);
    expect(jpgSettings()).toEqual(rendered.settings);
    expect(lr.settings).toEqual(nefDump.settings);
    // Every write by uuid; the History names say what each was; Jim was asked about his own photo only (the raw master: WB twice, profiles twice).
    expect(sent("apply_settings").every((p) => typeof p["photo_uuid"] === "string")).toBe(true);
    expect(lr.writes.filter((w) => w.uuid === JPG).map((w) => w.name).slice(0, 2)).toEqual(["AVG S10 range 1/4", "AVG S10 range 2/4"]);
    expect(((writes[1] as J)["white_balance"] as J)["jim"]).toEqual({ panel_custom: true, temp_slider: true });
    expect(((writes[1] as J)["profiles"] as J)["pairs"]).toHaveLength(5);
    expect((jpg["white_balance"] as J)["jim"]).toBeUndefined();
    expect(results["copies"]).toMatchObject({ run: false, summary: expect.stringContaining("is raw, not rendered") });
    expect(said).toContain("  DSC_0031.JPG: PUT BACK YES");
  });

  it("puts a starting photo outside the collection back, and fails when the bridge stays down", async () => {
    lr.library.photos.push({ uuid: "SIM-OUT", local_id: 6, filename: "elsewhere.NEF", rating: 0, keywords: [], day: "2026-10-09", gps: null, file_format: "RAW", settings: structuredClone(nefDump.settings) });
    lr.selected = "SIM-OUT";
    const { results } = await run([]);
    expect(results["selection_restored"]).toEqual({ uuid: "SIM-OUT", photo: null, ok: true });
    expect(lr.selected).toBe("SIM-OUT");
    expect(sent("select_photo").at(-1)).toEqual({ uuid: "SIM-OUT" });
    // A bridge that does not come back is a FAILED check, not a WORKED one with the copies and exports skipped.
    const stuck = { deps: { client: { waitConnected: () => Promise.reject(new Error("still down")) }, reconnectWaitMs: 10 }, results: {}, errors: [] as string[], fail: (m: string) => void stuckErrors.push(m) };
    const stuckErrors: string[] = [];
    const { ensureConnected } = await import("../src/devtools/s10-config.js");
    expect(await ensureConnected(stuck as unknown as Parameters<typeof ensureConnected>[0], "the exports")).toBe(false);
    expect(stuckErrors).toEqual([expect.stringContaining("did not come back within 0.01 s for the exports")]);
  });

  it("makes the copies of the selected rendered original and reads each back as the master", async () => {
    lr.selected = JPG;
    const { results } = await run([]);
    // The sim's copies come from its master only (lightroom-sim-catalog.ts), so it refuses another photo as Lightroom refuses a virtual copy; the refusal is recorded, not an error.
    expect(sent("create_virtual_copies")).toEqual([{ target_uuid: JPG, names: [...COPY_NAMES] }]);
    expect(results["copies"]).toMatchObject({ run: true, master: "DSC_0031.JPG", error: { code: "BAD_TARGET" }, maybe_made: [] });
    expect(results["errors"]).toEqual([]);
  });

  it("--fixtures: makes the collection when missing and adds the originals of the named files and every S10- file", async () => {
    lr.library.collections.pop();
    lr.library.photos.push({ uuid: "SIM-S10-TIF", local_id: 5, filename: "S10-tiff32.tif", rating: 0, keywords: [], day: "2026-10-09", gps: null, file_format: "TIFF", settings: structuredClone(rendered.settings) });
    const { worked, results } = await run([], { fixtures: true });
    expect(worked).toBe(true);
    expect(sent("create_collection")).toEqual([{ name: COLLECTION, set_path: [] }]);
    expect(sent("collection_photos")).toEqual([{ collection_id: expect.any(Number), uuids: [JPG, lr.uuid, "SIM-S10-TIF"], remove: false }]);
    expect(results["fixtures"]).toMatchObject({ created: true, added: [JPG, lr.uuid, "SIM-S10-TIF"], already_in: [], in_collection: 3, missing: expect.arrayContaining(["IMG_1595.JPG", "IMG_0027.HEIC"]) });
    expect((results["census"] as J)["pipelines"]).toEqual({ raw: 1, rendered: 2, unknown: 0 });
    expect(sent("apply_settings")).toEqual([]);
    expect(results).not.toHaveProperty("writes");
  });

  it("fails without writing when the collection is missing", async () => {
    lr.library.collections.pop();
    const { worked, results } = await run([]);
    expect(worked).toBe(false);
    expect(results["errors"]).toEqual([expect.stringContaining(`no collection named "${COLLECTION}"`)]);
    expect(sent("apply_settings")).toEqual([]);
    expect(results["summary"]).toMatchObject({ suggestion: "FAILED", census: null });
    expect(said).toContain("  Writes: not run (nothing was written)");
  });

  it("records a failed write and still puts the photo back", async () => {
    const apply = plugin.handlers.get("apply_settings") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("apply_settings", (p, id) => (String(p["history_name"]).includes("wb") ? { ok: false, error: { code: "apply_failed", message: "simulated", recoverable: false } } : apply(p, id)));
    const { worked, results } = await run(["y", "y"]);
    expect(worked).toBe(true);
    for (const w of results["writes"] as J[]) {
      expect(w["white_balance"]).toMatchObject({ error: { code: "APPLY_FAILED" }, written: expect.any(Object) });
      expect(w["put_back"]).toMatchObject({ ok: true });
    }
    expect(jpgSettings()).toEqual(rendered.settings);
    expect(lr.settings).toEqual(nefDump.settings);
  });
});
