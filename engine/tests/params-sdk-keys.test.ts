import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  jsonValueType,
  loadSdkKeys,
  pinFromDumps,
  UnknownSdkKeyError,
} from "../src/params/sdk-keys.js";

function fixture(name: string): unknown {
  const url = new URL(`./fixtures/${name}`, import.meta.url);
  return JSON.parse(readFileSync(fileURLToPath(url), "utf8")) as unknown;
}

const META = { generatedBy: "vitest", generatedAt: "2026-09-23T00:00:00Z" };

describe("params: S5 dump -> pinned SDK key table", () => {
  it("pins a single dump with one entry per key, sorted, typed, with a sample", () => {
    const pinned = pinFromDumps([{ label: "a", dump: fixture("synthetic-s5-dump-a.json") }], META);

    expect(pinned.schema_version).toBe(1);
    expect(pinned.sources).toEqual([{ label: "a", filename: "synthetic-a.NEF", lr_version: "synthetic" }]);
    expect(pinned.keys.map((k) => k.key)).toEqual([
      "SyntheticArray",
      "SyntheticBoolean",
      "SyntheticInteger",
      "SyntheticNullable",
      "SyntheticNumber",
      "SyntheticObject",
      "SyntheticProcessVersion",
      "SyntheticString",
    ]);
    const byKey = Object.fromEntries(pinned.keys.map((k) => [k.key, k]));
    expect(byKey["SyntheticNumber"]).toEqual({ key: "SyntheticNumber", type: "number", sample: 0.35, seen_in: ["a"] });
    expect(byKey["SyntheticArray"]?.type).toBe("array");
    expect(byKey["SyntheticObject"]?.type).toBe("object");
    expect(byKey["SyntheticNullable"]?.type).toBe("null");
  });

  it("unions two dumps and resolves null to the concrete type", () => {
    const pinned = pinFromDumps(
      [
        { label: "nef", dump: fixture("synthetic-s5-dump-a.json") },
        { label: "dng", dump: fixture("synthetic-s5-dump-b.json") },
      ],
      META,
    );
    const byKey = Object.fromEntries(pinned.keys.map((k) => [k.key, k]));
    expect(byKey["SyntheticNumber"]?.seen_in).toEqual(["nef", "dng"]);
    expect(byKey["SyntheticOnlyInB"]).toEqual({ key: "SyntheticOnlyInB", type: "boolean", sample: false, seen_in: ["dng"] });
    expect(byKey["SyntheticNullable"]).toMatchObject({ type: "number", sample: 12 });
  });

  it("refuses a key whose concrete type differs between dumps", () => {
    const a = { meta: { spike: "S5", filename: "x" }, settings: { K: 1 } };
    const b = { meta: { spike: "S5", filename: "y" }, settings: { K: "one" } };
    expect(() => pinFromDumps([{ label: "a", dump: a }, { label: "b", dump: b }], META)).toThrow(/Key "K" has type number/);
  });

  it("rejects a dump that is not S5-shaped", () => {
    expect(() => pinFromDumps([{ label: "bad", dump: { settings: {} } }], META)).toThrow();
    expect(() => pinFromDumps([], META)).toThrow(/at least one dump/);
  });
});

describe("params: pinned key table loader", () => {
  const pinned = pinFromDumps([{ label: "a", dump: fixture("synthetic-s5-dump-a.json") }], META);

  it("round-trips through JSON and answers lookups", () => {
    const map = loadSdkKeys(JSON.parse(JSON.stringify(pinned)) as unknown);
    expect(map.size).toBe(8);
    expect(map.has("SyntheticString")).toBe(true);
    expect(map.get("SyntheticString").type).toBe("string");
  });

  it("rejects unknown keys instead of guessing", () => {
    const map = loadSdkKeys(pinned);
    expect(map.has("Exposure2012")).toBe(false);
    expect(() => map.get("Exposure2012")).toThrow(UnknownSdkKeyError);
  });

  it("rejects duplicate keys and malformed files", () => {
    const first = pinned.keys[0];
    if (!first) throw new Error("fixture produced no keys");
    expect(() => loadSdkKeys({ ...pinned, keys: [first, first] })).toThrow(/Duplicate SDK key/);
    expect(() => loadSdkKeys({ ...pinned, schema_version: 2 })).toThrow();
  });

  it("classifies JSON value types", () => {
    expect(jsonValueType(null)).toBe("null");
    expect(jsonValueType([1])).toBe("array");
    expect(jsonValueType({})).toBe("object");
    expect(jsonValueType(1)).toBe("number");
  });
});
