// The mask table's fields and operations (src/params/mask-table.ts, mask-ops.ts; GitHub issue #59)
// against Jim's three masks captures, committed in docs\reports\phase6\masks-capture\: every field
// constant must appear in them (rule 03: SDK names only from a live dump), each captured entry reads
// as its kind, and a new entry has the captured shape.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANONICAL_PARAMS, loadDefaultParamMap } from "../src/params/index.js";
import { applyOp, newCorrection, precheck, storedSliders, tableSettings, type MaskOp } from "../src/params/mask-ops.js";
import { AI_KINDS, C, CARRIED, CORRECTION, IMAGE, LINEAR, LOCAL_PARAMS, M, MASK_TABLE_KEY, RADIAL, RANGE, WHAT, MaskError, readTable, summarize, tableInfo, verifyTable, type Correction } from "../src/params/mask-table.js";

const capture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../docs/reports/phase6/masks-capture/${name}`, import.meta.url)), "utf8"));
const dump = capture("3_dump-1.json") as Record<string, unknown>;
const table = dump[MASK_TABLE_KEY] as Correction[];
const background = (capture("capture2-templates.json") as { templates: { background: { entry: Correction } } }).templates.background.entry;
const people = (capture("capture3-templates.json") as { templates: Record<string, Correction> }).templates;
const captured: Correction[] = [...table, background, ...Object.values(people)];

/** Every key and every string value at any depth. */
function words(v: unknown, out = new Set<string>()): Set<string> {
  if (typeof v === "string") out.add(v);
  else if (Array.isArray(v)) for (const x of v) words(x, out);
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) words(x, out.add(k));
  return out;
}

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (err) {
    return (err as MaskError).code;
  }
  return "no error";
};

describe("params: the mask table's field names (rule 03)", () => {
  it("names only fields and type strings that appear in the committed capture dumps", () => {
    const seen = words({ dump, captured });
    const constants = [MASK_TABLE_KEY, CORRECTION, ...CARRIED, ...[C, M, WHAT, LINEAR, RADIAL, IMAGE, RANGE].flatMap((o) => Object.values(o)), ...[...LOCAL_PARAMS.values()].map((p) => p.field)];
    expect(constants.filter((c) => !seen.has(c))).toEqual([]);
  });

  it("keeps the local sliders apart from the canonical names and from the top-level keys", () => {
    expect([...LOCAL_PARAMS.keys()].filter((k) => CANONICAL_PARAMS.has(k))).toEqual([]);
    expect([...LOCAL_PARAMS.keys()].every((k) => k.startsWith("local."))).toBe(true);
    const topLevel = new Set(Object.keys(dump));
    expect([...LOCAL_PARAMS.values()].filter((p) => topLevel.has(p.field))).toEqual([]);
    expect(loadDefaultParamMap().names().filter((n) => n.startsWith("local."))).toEqual([]);
  });

  it("gives each AI kind the subtype and subcategory of its captured entry", () => {
    const tells = (e: Correction) => {
      const m = (e[C.masks] as Record<string, unknown>[])[0] ?? {};
      return { [IMAGE.subType]: m[IMAGE.subType], ...(m[IMAGE.subCategory] !== undefined ? { [IMAGE.subCategory]: m[IMAGE.subCategory] } : {}), [IMAGE.maskVersion]: m[IMAGE.maskVersion] };
    };
    const from = { subject: table[3], sky: table[2], background, people_entire: people["people_entire"], people_face_skin: people["people_part"], landscape_vegetation: people["landscape_1"], landscape_sky: people["landscape_2"] };
    for (const [kind, e] of Object.entries(from)) expect(AI_KINDS[kind as keyof typeof AI_KINDS].fields, kind).toEqual(tells(e as Correction));
  });
});

describe("params: reading the mask table", () => {
  it("reads absent, [] and {} as no masks, with one fingerprint", () => {
    for (const sdk of [{}, { [MASK_TABLE_KEY]: [] }, { [MASK_TABLE_KEY]: {} }]) {
      expect(readTable(sdk)).toEqual([]);
      expect(tableInfo(sdk)).toEqual({ count: 0, fingerprint: "[]" });
    }
  });

  it("refuses a table that is not an array of corrections, rather than treating it as empty", () => {
    expect(codeOf(() => readTable({ [MASK_TABLE_KEY]: { "1": table[0], "2": table[1] } }))).toBe("MASK_TABLE_UNREADABLE");
    expect(codeOf(() => readTable({ [MASK_TABLE_KEY]: [{ What: "Correction" }] }))).toBe("MASK_TABLE_UNREADABLE");
  });

  it("reads each captured entry as its kind, sliders in the panel's units", () => {
    expect(captured.map((e) => summarize(e).kind)).toEqual(["linear", "radial", "sky", "subject", "luminance", "background", "people_entire", "people_face_skin", "landscape_vegetation", "landscape_sky"]);
    expect(summarize(table[0] as Correction)).toMatchObject({ name: "Mask 1", active: true, inverted: false, components: 1, sliders: { "local.exposure": 0.5 } });
    expect(summarize(table[0] as Correction).geometry).toEqual({ zero: { x: 0.494073, y: 0.52221 }, full: { x: 0.495633, y: 0.789555 } });
    expect(summarize(table[4] as Correction).geometry).toEqual({ lum_range: [0.65, 0.9, 1, 1] });
    expect(summarize(table[2] as Correction).computed).toBe(true);
    expect(summarize(people["people_entire"] as Correction).geometry).toEqual({ point: { x: 0.539062, y: 0.65 } });
  });

  it("gives the same fingerprint to two equal tables whatever their key order", () => {
    const reordered = table.map((e) => Object.fromEntries(Object.entries(e).reverse()));
    expect(tableInfo({ [MASK_TABLE_KEY]: reordered })).toEqual(tableInfo(dump));
  });
});

describe("params: new masks in the captured shape", () => {
  const keys = (o: unknown): string[] => Object.keys(o as object).sort();
  const first = (e: Correction): Record<string, unknown> => (e[C.masks] as Record<string, unknown>[])[0] as Record<string, unknown>;

  it("builds a correction with exactly the captured correction's fields", () => {
    const e = newCorrection("linear", "AVG Linear", { zero: { x: 0.5, y: 0.67 }, full: { x: 0.5, y: 0.9 } }, null, {}, []);
    expect(keys(e)).toEqual(keys(table[0]));
    expect(keys(first(e))).toEqual(keys(first(table[0] as Correction)));
    expect([e[C.refX], e[C.refY]]).toEqual([0.5, 0.785]);
    expect(String(e[C.id])).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
    expect(String(e[C.syncId])).toMatch(/^[0-9A-F]{32}$/);
  });

  it("builds radial and luminance components with the captured fields, AI ones without digests or the photo's own fields", () => {
    const radial = newCorrection("radial", "r", { left: 0.6, top: 0.1, right: 0.9, bottom: 0.5 }, null, {}, []);
    expect(keys(first(radial))).toEqual(keys(first(table[1] as Correction)));
    const lum = newCorrection("luminance", "l", { lum_range: [0.6, 0.8, 1, 1] }, null, {}, []);
    expect(keys(first(lum))).toEqual(keys(first(table[4] as Correction)));
    expect((first(lum)[RANGE.holder] as Record<string, unknown>)[RANGE.lumRange]).toBe("0.600000 0.800000 1.000000 1.000000");
    const sky = first(newCorrection("sky", "s", {}, null, {}, []));
    expect(keys(sky)).toEqual(["MaskActive", "MaskBlendMode", "MaskID", "MaskInverted", "MaskName", "MaskSubType", "MaskSyncID", "MaskValue", "MaskVersion", "What"]);
    expect(keys(sky).every((k) => keys(first(table[2] as Correction)).includes(k))).toBe(true);
    const person = newCorrection("people_entire", "p", {}, { x: 0.539062, y: 0.65 }, {}, []);
    expect(first(person)).toMatchObject({ [IMAGE.subType]: 0, [IMAGE.subCategory]: 20036, [IMAGE.referencePoint]: "0.539062 0.650000" });
    expect([person[C.refX], person[C.refY]]).toEqual([0.539062, 0.65]);
  });

  it("stores local sliders by their captured scales; the colour hue 1:1 in degrees", () => {
    expect(storedSliders({ "local.exposure": 1, "local.contrast": 23, "local.hue": 90, "local.toning_hue": 180, "local.toning_saturation": 50 })).toEqual({
      LocalExposure2012: 0.25,
      LocalContrast2012: 0.23,
      LocalHue: 0.5,
      LocalToningHue: 180,
      LocalToningSaturation: 0.5,
    });
    expect(codeOf(() => storedSliders({ "local.exposure": 4.5 }))).toBe("OUT_OF_RANGE");
    expect(codeOf(() => storedSliders({ exposure: 1 }))).toBe("UNKNOWN_PARAMETER");
  });
});

describe("params: mask operations", () => {
  const id0 = String((table[0] as Correction)[C.id]);
  const op = (o: MaskOp) => applyOp(table, o);

  it("edits sliders, name, visibility, geometry and inversion on a copy, leaving the others alone", () => {
    const r = op({ op: "edit", mask_id: id0, name: "AVG renamed", active: false, inverted: true, sliders: { "local.exposure": 1 }, geometry: { full: { x: 0.5, y: 0.95 } } });
    expect(r.after).toMatchObject({ name: "AVG renamed", active: false, inverted: true, sliders: { "local.exposure": 1 }, geometry: { full: { x: 0.5, y: 0.95 } } });
    expect(r.entries.slice(1)).toEqual(table.slice(1));
    expect(table[0]).toEqual((dump[MASK_TABLE_KEY] as Correction[])[0]); // the input is not changed
  });

  it("deletes by id, and refuses an unknown id, combining, a geometry for an AI mask and an empty edit", () => {
    expect(op({ op: "delete", mask_id: id0 }).entries.map((e) => e[C.id])).toEqual(table.slice(1).map((e) => e[C.id]));
    expect(codeOf(() => op({ op: "delete", mask_id: "NOPE" }))).toBe("MASK_NOT_FOUND");
    expect(codeOf(() => op({ op: "edit", mask_id: id0, combine: { mode: "add" } }))).toBe("MASK_OP_NOT_CAPTURED");
    expect(codeOf(() => op({ op: "create", kind: "sky", geometry: { left: 0.1 } }))).toBe("INVALID_ARGUMENTS");
    expect(codeOf(() => precheck({ op: "edit", mask_id: id0 }))).toBe("INVALID_ARGUMENTS");
  });

  it("refuses the kinds that were not captured or cannot be made from the table, each with its reason", () => {
    for (const kind of ["people", "landscape", "brush", "objects", "color_range", "depth_range"]) {
      let message = "";
      try {
        precheck({ op: "create", kind });
      } catch (err) {
        message = (err as Error).message;
        expect((err as MaskError).code).toBe("MASK_KIND_NOT_SUPPORTED");
      }
      expect(message, kind).toMatch(/not offered: .+/);
    }
    expect(codeOf(() => precheck({ op: "create", kind: "people_entire" }))).toBe("INVALID_ARGUMENTS"); // no point
    expect(codeOf(() => precheck({ op: "create", kind: "sky", point: { x: 0.5, y: 0.5 } }))).toBe("INVALID_ARGUMENTS");
  });

  it("writes an empty table only for a delete or an undo", () => {
    expect(codeOf(() => tableSettings([], false))).toBe("INTERNAL_ERROR");
    expect(tableSettings([], true)).toEqual({ [MASK_TABLE_KEY]: [] });
  });

  it("checks a read-back by id, ignoring what Lightroom adds and the order", () => {
    const written = op({ op: "create", kind: "sky" }).entries;
    const back = structuredClone(written).reverse();
    Object.assign((back[0]?.[C.masks] as Record<string, unknown>[])[0] as object, { [IMAGE.digest]: "ABC" });
    expect(verifyTable(written, { [MASK_TABLE_KEY]: back })).toEqual([]);
    expect(verifyTable(written, { [MASK_TABLE_KEY]: back.slice(1) })).toHaveLength(2);
    expect(verifyTable([], {})).toEqual([]);
  });
});
