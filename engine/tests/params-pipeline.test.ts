// The pipeline in the params map (Phase 8 row 3, params\pipeline.ts and map.ts): read from a photo's
// settings, per-pipeline white balance, profiles per pipeline, process versions 15.4 and 11.0. The
// settings are live dumps: the S5 NEF and spike S10's census of DSC_0031.JPG (both originals of that name).

import { describe, expect, it } from "vitest";
import { differingSettings, loadDefaultParamMap, pipelineOf, type SdkSettings } from "../src/params/index.js";
import { nefDump } from "./helpers/lightroom-sim.js";
import { renderedDumps } from "./helpers/lightroom-sim-rendered.js";

const map = loadDefaultParamMap();
const nef = nefDump.settings;
const jpg = renderedDumps["15.4"].settings;
const jpgPv11 = renderedDumps["11.0"].settings;
const RAW = { processVersion: "15.4", pipeline: "raw" } as const;
const RENDERED = { processVersion: "15.4", pipeline: "rendered" } as const;

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as { code?: string }).code;
  }
  return undefined;
}

describe("params: the pipeline", () => {
  it("reads it from the settings: Kelvin temperature is raw; the relative one with Embedded is rendered", () => {
    expect(pipelineOf(nef).pipeline).toBe("raw");
    expect(pipelineOf(jpg)).toEqual({ pipeline: "rendered", signals: { kelvin_temperature: false, incremental_temperature: true, camera_profile: "Embedded" } });
    // Raw DNGs also take "Embedded" (S10 run 2): still raw.
    expect(pipelineOf({ ...nef, CameraProfile: "Embedded" }).pipeline).toBe("raw");
  });

  it("refuses settings that match neither pipeline, naming the signals (PIPELINE_UNKNOWN)", () => {
    for (const odd of [{ ...jpg, Temperature: 5000 }, { ...jpg, CameraProfile: "Adobe Standard" }, Object.fromEntries(Object.entries(jpg).filter(([k]) => k !== "IncrementalTemperature"))]) {
      expect(pipelineOf(odd).pipeline).toBe("unknown");
      expect(codeOf(() => map.fromSdk(odd))).toBe("pipeline_unknown");
    }
    expect(() => map.fromSdk({ ...jpg, Temperature: 5000 })).toThrow(/Temperature present, IncrementalTemperature present, CameraProfile "Embedded"/);
  });

  it("reads a rendered photo: relative white balance, its profile, no unpinned white balance key", () => {
    const view = map.fromSdk(jpg);
    expect(view).toMatchObject({ pipeline: "rendered", process_version: "15.4", camera_profile: { name: "Color", camera_profile: "Embedded" } });
    expect(view.settings).toMatchObject({ temperature: jpg["IncrementalTemperature"], tint: jpg["IncrementalTint"], camera_profile: "Color" });
    expect(view.unpinned_keys).not.toContain("IncrementalTemperature");
    // Monochrome is the same pair with ConvertToGrayscale true (S10): fromSdk passes it to identify().
    expect(map.fromSdk({ ...jpg, ConvertToGrayscale: true }).camera_profile.name).toBe("Monochrome");
  });

  it("does not name a profile of the other pipeline: a raw DNG set to Embedded has no pinned name", () => {
    const view = map.fromSdk({ ...nef, CameraProfile: "Embedded", Look: [] });
    expect(view.pipeline).toBe("raw");
    expect(view.camera_profile).toMatchObject({ name: null, camera_profile: "Embedded" });
    expect(view.settings).not.toHaveProperty("camera_profile");
  });

  it("maps temperature and tint per pipeline: Kelvin on raw, -100..100 relative on rendered, both with Custom", () => {
    expect(map.toSdk({ temperature: 5200, tint: 10 }, RAW)).toEqual({ Temperature: 5200, Tint: 10, WhiteBalance: "Custom" });
    expect(map.toSdk({ temperature: 20, tint: -5 }, RENDERED)).toEqual({ IncrementalTemperature: 20, IncrementalTint: -5, WhiteBalance: "Custom" });
    expect(codeOf(() => map.toSdk({ temperature: 101 }, RENDERED))).toBe("out_of_range");
    expect(codeOf(() => map.toSdk({ temperature: 5200 }, RENDERED))).toBe("out_of_range");
    expect(codeOf(() => map.toSdk({ temperature: 20 }, RAW))).toBe("out_of_range");
    expect(map.spec("temperature", "rendered")).toMatchObject({ sdkKey: "IncrementalTemperature", min: -100, max: 100 });
    // Every other slider is the same on both.
    for (const name of map.names().filter((n) => n !== "temperature" && n !== "tint" && n !== "camera_profile")) {
      expect(map.spec(name, "rendered"), name).toEqual(map.spec(name, "raw"));
    }
  });

  it("refuses a profile of the other pipeline before anything is written (WRONG_PIPELINE)", () => {
    expect(codeOf(() => map.toSdk({ camera_profile: "Adobe Color" }, RENDERED))).toBe("wrong_pipeline");
    expect(codeOf(() => map.toSdk({ camera_profile: "Color" }, RAW))).toBe("wrong_pipeline");
    expect(() => map.toSdk({ camera_profile: "Adobe Color" }, RENDERED)).toThrow(/its profiles: Color, Monochrome/);
    expect(map.toSdk({ camera_profile: "Monochrome" }, RENDERED)).toEqual({ CameraProfile: "Embedded", Look: {}, ConvertToGrayscale: true });
  });

  it("supports process version 11.0 (Version 5) as 15.4, and names both in a refusal", () => {
    expect(map.fromSdk(jpgPv11)).toMatchObject({ process_version: "11.0", pipeline: "rendered" });
    expect(map.toSdk({ exposure: 0.5 }, { processVersion: "11.0", pipeline: "rendered" })).toEqual({ Exposure2012: 0.5 });
    expect(map.fromSdk({ ...nef, ProcessVersion: "11.0" }).process_version).toBe("11.0");
    expect(() => map.fromSdk({ ...jpg, ProcessVersion: "6.7" })).toThrow(/supported: 15\.4 \(Version 6\), 11\.0 \(Version 5\)/);
    expect(codeOf(() => map.fromSdk({ ...jpg, ProcessVersion: "6.7" }))).toBe("unsupported_process_version");
    expect(codeOf(() => map.fromSdk({ ...jpg, ProcessVersion: "16.0" }))).toBe("newer_process_version");
  });

  // Row-2 finding 2: S10's put-backs read Lightroom's own stamps back (default Look.Parameters blocks
  // dropped or added, RemoveAreas[*].IngestInfo re-hashed) [handle: docs\reports\phase8\S10.md "Observed"].
  // The engine compares canonical settings and the mask table, which carry neither.
  it("compares photos without Lightroom's stamps: Look parameters and RemoveAreas do not count", () => {
    const look = map.cameraProfiles().toSdk("Adobe Color").Look;
    const before: SdkSettings = { ...nef, CameraProfile: "Adobe Standard", Look: look, RemoveAreas: [{ IngestInfo: "a" }] };
    const stamped: SdkSettings = {
      ...before,
      Look: { ...look, Parameters: { ...(look["Parameters"] as object), LensBlur: { Active: false }, Version: "18.7" } },
      RemoveAreas: [{ IngestInfo: "b" }],
    };
    const [a, b] = [map.fromSdk(before), map.fromSdk(stamped)];
    expect(differingSettings(a.settings, b.settings)).toEqual([]);
    expect(b.masks.fingerprint).toBe(a.masks.fingerprint);
  });
});
