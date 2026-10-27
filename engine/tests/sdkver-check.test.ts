// `npm run sdkver:check` (devtools\sdkver-check.ts, sdkver-diff.ts; GitHub issue #209). The diff logic runs on
// generated runs. The steps run against the simulated plugin, whose hello is made to declare another version and
// whose photo is made to lose or gain a key between the runs: that shows the harness works, not what Lightroom
// does with the declared version.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BridgeClient, type HelloResult } from "../src/bridge/index.js";
import { COLLECTION, type Photo } from "../src/devtools/s10-config.js";
import { readRuns, runSdkverCheck } from "../src/devtools/sdkver-check.js";
import { buildRun, compareRuns, digest, fmtSdk, labelNotes, newVsPinned, parseInfoLua, pickPrevious, type Run } from "../src/devtools/sdkver-diff.js";
import { BridgeGate } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { FakePlugin } from "./helpers/fake-plugin.js";
import { LightroomSim } from "./helpers/lightroom-sim.js";

const hello = (declared: number, lrc = "15.6"): HelloResult => ({ protocol: 1, plugin_version: "1.3.0", lrc_version: lrc, sdk_declared: declared, ports: { receive: 1, send: 2 }, process_started_at: `p${declared}` });
type Spec = { uuid: string; filename: string; settings: Record<string, unknown>; extra?: string[] };
const runOf = (declared: number, specs: Spec[], at = "2026-10-26T10:00:00Z", lrc = "15.6"): Run =>
  buildRun(hello(declared, lrc), specs.map((s) => ({ uuid: s.uuid, filename: s.filename, copy_name: null, start: s.settings, extra_keys: s.extra ?? [] }) as unknown as Photo), at);
const BASE = { Exposure2012: 0.5, Dehaze: 0, ToneCurvePV2012: [0, 0, 255, 255], CameraProfile: "Adobe Color" };

describe("sdkver: Info.lua", () => {
  const info = "-- LrSdkVersion 13.0: the spike plugins ran with it.\n-- LrSdkVersion = 9.0,\nreturn {\n    LrSdkVersion = 14.3,\n    LrSdkMinimumVersion = 13.0,\n    LrToolkitIdentifier = 'x',\n}\n";
  it("reads the two version lines and skips comments", () => {
    expect(parseInfoLua(info)).toEqual({ sdk: 14.3, min: 13 });
    expect(parseInfoLua("return { LrToolkitIdentifier = 'x' }")).toEqual({ sdk: null, min: null });
    expect(parseInfoLua("return {\n    LrSdkVersion = 13,\n}")).toEqual({ sdk: 13, min: null });
  });

  it("keeps Bridge.lua's SDK_DECLARED equal to Info.lua's LrSdkVersion: hello reports the first, and it labels every sdkver run", () => {
    const plugin = fileURLToPath(new URL("../../plugin/LrC-AVG.lrplugin/", import.meta.url));
    const declared = Number(/^\s*Bridge\.SDK_DECLARED\s*=\s*(\d+(?:\.\d+)?)/m.exec(readFileSync(path.join(plugin, "Bridge.lua"), "utf8"))?.[1]);
    expect(declared, "Bridge.lua SDK_DECLARED must be changed with Info.lua LrSdkVersion").toBe(parseInfoLua(readFileSync(path.join(plugin, "Info.lua"), "utf8")).sdk);
  });

  it("writes 13 as 13.0 and keeps 14.3", () => {
    expect([fmtSdk(13), fmtSdk(14.3), fmtSdk(15)]).toEqual(["13.0", "14.3", "15.0"]);
  });

  it("notes a plugin that does not declare what this repo's Info.lua does, and says nothing when they agree", () => {
    expect(labelNotes(14.3, { path: "Info.lua", text: info })).toEqual([]);
    expect(labelNotes(13, { path: "Info.lua", text: info })).toEqual([expect.stringContaining("declares 13.0, but Info.lua declares 14.3")]);
    expect(labelNotes(13, { path: "Info.lua", text: "return {}" })).toEqual(["Info.lua has no LrSdkVersion line."]);
    expect(labelNotes(13, null)).toEqual([expect.stringContaining("no Info.lua beside this command")]);
  });
});

