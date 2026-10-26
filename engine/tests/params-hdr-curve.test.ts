// Issue #187: on a photo in HDR edit mode (HDREditMode 1) the point curves are the ExtendedToneCurvePV2012
// keys (params\canonical.ts "Point curves"). The map unit-tested on the HDR DNG's live dump, then a session
// step against the simulated Lightroom that, like that photo, does not take ToneCurvePV2012
// [handle: docs\reports\phase10\curve-probe\run2\curve_probe_2026-10-26T03-06-50-864Z.json photo.profile_sweep].

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { loadDefaultParamMap, sdkKeysOf } from "../src/params/index.js";
import { ID, clean, fails, lr, manager, plugin, readLog, useSessionHarness } from "./helpers/session-harness.js";

type J = Record<string, unknown>;
const STEP_187 = { "tone_curve.master": [0, 0, 64, 56, 128, 128, 192, 200, 255, 255], vibrance: 7 };
const LINEAR = [0, 0, 255, 255];
const EXTENDED = ["ExtendedToneCurvePV2012", "ExtendedToneCurvePV2012Red", "ExtendedToneCurvePV2012Green", "ExtendedToneCurvePV2012Blue"];
const hdrDump = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../docs/reports/phase10/curve-probe/run2/curve_probe_settings_20220828-_DSC1159-HDR.dng__65937445.json", import.meta.url)), "utf8"),
) as { settings: J };

describe("params: point curves in HDR edit mode (issue #187)", () => {
  const map = loadDefaultParamMap();
  const RAW = { processVersion: "15.4", pipeline: "raw" } as const;

  it("writes tone_curve.* to the extended keys with hdr, to ToneCurvePV2012* without", () => {
    const curves = { "tone_curve.master": LINEAR, "tone_curve.red": LINEAR, "tone_curve.green": LINEAR, "tone_curve.blue": LINEAR };
    expect(Object.keys(map.toSdk(curves, { ...RAW, hdr: true }))).toEqual(EXTENDED);
    expect(Object.keys(map.toSdk(curves, RAW))).toEqual(["ToneCurvePV2012", "ToneCurvePV2012Red", "ToneCurvePV2012Green", "ToneCurvePV2012Blue"]);
    expect(map.toSdk({ exposure: 0.5 }, { ...RAW, hdr: true })).toEqual({ Exposure2012: 0.5 }); // only the curves move
  });

  it("reads the HDR DNG's live dump as hdr, its curves from the extended keys", () => {
    const sdk = { ...hdrDump.settings, ExtendedToneCurvePV2012: [0, 0, 128, 160, 255, 255] };
    const view = map.fromSdk(sdk);
    expect(view).toMatchObject({ pipeline: "raw", hdr: true });
    expect(view.settings["tone_curve.master"]).toEqual([0, 0, 128, 160, 255, 255]);
    expect(view.unpinned_keys).toEqual([]); // the raw pin took this dump (LensProfileFilename too)
    expect(map.fromSdk({ ...sdk, HDREditMode: 0 }).settings["tone_curve.master"]).toEqual(LINEAR); // SDR: ToneCurvePV2012
  });

  it("names the slider for an extended key too (FEATURE_UNAVAILABLE labels)", () => {
    expect(sdkKeysOf(map, "tone_curve.master", "raw", true)).toEqual(["ExtendedToneCurvePV2012"]);
    expect(sdkKeysOf(map, "tone_curve.master")).toEqual(["ToneCurvePV2012"]);
    expect(map.sdkKey("tone_curve.red", "rendered", true)).toBe("ExtendedToneCurvePV2012Red");
  });
});

describe("session: a tone curve step on an HDR-mode photo (issue #187)", () => {
  useSessionHarness("raw");
  beforeEach(() => clean());

  const makeHdr = (): void => {
    lr.settings["HDREditMode"] = 1;
    lr.settings["HDRMaxValue"] = 2.3;
    for (const k of EXTENDED) lr.settings[k] = [...LINEAR];
    lr.ignored.add("ToneCurvePV2012"); // refused there under every profile, like the HDR DNG
  };
  const writes = (): J[] => plugin.received.filter((r) => r.name === "apply_settings").map((r) => r.payload["settings"] as J);

  it("writes issue #187's step to ExtendedToneCurvePV2012, which is taken and read back", async () => {
    makeHdr();
    await manager.begin({ intent_id: "test_plain", max_passes: 4 });
    const out = await manager.step({ session_id: ID, settings: STEP_187, rationale: "#187" });
    expect(out.json).toMatchObject({ pass: "1/4" });
    expect(writes().at(-1)).toMatchObject({ ExtendedToneCurvePV2012: STEP_187["tone_curve.master"] });
    expect(writes().some((w) => "ToneCurvePV2012" in w)).toBe(false);
    expect(lr.settings["ExtendedToneCurvePV2012"]).toEqual(STEP_187["tone_curve.master"]);
    expect(readLog().passes.at(-1)?.settings_after["tone_curve.master"]).toEqual(STEP_187["tone_curve.master"]);
  });

  it("follows the photo into HDR edit mode switched on after the session began", async () => {
    await manager.begin({ intent_id: "test_plain", max_passes: 4 });
    makeHdr();
    await manager.step({ session_id: ID, settings: STEP_187, rationale: "#187" });
    expect(writes().at(-1)).toHaveProperty("ExtendedToneCurvePV2012");
  });

  it("leaves an SDR photo on ToneCurvePV2012", async () => {
    expect(lr.settings["HDREditMode"]).toBe(0);
    await manager.begin({ intent_id: "test_plain", max_passes: 4 });
    await manager.step({ session_id: ID, settings: STEP_187, rationale: "#187" });
    expect(writes().at(-1)).toMatchObject({ ToneCurvePV2012: STEP_187["tone_curve.master"] });
    expect(writes().some((w) => EXTENDED.some((k) => k in w))).toBe(false);
  });

  it("still undoes a refused extended curve whole", async () => {
    makeHdr();
    lr.ignored.add("ExtendedToneCurvePV2012");
    await manager.begin({ intent_id: "test_plain", max_passes: 4 });
    const before = structuredClone(lr.settings);
    const e = await fails(manager.step({ session_id: ID, settings: STEP_187, rationale: "#187" }));
    expect(e.code).toBe("WRITE_NOT_TAKEN");
    expect(e.message).toMatch(/ExtendedToneCurvePV2012/);
    expect(e.details).toMatchObject({ undone: true });
    expect(lr.settings).toEqual(before);
  });
});
