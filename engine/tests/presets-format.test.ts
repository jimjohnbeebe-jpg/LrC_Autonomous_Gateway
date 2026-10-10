// The pinned preset format (params\preset-format.lrc15.json, devtools\preset-pin.ts), the number
// formats taken from it, the preset keys named in params\preset-keys.ts, and the XMP reader.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { derivePresetFormat, PRESET_SOURCES } from "../src/devtools/preset-pin.js";
import { CAMERA_PROFILE_KEY, loadDefaultParamMap, loadDefaultPresetFormat, PROCESS_VERSION_KEY, PROFILE_KEYS, RENDERED_PROFILE_KEYS, TONE_CURVE_NAME_KEY, WHITE_BALANCE_KEY } from "../src/params/index.js";
import { readSdkKeysFile } from "../src/params/sdk-keys.js";
import { formatNumber, parseXml, presetIdentity } from "../src/presets/index.js";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const map = loadDefaultParamMap();
const texts = PRESET_SOURCES.map((f) => readFileSync(path.join(repoRoot, f), "utf8"));
/** The raw reference-2 (PRESET_SOURCES puts the two rendered references, LrC 15.6, first). */
const REF2 = PRESET_SOURCES.findIndex((f) => f.endsWith("reference-2.lrc15.xmp"));
const ref2 = texts[REF2] as string;
/** The sources with reference-2 replaced. */
const withRef2 = (text: string): string[] => texts.map((t, i) => (i === REF2 ? text : t));

describe("the pinned preset format", () => {
  it("is what `npm run preset:pin` derives from the references now", () => {
    expect(loadDefaultPresetFormat()).toEqual(derivePresetFormat(map, texts));
  });

  it("names only keys of a pinned dump (raw or rendered)", () => {
    const raw = readSdkKeysFile(path.join(repoRoot, "engine", "src", "params", "sdk-keys.lrc15.json"));
    const rendered = readSdkKeysFile(path.join(repoRoot, "engine", "src", "params", "sdk-keys.lrc15.rendered.json"));
    for (const key of [CAMERA_PROFILE_KEY, ...PROFILE_KEYS, ...RENDERED_PROFILE_KEYS, PROCESS_VERSION_KEY, WHITE_BALANCE_KEY, TONE_CURVE_NAME_KEY, ...Object.keys(loadDefaultPresetFormat().numbers)]) {
      expect(raw.has(key) || rendered.has(key), key).toBe(true);
    }
  });

  it("takes the envelope from the newest Lightroom's references, which differ from the raw ones in crs:Version alone (Phase 8 row 5)", () => {
    const format = loadDefaultPresetFormat();
    expect(format.envelope.find(([k]) => k === "Version")).toEqual(["Version", "18.7"]);
    expect(ref2).toContain('crs:Version="18.5.1"');
    expect(format.numbers["IncrementalTemperature"]).toMatchObject({ signed: true, decimals: 0, observed: ["+20"], basis: "observed" });
    expect(format.numbers["IncrementalTint"]).toMatchObject({ signed: true, observed: ["+10"] });
    // A later reference newer than the first stops the pin.
    expect(() => derivePresetFormat(map, withRef2(ref2.replace('crs:Version="18.5.1"', 'crs:Version="18.9"')))).toThrow(/newer Camera Raw than the first/);
  });

  it("marks what it infers: every sign Lightroom did not show follows the range, and says so", () => {
    for (const [key, f] of Object.entries(loadDefaultPresetFormat().numbers)) {
      const shown = f.observed.some((t) => t.startsWith("+") || (/^\d/.test(t) && Number(t) > 0));
      expect(f.basis === "observed", key).toBe(shown);
      if (!shown) expect(f.basis, key).toMatch(/^inference: /);
    }
  });

  it("stops when a key whose range goes below 0 was written without a sign", () => {
    // Dehaze is 0 in all four references, so an unsigned 15 in one is the only sign observed.
    expect(ref2).toContain('crs:Dehaze="0"');
    const broken = ref2.replace('crs:Dehaze="0"', 'crs:Dehaze="15"');
    expect(() => derivePresetFormat(map, withRef2(broken))).toThrow(/Dehaze: its range goes below 0/);
  });

  it("stops when the references differ in their preset attributes", () => {
    const broken = ref2.replace('crs:Cluster=""', 'crs:Cluster="x"');
    expect(() => derivePresetFormat(map, withRef2(broken))).toThrow(/differ in the preset attributes/);
  });

  it("empties the preset's own crs:UUID and ignores a Look's (PR #30's two-uuid case)", () => {
    const look = '   <crs:Look>\n    <rdf:Description crs:Name="Adobe Color" crs:UUID="FFFF0000FFFF0000FFFF0000FFFF0000"/>\n   </crs:Look>\n';
    const withLook = ref2.replace("   <crs:Name>", `${look}   <crs:Name>`);
    expect(withLook.match(/crs:UUID=/g)).toHaveLength(2);
    const derived = derivePresetFormat(map, withRef2(withLook));
    expect(derived.envelope.filter(([k]) => k === "UUID")).toEqual([["UUID", ""]]);
    expect(derived).toEqual(derivePresetFormat(map, texts));
  });
});

describe("numbers as Lightroom writes them", () => {
  const numbers = loadDefaultPresetFormat().numbers;
  it.each([
    ["Exposure2012", 0.33, "+0.33"],
    ["Exposure2012", 0, "0.00"],
    ["Exposure2012", -1.5, "-1.50"],
    ["Exposure2012", 0.335, "+0.335"],
    ["Highlights2012", -21, "-21"],
    ["Shadows2012", 10, "+10"],
    ["Contrast2012", 12.5, "+12.5"],
    ["SharpenRadius", 2, "+2.0"],
    ["SharpenDetail", 25, "25"],
    ["ColorGradeBlending", 50, "50"],
    ["Temperature", 5500, "5500"],
    ["Tint", 6, "+6"],
  ])("%s %d -> %s", (key, value, text) => {
    expect(formatNumber(value, numbers[key])).toBe(text);
  });
});

describe("the XMP reader", () => {
  it("refuses a tag closed by another and an element left open", () => {
    expect(() => parseXml("<a><b></a>")).toThrow(/closes <b>/);
    expect(() => parseXml("<a><b>")).toThrow(/is not closed/);
  });

  it("reads a preset's name and group, with XML escapes", () => {
    const id = presetIdentity(ref2.replace(">AVG preset reference 2<", ">Tom &amp; Jerry<"));
    expect(id).toEqual({ name: "Tom & Jerry", group: "LrC-AVG" });
  });
});