describe("sdkver: comparing two runs", () => {
  const photos = (extra: Record<string, unknown> = {}): Spec[] => [
    { uuid: "U1", filename: "a.NEF", settings: { ...BASE, ...extra } },
    { uuid: "U2", filename: "b.JPG", settings: { Exposure2012: 0.5, IncrementalTemperature: 0 } },
  ];

  it("finds the same keys under two declared versions, and puts the lower version first whichever run is given first", () => {
    const c = compareRuns(runOf(14.3, photos()), runOf(13, photos()));
    expect(c).toMatchObject({ a: { declared: "13.0" }, b: { declared: "14.3" }, photos_compared: 2, only_a: [], only_b: [], type_changed: [], values_changed: 0, same_lrc_version: true });
    expect(c.suggestion).toBe("the same keys, with the same types, under 13.0 and 14.3 on 2 photos: the declared version hid none of them.");
  });

  it("lists the keys one run lacks, per photo and in total, and the keys whose type changed", () => {
    const newer = runOf(14.3, [{ uuid: "U1", filename: "a.NEF", settings: { ...BASE, ExtendedToneCurvePV2012: [0, 0, 255, 255], Dehaze: "0" } }, photos()[1] as Spec]);
    const older = runOf(13, [{ uuid: "U1", filename: "a.NEF", settings: { ...BASE, Sharpness: 25 } }, photos()[1] as Spec]);
    const c = compareRuns(older, newer);
    expect(c.only_a).toEqual(["Sharpness"]);
    expect(c.only_b).toEqual(["ExtendedToneCurvePV2012"]);
    expect(c.type_changed).toEqual(["Dehaze (number -> string)"]);
    expect(c.per_photo.map((p) => [p.label, p.only_a, p.only_b])).toEqual([["a.NEF", ["Sharpness"], ["ExtendedToneCurvePV2012"]], ["b.JPG", [], []]]);
    expect(c.suggestion).toContain("the key sets differ between 13.0 and 14.3 on 2 photos: 1 only under 13.0, 1 only under 14.3, 1 with another type.");
  });

  it("counts values that differ on shared keys and says the photo may have been edited", () => {
    const c = compareRuns(runOf(13, photos()), runOf(14.3, photos({ Exposure2012: 1.5, ToneCurvePV2012: [0, 0, 128, 140, 255, 255] })));
    expect(c.values_changed).toBe(2);
    expect(c.per_photo[0]?.value_changed).toEqual(["Exposure2012", "ToneCurvePV2012"]);
    expect(c.suggestion).toContain("2 values on shared keys differ: a photo may have been edited between the runs.");
  });

  it("names the photos only one run read, and a Lightroom that differs", () => {
    const c = compareRuns(runOf(13, photos(), "2026-10-26T10:00:00Z", "15.5.1"), runOf(14.3, [photos()[0] as Spec, { uuid: "U3", filename: "c.DNG", settings: BASE }]));
    expect(c).toMatchObject({ photos_compared: 1, photos_only_a: ["b.JPG"], photos_only_b: ["c.DNG"], same_lrc_version: false });
    expect(c.suggestion).toContain("Lightroom differs between the runs (15.5.1, 15.6).");
    expect(compareRuns(runOf(13, [photos()[0] as Spec]), runOf(14.3, [photos()[1] as Spec])).suggestion).toBe("no photo is in both runs: nothing was compared");
  });

  it("hashes a table the same whatever its key order, and keeps array order (Greptile, PR #223)", () => {
    expect(digest({ a: 1, b: { c: [1, 2], d: 2 } })).toBe(digest({ b: { d: 2, c: [1, 2] }, a: 1 }));
    expect(digest([1, 2])).not.toBe(digest([2, 1]));
  });

  it("lists the keys new against the pinned file once, over all the photos", () => {
    expect(newVsPinned(runOf(13, [{ ...photos()[0] as Spec, extra: ["NewB", "NewA"] }, { ...photos()[1] as Spec, extra: ["NewA"] }]))).toEqual(["NewA", "NewB"]);
  });

  it("picks the newest run that declared another version, preferring the same Lightroom", () => {
    const current = runOf(14.3, photos(), "2026-10-27T10:00:00Z");
    const old = runOf(13, photos(), "2026-10-25T10:00:00Z");
    const newer = runOf(13, photos(), "2026-10-26T10:00:00Z");
    const otherLr = runOf(13, photos(), "2026-10-26T12:00:00Z", "15.5.1");
    expect(pickPrevious([old, newer, current], current)).toBe(newer);
    expect(pickPrevious([old, otherLr, newer], current)).toBe(newer);
    expect(pickPrevious([otherLr], current)).toBe(otherLr);
    expect(pickPrevious([current], current)).toBeNull();
    expect(pickPrevious([], current)).toBeNull();
  });
});

