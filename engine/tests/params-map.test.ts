// The canonical parameter map over the pinned LrC 15.5.1 files (ARCHITECTURE section 5, PRD FR-4.2).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_PARAMS, PROBED_CLAMP, type ParamSpec } from "../src/params/canonical.js";
import { loadDefaultParamMap, ParamError, ParamMap, UnknownSdkKeyError } from "../src/params/index.js";
import { readCameraProfilesFile } from "../src/params/camera-profiles.js";
import { loadSdkKeys, readSdkKeysFile } from "../src/params/sdk-keys.js";

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));
const sdkKeys = readSdkKeysFile(here("../src/params/sdk-keys.lrc15.json"));
const profiles = readCameraProfilesFile(here("../src/params/camera-profiles.lrc15.json"));
// The live NEF dump S5 pinned the keys from (docs/reports/phase0/S5.md "Part 1 analysis").
const nefDump = JSON.parse(readFileSync(here("../../docs/reports/phase0/S5/s5_20260907-_OZ80093.NEF.json"), "utf8")) as {
  settings: Record<string, unknown>;
};
const PV = { processVersion: "15.4" };

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("params: canonical map", () => {
  const map = loadDefaultParamMap();

  it("maps every canonical name to a key of the pinned dump, with the pinned type", () => {
    const kinds: Record<ParamSpec["kind"], string> = { number: "number", switch: "number", boolean: "boolean", curve: "array" };
    for (const [name, spec] of CANONICAL_PARAMS) {
      expect(sdkKeys.has(spec.sdkKey), `${name} -> ${spec.sdkKey}`).toBe(true);
      expect(sdkKeys.get(spec.sdkKey).type, name).toBe(kinds[spec.kind]);
    }
  });

  it("sources every numeric range from the Phase 1 range probe (run 3)", () => {
    const numeric = [...CANONICAL_PARAMS].filter(([, spec]) => spec.kind === "number") as Array<[string, ParamSpec & { kind: "number" }]>;
    expect(numeric).toHaveLength(57);
    for (const [name, spec] of numeric) {
      expect(spec.rangeSource, name).toMatch(/^\[handle: docs\/reports\/phase1\/P1\/p1_check_2026-09-26T21-06-50-295Z\.json range_probe\]/);
    }
    // The four keys whose out-of-range values Lightroom clamped to exactly the limit.
    const clamped = numeric.filter(([, spec]) => spec.rangeSource === PROBED_CLAMP).map(([name]) => name).sort();
    expect(clamped).toEqual(["exposure", "sharpening.radius", "temperature", "tint"]);
  });

  it("matches every numeric range, and its clamp label, to the committed probe record", () => {
    // The run-3 results file cited in each rangeSource. A bound changed here without a new probe fails.
    const probe = JSON.parse(readFileSync(here("../../docs/reports/phase1/P1/p1_check_2026-09-26T21-06-50-295Z.json"), "utf8")) as {
      range_probe: {
        per_parameter: Array<{
          name: string;
          sdk_key: string;
          min: number;
          max: number;
          min_read: number;
          max_read: number;
          below_written: number;
          below_read: number;
          above_written: number;
          above_read: number;
        }>;
      };
    };
    const records = new Map(probe.range_probe.per_parameter.map((r) => [r.name, r]));
    const numeric = [...CANONICAL_PARAMS].filter(([, spec]) => spec.kind === "number") as Array<[string, ParamSpec & { kind: "number" }]>;
    expect(records.size).toBe(numeric.length);
    for (const [name, spec] of numeric) {
      const r = records.get(name);
      expect(r, name).toBeDefined();
      if (!r) continue;
      // The probe wrote exactly these bounds to exactly this key, and both read back as written.
      expect([r.sdk_key, r.min, r.max], name).toEqual([spec.sdkKey, spec.min, spec.max]);
      expect([r.min_read, r.max_read], name).toEqual([spec.min, spec.max]);
      // Beyond the bounds: clamped to exactly the limit (PROBED_CLAMP), or not taken at all.
      if (spec.rangeSource === PROBED_CLAMP) {
        expect([r.below_read, r.above_read], name).toEqual([spec.min, spec.max]);
      } else {
        expect(r.below_read, name).not.toBe(r.below_written);
        expect(r.above_read, name).not.toBe(r.above_written);
        expect(r.above_read, name).not.toBe(spec.max);
      }
    }
  });

  it("covers the FR-4.2 vocabulary", () => {
    const names = map.names();
    for (const n of [
      "exposure", "contrast", "highlights", "shadows", "whites", "blacks", "texture", "clarity", "dehaze",
      "vibrance", "saturation", "temperature", "tint", "hsl.orange.sat", "hsl.magenta.lum", "grading.midtones.hue",
      "sharpening.amount", "noise.luminance", "noise.color", "lens.profile_enable", "lens.ca_remove",
      "lens.corrections_enable", "camera_profile", "tone_curve.master",
    ]) {
      expect(names, n).toContain(n);
    }
    expect(names.filter((n) => n.startsWith("hsl."))).toHaveLength(24);
  });

  it("refuses to build over a key file that lacks a mapped key", () => {
    const pinned = JSON.parse(readFileSync(here("../src/params/sdk-keys.lrc15.json"), "utf8")) as { keys: Array<{ key: string }> };
    pinned.keys = pinned.keys.filter((k) => k.key !== "Dehaze");
    expect(() => new ParamMap(loadSdkKeys(pinned), profiles)).toThrow(UnknownSdkKeyError);
  });

  describe("toSdk", () => {
    it("writes each canonical value under its SDK key", () => {
      expect(map.toSdk({ exposure: 0.83, "hsl.orange.sat": 10, "lens.corrections_enable": false }, PV)).toEqual({
        Exposure2012: 0.83,
        SaturationAdjustmentOrange: 10,
        EnableLensCorrections: false,
      });
    });

    it("writes camera_profile as the (CameraProfile, Look) pair", () => {
      const sdk = map.toSdk({ camera_profile: "Camera Neutral" }, PV);
      expect(sdk).toEqual({ CameraProfile: "Camera Neutral", Look: {} });
    });

    it("accepts the range limits and rejects values beyond them", () => {
      expect(map.toSdk({ exposure: 5, contrast: -100, temperature: 2000 }, PV)).toBeTruthy();
      expect(codeOf(() => map.toSdk({ exposure: 5.01 }, PV))).toBe("out_of_range");
      expect(codeOf(() => map.toSdk({ "sharpening.radius": 0.4 }, PV))).toBe("out_of_range");
    });

    it("rejects unknown names, wrong types and non-finite numbers", () => {
      expect(codeOf(() => map.toSdk({ Exposure2012: 1 }, PV))).toBe("unknown_parameter");
      expect(codeOf(() => map.toSdk({ exposure: "1" }, PV))).toBe("wrong_type");
      expect(codeOf(() => map.toSdk({ exposure: Number.NaN }, PV))).toBe("wrong_type");
      expect(codeOf(() => map.toSdk({ "lens.profile_enable": true }, PV))).toBe("wrong_type");
      expect(codeOf(() => map.toSdk({ "lens.corrections_enable": 1 }, PV))).toBe("wrong_type");
      expect(codeOf(() => map.toSdk({ camera_profile: "Camera Toy" }, PV))).toBe("unknown_camera_profile");
    });

    it("validates point curves", () => {
      expect(map.toSdk({ "tone_curve.master": [0, 0, 128, 140, 255, 255] }, PV)).toEqual({
        ToneCurvePV2012: [0, 0, 128, 140, 255, 255],
      });
      expect(codeOf(() => map.toSdk({ "tone_curve.master": [0, 0] }, PV))).toBe("wrong_type");
      expect(codeOf(() => map.toSdk({ "tone_curve.master": [0, 0, 255] }, PV))).toBe("wrong_type");
      expect(codeOf(() => map.toSdk({ "tone_curve.master": [0, 0, 256, 255] }, PV))).toBe("out_of_range");
      expect(codeOf(() => map.toSdk({ "tone_curve.master": [0, 0, 128, 128, 128, 200] }, PV))).toBe("wrong_type");
    });

    it("refuses a process version that was not observed", () => {
      expect(codeOf(() => map.toSdk({ exposure: 0 }, { processVersion: "11.0" }))).toBe("unsupported_process_version");
    });

    it("throws ParamError with recoverable = false", () => {
      expect(() => map.toSdk({ nope: 1 }, PV)).toThrow(ParamError);
      expect(() => map.toSdk({ nope: 1 }, PV)).toThrow(expect.objectContaining({ recoverable: false, parameter: "nope" }));
    });
  });

  describe("fromSdk", () => {
    it("reads the live NEF dump", () => {
      const r = map.fromSdk(nefDump.settings);
      expect(r.process_version).toBe("15.4");
      expect(r.settings["exposure"]).toBe(0.33);
      expect(r.settings["lens.corrections_enable"]).toBe(true);
      expect(r.settings["camera_profile"]).toBe("Camera Neutral");
      expect(r.camera_profile.name).toBe("Camera Neutral");
      expect(r.unpinned_keys).toEqual([]);
    });

    it("reports keys that are not in the pinned dump instead of failing", () => {
      const r = map.fromSdk({ ...nefDump.settings, SomeFutureKey: 1 });
      expect(r.unpinned_keys).toEqual(["SomeFutureKey"]);
    });

    it("skips mapped keys the photo does not carry (monochrome drops some)", () => {
      const { Dehaze: _dropped, ...rest } = nefDump.settings;
      expect("dehaze" in map.fromSdk(rest).settings).toBe(false);
    });

    it("leaves camera_profile out when the pair is not pinned, and says why", () => {
      const r = map.fromSdk({ ...nefDump.settings, CameraProfile: "Camera Landscape", Look: profiles.toSdk("Adobe Color").Look });
      expect("camera_profile" in r.settings).toBe(false);
      expect(r.camera_profile).toMatchObject({ name: null, camera_profile: "Camera Landscape", look_name: "Adobe Color" });
    });

    it("refuses an unsupported process version and a wrong value type", () => {
      expect(codeOf(() => map.fromSdk({ ...nefDump.settings, ProcessVersion: "6.7" }))).toBe("unsupported_process_version");
      expect(codeOf(() => map.fromSdk({ ...nefDump.settings, Exposure2012: "0.33" }))).toBe("wrong_type");
    });

    it("round-trips through toSdk", () => {
      const { settings } = map.fromSdk(nefDump.settings);
      const sdk = map.toSdk(settings, PV);
      expect(map.verifyReadback(sdk, nefDump.settings)).toEqual([]);
    });
  });

  describe("verifyReadback", () => {
    it("passes a read-back equal to what was written", () => {
      const written = map.toSdk({ exposure: 0.83, camera_profile: "Adobe Landscape" }, PV);
      expect(map.verifyReadback(written, { ...written, Exposure2012: 0.8300000000000001 })).toEqual([]);
    });

    it("reports a value Lightroom did not take", () => {
      expect(map.verifyReadback({ Exposure2012: 0.83 }, { Exposure2012: 0.33 })).toEqual([
        { sdk_key: "Exposure2012", written: 0.83, read_back: 0.33 },
      ]);
      expect(map.verifyReadback({ CameraProfile: "Camera Landscape" }, {})).toEqual([
        { sdk_key: "CameraProfile", written: "Camera Landscape", read_back: null },
      ]);
    });

    it("treats Look = {} as taken when the Look reads back absent, [] or {}", () => {
      for (const readBack of [{}, { Look: [] }, { Look: {} }]) {
        expect(map.verifyReadback({ Look: {} }, readBack)).toEqual([]);
      }
      expect(map.verifyReadback({ Look: {} }, { Look: { Name: "Adobe Color" } })).toHaveLength(1);
    });

    it("compares Look tables deeply, with nested empty tables as [] or {}", () => {
      const look = profiles.toSdk("Adobe Landscape").Look;
      const params = look["Parameters"] as Record<string, unknown>;
      const readBack = { ...look, Parameters: { ...params, ToneCurvePV2012Blue: {} } };
      expect(map.verifyReadback({ Look: look }, { Look: readBack })).toEqual([]);
      const changed = { ...look, Parameters: { ...params, Clarity2012: 11 } };
      expect(map.verifyReadback({ Look: look }, { Look: changed })).toHaveLength(1);
    });

    it("reports a nested empty field that is missing, even when another key makes the counts equal", () => {
      const look = profiles.toSdk("Adobe Landscape").Look;
      const { ToneCurvePV2012Blue: _missing, ...params } = look["Parameters"] as Record<string, unknown>;
      expect(map.verifyReadback({ Look: look }, { Look: { ...look, Parameters: params } })).toHaveLength(1);
      const swapped = { ...look, Parameters: { ...params, SomethingElse: [] } };
      expect(map.verifyReadback({ Look: look }, { Look: swapped })).toHaveLength(1);
    });

    it("allows only the top-level Look to read back absent", () => {
      expect(map.verifyReadback({ Look: {} }, {})).toEqual([]);
      expect(map.verifyReadback({ ToneCurvePV2012Blue: [] }, {})).toEqual([
        { sdk_key: "ToneCurvePV2012Blue", written: [], read_back: null },
      ]);
    });
  });
});
