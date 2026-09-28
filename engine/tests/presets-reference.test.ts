// The engine's preset files against Lightroom's own (PHASE4_PLAN row 9, decision 1A): given the
// settings of the photo each reference preset was made from, the writer must write every setting
// the way Lightroom wrote it there, and leave out only what it says it leaves out. The references
// were written by LrC 15.5.1 from Jim's checklist [handle: engine\tests\fixtures\presets\*, captured
// 2026-09-28 by `npm run preset:capture`; transcript docs\reports\phase4\presets-smoke\presets-live.txt].

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CANONICAL_PARAMS, loadDefaultParamMap, loadDefaultPresetFormat, sdkKeysOf } from "../src/params/index.js";
import { altText, child, newPresetUuid, parseXml, presetDescription, renderPreset, selectPresetSettings, seqItems, type XmlNode } from "../src/presets/index.js";
import { MASK_GROUPS } from "../src/sync/index.js";

const FIXTURES = path.join(import.meta.dirname, "fixtures", "presets");
const map = loadDefaultParamMap();
const format = loadDefaultPresetFormat();

type Reference = { label: string; text: string; settings: Record<string, unknown>; name: string; group: string };

function reference(prefix: string): Reference {
  const fixture = JSON.parse(readFileSync(path.join(FIXTURES, `${prefix}-settings.lrc15.json`), "utf8")) as {
    settings: Record<string, unknown>;
    reference: { name: string; group: string };
  };
  return { label: prefix, text: readFileSync(path.join(FIXTURES, `${prefix}.lrc15.xmp`), "utf8"), settings: fixture.settings, ...fixture.reference };
}

const REFERENCES = [reference("reference"), reference("reference-2")];
const UUID = "0123456789ABCDEF0123456789ABCDEF";

function written(ref: Reference): { description: XmlNode; left_out: string[] } {
  const selection = selectPresetSettings(map, ref.settings, MASK_GROUPS);
  const text = renderPreset(format, { uuid: UUID, name: ref.name, group: ref.group, entries: selection.entries });
  return { description: presetDescription(parseXml(text)), left_out: selection.left_out.map((l) => l.name) };
}

/** Every SDK key a canonical name writes. */
const canonicalKeys = new Set([...map.names()].flatMap((n) => sdkKeysOf(map, n)));

describe.each(REFERENCES)("the preset written from $label's photo", (ref) => {
  const lightroom = presetDescription(parseXml(ref.text));
  const ours = written(ref);

  it("writes each attribute as Lightroom wrote it (all but the preset's own uuid)", () => {
    const differ: string[] = [];
    for (const [k, v] of ours.description.attrs) {
      if (k === "crs:UUID") continue;
      if (lightroom.attrs.get(k) !== v) differ.push(`${k}: ours ${JSON.stringify(v)}, Lightroom's ${JSON.stringify(lightroom.attrs.get(k))}`);
    }
    expect(differ).toEqual([]);
  });

  it("writes the name, the group, the empty texts and the point curves as Lightroom did", () => {
    for (const el of ours.description.children) {
      const theirs = child(lightroom, el.name);
      expect(theirs, el.name).toBeDefined();
      expect([altText(el), seqItems(el)], el.name).toEqual([altText(theirs), seqItems(theirs)]);
    }
    expect(altText(child(ours.description, "crs:Group"))).toBe("LrC-AVG");
  });

  it("leaves out only non-canonical keys, or canonical ones it names in left_out", () => {
    const left = new Set(ours.left_out.flatMap((n) => sdkKeysOf(map, n)));
    const missing = [...lightroom.attrs.keys(), ...lightroom.children.map((c) => c.name)]
      .map((k) => k.replace(/^crs:/, ""))
      .filter((k) => canonicalKeys.has(k) && !ours.description.attrs.has(`crs:${k}`) && !child(ours.description, `crs:${k}`));
    expect(missing.filter((k) => !left.has(k))).toEqual([]);
  });

  it("keeps Lightroom's attribute order", () => {
    const theirOrder = [...lightroom.attrs.keys()].filter((k) => ours.description.attrs.has(k));
    expect([...ours.description.attrs.keys()]).toEqual(theirOrder);
  });
});

describe("the preset's uuid (the writer test deferred from PR #30, in row 9's form)", () => {
  it("writes exactly one crs:UUID, the preset's own, in the form of Lightroom's", () => {
    const ref = REFERENCES[1] as Reference;
    const uuid = newPresetUuid();
    const selection = selectPresetSettings(map, ref.settings, MASK_GROUPS);
    const text = renderPreset(format, { uuid, name: "x", group: "LrC-AVG", entries: selection.entries });
    expect(text.match(/crs:UUID=/g)).toHaveLength(1);
    expect(presetDescription(parseXml(text)).attrs.get("crs:UUID")).toBe(uuid);
    for (const r of REFERENCES) {
      const theirs = presetDescription(parseXml(r.text)).attrs.get("crs:UUID") as string;
      expect(theirs).toMatch(/^[0-9A-F]{32}$/);
      expect(uuid).toMatch(/^[0-9A-F]{32}$/);
      expect(uuid).not.toBe(theirs);
    }
    expect(newPresetUuid()).not.toBe(uuid);
  });
});

describe("what the references show", () => {
  it("Lightroom wrote a canonical key it was given in both files, except where a rule leaves it out", () => {
    // Keys a canonical name maps to that neither file holds: each has a leave-out rule in select.ts.
    const inEither = new Set(REFERENCES.flatMap((r) => [...presetDescription(parseXml(r.text)).attrs.keys(), ...presetDescription(parseXml(r.text)).children.map((c) => c.name)]));
    const never = [...CANONICAL_PARAMS.values()].map((s) => s.sdkKey).filter((k) => !inEither.has(`crs:${k}`));
    expect(never.sort()).toEqual(["EnableLensCorrections", "Temperature", "Tint"]);
  });
});
