// `npm run preset:capture` (devtools\preset-capture.ts) with a fake bridge and a temp preset folder:
// the photo check, finding the reference preset, the findings, and the fixtures it saves.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { capturePreset, expectedKeys, REFERENCES, type CaptureIo } from "../src/devtools/preset-capture.js";
import { loadDefaultParamMap } from "../src/params/index.js";

const map = loadDefaultParamMap();
const FIXTURES = path.join(import.meta.dirname, "fixtures", "presets");
const read = (file: string): string => readFileSync(path.join(FIXTURES, file), "utf8");
const settingsOf = (prefix: string): Record<string, unknown> => (JSON.parse(read(`${prefix}-settings.lrc15.json`)) as { settings: Record<string, unknown> }).settings;

function io(settings: Record<string, unknown>, files: Record<string, string>): { io: CaptureIo; saved: Map<string, string> } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lrc-avg-capture-"));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), text);
  }
  const saved = new Map<string, string>();
  return {
    saved,
    io: {
      photo: async () => ({ uuid: "U-1", filename: "photo.NEF", lrc_version: "15.5.1" }),
      settings: async () => settings,
      settingsDir: dir,
      save: (file, text) => saved.set(file, text),
      now: () => new Date("2026-09-28T02:00:00Z"),
    },
  };
}

describe("capturePreset", () => {
  it("saves the reference and the photo's settings, and reports what the file lacks", async () => {
    const { io: fake, saved } = io(settingsOf("reference-2"), { "AVG preset reference 2.xmp": read("reference-2.lrc15.xmp"), "Painted Hills LUT.xmp": "<x/>" });
    const out = await capturePreset(fake, map, { precheck: false, spec: REFERENCES.second });
    expect(out.worked).toBe(true);
    expect(out.findings).toEqual(["the preset file has no Temperature, Tint (group white_balance)", "the preset file has no EnableLensCorrections (group lens)", "the preset file has no Look (group camera_profile)"]);
    expect(saved.get("reference-2.lrc15.xmp")).toBe(read("reference-2.lrc15.xmp"));
    const fixture = JSON.parse(saved.get("reference-2-settings.lrc15.json") as string) as Record<string, unknown>;
    expect(fixture).toMatchObject({ captured_at: "2026-09-28T02:00:00.000Z", photo: { filename: "photo.NEF" }, reference: { file: "AVG preset reference 2.xmp", group: "LrC-AVG" } });
  });

  it("fails, saving nothing, when the preset's values differ from the selected photo's (Greptile, PR #36)", async () => {
    const { io: fake, saved } = io({ ...settingsOf("reference-2"), Contrast2012: 7 }, { "AVG preset reference 2.xmp": read("reference-2.lrc15.xmp") });
    const out = await capturePreset(fake, map, { precheck: false, spec: REFERENCES.second });
    expect(out.worked).toBe(false);
    expect(out.problems).toEqual([expect.stringMatching(/^the preset's values differ from the selected photo's for Contrast2012: /)]);
    expect(saved.size).toBe(0);
  });

  it("fails on a reference file its reader cannot parse", async () => {
    const singleQuoted = read("reference-2.lrc15.xmp").replace('crs:PresetType="Normal"', "crs:PresetType='Normal'");
    const { io: fake, saved } = io(settingsOf("reference-2"), { "AVG preset reference 2.xmp": singleQuoted });
    const out = await capturePreset(fake, map, { precheck: false, spec: REFERENCES.second });
    expect(out.problems).toEqual(['AVG preset reference 2.xmp may be "AVG preset reference 2", but this reader cannot parse it']);
    expect(saved.size).toBe(0);
  });

  it("fails without exactly one reference file, and saves nothing", async () => {
    const none = io(settingsOf("reference-2"), {});
    const two = io(settingsOf("reference-2"), { "a.xmp": read("reference-2.lrc15.xmp"), "sub/b.xmp": read("reference-2.lrc15.xmp") });
    for (const { io: fake, saved } of [none, two]) {
      const out = await capturePreset(fake, map, { precheck: false, spec: REFERENCES.second });
      expect(out.worked).toBe(false);
      expect(out.problems[0]).toMatch(/need exactly 1/);
      expect(saved.size).toBe(0);
    }
  });

  it("wants a rendered photo with Custom white balance above 0 and the named profile for the rendered references (Phase 8 row 5)", async () => {
    const jpeg = (JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", "s10-rendered-dsc0031.json"), "utf8")) as { settings: Record<string, unknown> }).settings;
    const check = async (settings: Record<string, unknown>, spec: (typeof REFERENCES)[keyof typeof REFERENCES]) => (await capturePreset(io(settings, {}).io, map, { precheck: true, spec })).problems;
    expect(await check(settingsOf("reference-2"), REFERENCES.rendered)).toEqual([expect.stringMatching(/^the photo is on the raw pipeline; this reference needs a rendered one \(a JPEG\)/)]);
    expect(await check(jpeg, REFERENCES.rendered)).toEqual([expect.stringMatching(/^the white balance must be Custom with Temp and Tint above 0 \(now As Shot, 0, 0\)/)]);
    const custom = { ...jpeg, WhiteBalance: "Custom", IncrementalTemperature: 20, IncrementalTint: 10 };
    expect(await check(custom, REFERENCES.rendered)).toEqual([]);
    expect(await check(custom, REFERENCES.renderedMono)).toEqual(["the photo's profile is Color; this reference needs Monochrome (Basic panel > Profile)"]);
    expect(await check({ ...custom, ConvertToGrayscale: true }, REFERENCES.renderedMono)).toEqual([]);
    expect(await check(custom, REFERENCES.second)).toEqual([expect.stringMatching(/^the photo is on the rendered pipeline; this reference needs a raw one$/)]);
  });

  it("expects the rendered keys of a rendered reference: IncrementalTemperature, IncrementalTint and ConvertToGrayscale", () => {
    const keys = expectedKeys(map, "rendered");
    expect(keys["white_balance"]).toEqual(["IncrementalTemperature", "IncrementalTint", "WhiteBalance"]);
    expect(keys["camera_profile"]).toEqual(["CameraProfile", "ConvertToGrayscale"]);
    expect(expectedKeys(map)["camera_profile"]).toEqual(["CameraProfile", "Look"]);
  });

  it("wants a photo with an Adobe profile's Look for the first reference, not the second", async () => {
    const nef = settingsOf("reference-2");
    expect((await capturePreset(io(nef, {}).io, map, { precheck: true, spec: REFERENCES.first })).problems).toEqual([expect.stringMatching(/has no Look/)]);
    expect((await capturePreset(io(nef, {}).io, map, { precheck: true, spec: REFERENCES.second })).worked).toBe(true);
    expect((await capturePreset(io(settingsOf("reference"), {}).io, map, { precheck: true, spec: REFERENCES.first })).worked).toBe(true);
  });
});
