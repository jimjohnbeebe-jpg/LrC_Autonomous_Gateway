// The rendered pipeline's pinned key dump, sdk-keys.lrc15.rendered.json: the 18 rendered photos of
// the "fixtures" collection as spike S10's census read them (Phase 8 row 2; docs/reports/phase8/S10.md),
// pinned with spikes/S5/pin.ts --out. Not loaded by the engine yet: row 3 builds the pipeline into the
// map. These tests keep the pin honest until then.

import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_PARAMS, RENDERED_WHITE_BALANCE } from "../src/params/canonical.js";
import { readSdkKeysFile } from "../src/params/sdk-keys.js";
import { readFileSync } from "node:fs";

const rawPath = fileURLToPath(new URL("../src/params/sdk-keys.lrc15.json", import.meta.url));
const renderedPath = fileURLToPath(new URL("../src/params/sdk-keys.lrc15.rendered.json", import.meta.url));

/** Raw-pin keys that no rendered photo carried [handle: S10 run 2 census.rendered.missing_pinned_in_all]. */
const RAW_ONLY = ["LensProfileDigest", "LensProfileDistortionScale", "LensProfileIsEmbedded", "LensProfileName", "LensProfileVignettingScale", "Look", "Temperature", "Tint"];

describe("params: the rendered pipeline's pinned key dump (S10)", () => {
  const rendered = readSdkKeysFile(renderedPath);
  const raw = readSdkKeysFile(rawPath);
  const file = JSON.parse(readFileSync(renderedPath, "utf8")) as { sources: Array<{ filename: string; process_version?: string; camera_profile?: string; lr_version?: string }> };

  it("comes from 18 rendered dumps, all CameraProfile Embedded, on process versions 15.4 and 11.0", () => {
    expect(file.sources).toHaveLength(18);
    expect(new Set(file.sources.map((s) => s.camera_profile))).toEqual(new Set(["Embedded"]));
    expect(new Set(file.sources.map((s) => s.process_version))).toEqual(new Set(["15.4", "11.0"]));
    expect(new Set(file.sources.map((s) => s.lr_version))).toEqual(new Set(["15.6"]));
    const formats = file.sources.map((s) => s.filename.replace(/^.*\./, "").toLowerCase());
    for (const f of ["jpg", "png", "tif", "psd", "psb", "heic", "avif", "jxl", "dng"]) expect(formats).toContain(f);
  });

  it("carries the incremental white-balance keys and none of the raw-only ones", () => {
    expect(rendered.get(RENDERED_WHITE_BALANCE.keys.temperature).type).toBe("number");
    expect(rendered.get(RENDERED_WHITE_BALANCE.keys.tint).type).toBe("number");
    for (const key of RAW_ONLY) expect(rendered.has(key)).toBe(false);
    for (const key of Object.values(RENDERED_WHITE_BALANCE.keys)) expect(raw.has(key)).toBe(false);
  });

  it("holds every canonical parameter's key except the raw-only ones, with the raw pin's types", () => {
    const missing = [...CANONICAL_PARAMS.values()].map((spec) => spec.sdkKey).filter((key) => !rendered.has(key));
    expect(missing.sort()).toEqual(["Temperature", "Tint"]);
    for (const key of rendered.keys()) if (raw.has(key)) expect(rendered.get(key).type, key).toBe(raw.get(key).type);
  });

  it("records the HDR tone-curve keys as state keys seen on the HDR AVIF and the 32-bit TIFF only", () => {
    for (const key of ["ExtendedToneCurvePV2012", "ExtendedToneCurvePV2012Red", "ExtendedToneCurvePV2012Green", "ExtendedToneCurvePV2012Blue"]) {
      expect(rendered.get(key).seen_in).toHaveLength(2);
    }
  });
});
