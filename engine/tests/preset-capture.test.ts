// `npm run preset:capture` (devtools\preset-capture.ts) with a fake bridge and a temp preset folder:
// the photo check, finding the reference preset, the findings, and the fixtures it saves.

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { capturePreset, REFERENCES, type CaptureIo } from "../src/devtools/preset-capture.js";
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

  it("says when the preset's values differ from the photo's", async () => {
    const { io: fake } = io({ ...settingsOf("reference-2"), Contrast2012: 7 }, { "AVG preset reference 2.xmp": read("reference-2.lrc15.xmp") });
    const out = await capturePreset(fake, map, { precheck: false, spec: REFERENCES.second });
    expect(out.findings).toContain("the preset's values differ from the photo's for Contrast2012");
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

  it("wants a photo with an Adobe profile's Look for the first reference, not the second", async () => {
    const nef = settingsOf("reference-2");
    expect((await capturePreset(io(nef, {}).io, map, { precheck: true, spec: REFERENCES.first })).problems).toEqual([expect.stringMatching(/has no Look/)]);
    expect((await capturePreset(io(nef, {}).io, map, { precheck: true, spec: REFERENCES.second })).worked).toBe(true);
    expect((await capturePreset(io(settingsOf("reference"), {}).io, map, { precheck: true, spec: REFERENCES.first })).worked).toBe(true);
  });
});