describe("npm run sdkver:check against the simulated plugin", () => {
  let tmp = "";
  let plugin: FakePlugin;
  let lr: LightroomSim;
  let client: BridgeClient;
  const said: string[] = [];
  const hidden = "Sharpness";

  beforeEach(async () => {
    tmp = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-sdkver-"));
    mkdirSync(path.join(tmp, "previews"));
    plugin = await FakePlugin.start();
    lr = new LightroomSim(path.join(tmp, "previews"));
    lr.library.collections.push({ local_id: 503, name: COLLECTION, smart: false, photos: [lr.uuid] });
    lr.install(plugin);
    said.length = 0;
  });
  afterEach(async () => {
    client?.stop();
    await plugin.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  /** The plugin declaring `declared` from now on, as a reloaded plugin with another Info.lua does. */
  function declare(declared: number): void {
    const orig = plugin.handlers.get("hello") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("hello", async (p, id) => {
      const r = await orig(p, id);
      return r === "silent" || !r.ok ? r : { ok: true, payload: { ...(r.payload as object), sdk_declared: declared, process_started_at: `reload-${declared}` } };
    });
  }

  function run(n: number, previous: Run[], info: { path: string; text: string } | null = null) {
    client = new BridgeClient({ commandPort: plugin.commandPort, eventPort: plugin.eventPort, connectGapMs: 5, reconnectMs: 30, readToken: () => plugin.token });
    const gate = new BridgeGate(client, async () => ({ ok: true, lock: { port: 8767, release: async () => {} } }), { waitMs: 2000 });
    return runSdkverCheck({ client, gate, map: loadDefaultParamMap(), say: (l) => said.push(l), stamp: `run${n}`, dumpDir: path.join(tmp, `dumps${n}`), previewDir: path.join(tmp, "previews"), connectTimeoutMs: 2000, info, previous, now: () => new Date(Date.UTC(2026, 9, 26, 10 + n)) });
  }

  it("run 1 saves the keys under the declared version and compares nothing; run 2 under another version diffs them", async () => {
    expect(lr.settings).toHaveProperty(hidden);
    const first = await run(1, []);
    expect(first.worked).toBe(true);
    expect(first.results).toMatchObject({ headline: "WORKED", comparison: null, errors: [], run: { declared: 13, lrc_version: "15.5.1", photos: [{ filename: "20260907-_OZ80093.NEF" }] } });
    expect(said).toContain("This is run 1 (declared 13.0). Run 2 comes after the plug-in declares another version and is reloaded (spikes\\SDKVER\\README.md).");
    expect(said.at(-1)).toBe("SDKVER: WORKED");

    declare(14.3);
    delete lr.settings[hidden];
    lr.settings["BrandNewKey"] = 1;
    said.length = 0;
    const second = await run(2, [first.results["run"] as Run], { path: "Info.lua", text: "return {\n    LrSdkVersion = 14.3,\n}" });
    expect(second.worked).toBe(true);
    expect(second.results).toMatchObject({ run: { declared: 14.3 }, notes: [], new_vs_pinned: ["BrandNewKey"], comparison: { a: { declared: "13.0" }, b: { declared: "14.3" }, only_a: [hidden], only_b: ["BrandNewKey"], photos_compared: 1 } });
    expect(said).toContain(`  keys only under 13.0: ${hidden}`);
    expect(said).toContain("  keys only under 14.3: BrandNewKey");
    expect(said.some((l) => l.startsWith("Suggestion (the verdict is Jim's): the key sets differ between 13.0 and 14.3 on 1 photo:"))).toBe(true);
    // Read only: nothing selected, nothing written.
    for (const name of ["apply_settings", "select_photo", "create_snapshot"]) expect(plugin.received.filter((r) => r.name === name)).toEqual([]);
  });

  it("run 2 with the same keys says the declared version hid none; a second run at the same version compares nothing", async () => {
    const first = await run(1, []);
    declare(14.3);
    const second = await run(2, [first.results["run"] as Run]);
    expect(second.results["comparison"]).toMatchObject({ only_a: [], only_b: [], suggestion: "the same keys, with the same types, under 13.0 and 14.3 on 1 photo: the declared version hid none of them." });
    said.length = 0;
    const third = await run(3, [first.results["run"] as Run, second.results["run"] as Run]);
    expect(third.results["comparison"]).not.toBeNull(); // 14.3 against the earlier 13.0
    const again = await run(4, [second.results["run"] as Run]);
    expect(again.results["comparison"]).toBeNull();
    expect(said).toContain("Every earlier run declared 14.3 too, so nothing is compared. Run 2 needs the plug-in to declare another version: reload it after the new Info.lua is in place.");
  });

  it("notes a plugin whose declared version is not this repo's Info.lua", async () => {
    const { results } = await run(1, [], { path: "Info.lua", text: "return {\n    LrSdkVersion = 14.3,\n}" });
    expect(results["notes"]).toEqual([expect.stringContaining("the loaded plugin declares 13.0, but Info.lua declares 14.3")]);
    expect(said.some((l) => l.startsWith("NOTE: the loaded plugin declares 13.0"))).toBe(true);
  });

  it("FAILED, with the reason, when the collection is missing", async () => {
    lr.library.collections.length = 0;
    const { worked, results } = await run(1, []);
    expect(worked).toBe(false);
    expect(results).toMatchObject({ headline: "FAILED", errors: [expect.stringContaining(`no collection named "${COLLECTION}"`)] });
    expect(results).not.toHaveProperty("run");
    expect(said.at(-1)).toBe("SDKVER: FAILED");
  });

  it("FAILED, and no run kept, when a photo could not be read (Greptile, PR #223)", async () => {
    // A second photo in the collection that the simulated plugin cannot read; the first still reads.
    lr.library.photos.push({ uuid: "unreadable", local_id: 2999, filename: "gone.NEF", rating: 0, keywords: [], day: "2026-10-26", gps: null });
    lr.library.collections.find((c) => c.name === COLLECTION)?.photos.push("unreadable");
    const orig = plugin.handlers.get("get_settings") as NonNullable<ReturnType<typeof plugin.handlers.get>>;
    plugin.handlers.set("get_settings", async (p, id) => ((p as { photo_uuid?: string }).photo_uuid === "unreadable"
      ? { ok: false, error: { code: "photo_not_found", message: "no photo", recoverable: false } }
      : orig(p, id)));
    const { worked, results } = await run(1, []);
    expect(said.some((l) => l.includes("gone.NEF"))).toBe(true);
    expect(worked).toBe(false);
    expect(results).not.toHaveProperty("run");
    expect(results["errors"]).toEqual([expect.stringContaining("1 photo could not be read, so this run is not kept")]);
  });

  it("readRuns reads the runs a saved results file holds and skips anything else", async () => {
    const first = await run(1, []);
    writeFileSync(path.join(tmp, "sdkver_13.0_2026.json"), JSON.stringify(first.results));
    writeFileSync(path.join(tmp, "sdkver_failed_2026.json"), JSON.stringify({ check: "sdkver", errors: ["x"] }));
    writeFileSync(path.join(tmp, "sdkver_broken.json"), "{ not json");
    writeFileSync(path.join(tmp, "sdkver_bridge_log_2026.txt"), "log");
    expect(readRuns(tmp)).toEqual([first.results["run"]]);
    expect(readRuns(path.join(tmp, "missing"))).toEqual([]);
  });
});
