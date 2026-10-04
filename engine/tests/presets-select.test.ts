// Which settings go into a preset (presets\select.ts): the groups asked for, the keys Lightroom
// writes with them, and what Lightroom's own presets leave out, each named in left_out.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toToolError } from "../src/mcp/index.js";
import { loadDefaultParamMap } from "../src/params/index.js";
import { selectPresetSettings } from "../src/presets/index.js";
import { MASK_GROUPS } from "../src/sync/index.js";

const map = loadDefaultParamMap();
const fixture = (prefix: string): Record<string, unknown> =>
  (JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", "presets", `${prefix}-settings.lrc15.json`), "utf8")) as { settings: Record<string, unknown> }).settings;
const nef = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({ ...fixture("reference-2"), ...changes });
const keys = (sdk: Record<string, unknown>, groups: readonly (typeof MASK_GROUPS)[number][]) => selectPresetSettings(map, sdk, groups).entries.map((e) => e.key);
const leftOut = (sdk: Record<string, unknown>, groups: readonly (typeof MASK_GROUPS)[number][]) => selectPresetSettings(map, sdk, groups).left_out.map((l) => l.name);

describe("selectPresetSettings", () => {
  it("writes only the groups asked for, with the process version always", () => {
    expect(keys(nef(), ["hsl"])).toEqual(["ProcessVersion", ...["Red", "Orange", "Yellow", "Green", "Aqua", "Blue", "Purple", "Magenta"].flatMap((b) => [`HueAdjustment${b}`, `SaturationAdjustment${b}`, `LuminanceAdjustment${b}`])]);
    expect(leftOut(nef(), ["hsl"])).toEqual([]);
  });

  it("writes the white balance mode with white_balance, and temperature and tint only when it is not As Shot", () => {
    expect(keys(nef(), ["white_balance"])).toEqual(["ProcessVersion", "WhiteBalance"]);
    expect(leftOut(nef(), ["white_balance"])).toEqual(["temperature", "tint"]);
    const custom = nef({ WhiteBalance: "Custom", Temperature: 6100, Tint: -4 });
    expect(selectPresetSettings(map, custom, ["white_balance"]).entries).toEqual([
      { key: "ProcessVersion", value: "15.4" },
      { key: "WhiteBalance", value: "Custom" },
      { key: "Temperature", value: 6100 },
      { key: "Tint", value: -4 },
    ]);
  });

  it("names the photo's masks in left_out: a preset carries global settings only (GitHub issue #59)", () => {
    const masked = nef({ MaskGroupBasedCorrections: [{ What: "Correction", CorrectionID: "A", CorrectionMasks: [] }] });
    expect(leftOut(masked, ["hsl"])).toEqual(["masks"]);
    expect(keys(masked, ["hsl"])).toEqual(keys(nef(), ["hsl"]));
  });

  it("writes the point curve's name with tone_curve", () => {
    expect(keys(nef(), ["tone_curve"])).toEqual(["ProcessVersion", "ToneCurveName2012", "ToneCurvePV2012", "ToneCurvePV2012Red", "ToneCurvePV2012Green", "ToneCurvePV2012Blue"]);
  });

  it("leaves sharpening's radius, detail and masking out when its amount is 0, as Lightroom does", () => {
    expect(keys(nef(), ["detail"])).toContain("SharpenRadius");
    expect(keys(nef({ Sharpness: 0 }), ["detail"])).not.toContain("SharpenRadius");
    expect(leftOut(nef({ Sharpness: 0 }), ["detail"])).toEqual(["sharpening.radius", "sharpening.detail", "sharpening.masking"]);
  });

  it("never writes EnableLensCorrections, which neither of Lightroom's presets holds", () => {
    expect(keys(nef(), ["lens"])).toEqual(["ProcessVersion", "LensProfileEnable", "AutoLateralCA"]);
    expect(leftOut(nef(), ["lens"])).toEqual(["lens.corrections_enable"]);
  });

  it("writes a Nikon Camera Matching profile as CameraProfile, and leaves an Adobe profile out", () => {
    expect(selectPresetSettings(map, nef(), ["camera_profile"]).entries).toEqual([
      { key: "ProcessVersion", value: "15.4" },
      { key: "CameraProfile", value: "Camera Neutral" },
    ]);
    const adobe = selectPresetSettings(map, fixture("reference"), ["camera_profile"]);
    expect(adobe.written).toEqual([]);
    expect(adobe.left_out).toEqual([{ name: "camera_profile", reason: expect.stringMatching(/^an Adobe profile/) }]);
  });

  it("names a profile it cannot pin in left_out", () => {
    const out = selectPresetSettings(map, nef({ CameraProfile: "Someone's Profile" }), ["camera_profile"]);
    expect(out.left_out).toEqual([{ name: "camera_profile", reason: expect.stringContaining("Someone's Profile") }]);
  });

  it("covers every group by default in the tool, and writes every canonical name of those groups but the ones it names", () => {
    const out = selectPresetSettings(map, nef(), MASK_GROUPS);
    expect(out.written.length + out.left_out.length).toBe(map.names().length);
  });

  it("refuses an unsupported process version", () => {
    let error: unknown;
    try {
      selectPresetSettings(map, nef({ ProcessVersion: "6.7" }), MASK_GROUPS);
    } catch (err) {
      error = err;
    }
    expect(toToolError(error).code).toBe("LEGACY_PROCESS_VERSION");
  });
});
