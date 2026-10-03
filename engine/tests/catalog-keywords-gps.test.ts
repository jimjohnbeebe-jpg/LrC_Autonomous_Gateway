// GitHub issue #60 (engine 0.15.0, plugin 0.10.0): keyword paths in lr_set_keywords, lr_list_keywords
// and lr_set_gps, through the Tools class against the simulated Lightroom (lightroom-sim-library.ts),
// plus the path and GPS helpers (library\keywords.ts, library\write.ts) and the argument schemas.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { gpsNotTaken, keywordLevels, keywordsNotTaken, normalizeKeyword } from "../src/library/index.js";
import { CATALOG_DEFS } from "../src/mcp/defs-catalog.js";
import { toToolError, type ToolError } from "../src/mcp/index.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { client, lr, sent, tools, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();
afterEach(() => vi.restoreAllMocks());

const fails = async (p: Promise<ToolOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};
const schema = (name: string) => CATALOG_DEFS.find((d) => d.name === name)?.schema as (typeof CATALOG_DEFS)[number]["schema"];
const photo = (uuid: string) => lr.library.photos.find((p) => p.uuid === uuid) as (typeof lr.library.photos)[number];
const photos = (out: ToolOutput) => out.json["photos"] as Array<{ uuid: string; before: unknown; after: unknown; changed: boolean }>;

describe("keyword paths (library\\keywords.ts)", () => {
  it("splits a path into trimmed levels and refuses an empty level", () => {
    expect(keywordLevels("Places | Europe|Paris")).toEqual(["Places", "Europe", "Paris"]);
    expect(keywordLevels("bird")).toEqual(["bird"]);
    for (const bad of ["A||B", "|A", "A|", "", "  ", "A| |B"]) expect(keywordLevels(bad), bad).toBeNull();
    expect(normalizeKeyword("  Places |  Europe ")).toBe("Places|Europe");
    expect(normalizeKeyword(" bird ")).toBe("bird");
  });

  it("checks a read-back by the ambiguity rules: a plain name added is the top-level one, a plain name removed goes at every level", () => {
    expect(keywordsNotTaken(["Animals|bird"], ["bird"], [])).toMatch(/without \["bird"\]/);
    expect(keywordsNotTaken(["Animals|bird", "bird"], ["bird"], [])).toBeNull();
    expect(keywordsNotTaken(["Animals|bird"], [], ["bird"])).toMatch(/still with \["bird"\]/);
    expect(keywordsNotTaken(["bird"], [], ["Animals|bird"])).toBeNull();
    expect(keywordsNotTaken(["Places|Europe|Paris"], ["places|europe|PARIS"], [])).toBeNull();
    expect(keywordsNotTaken(["Animals|Bird"], [], ["bird"])).toBeNull(); // a plain name removes by exact name
  });
});

describe("GPS read-back (library\\write.ts gpsNotTaken)", () => {
  it("takes a position within 1e-5 degrees, and a removal only when none is left", () => {
    const at = { latitude: 48.5818, longitude: 7.7509 };
    expect(gpsNotTaken({ latitude: 48.581804, longitude: 7.750896 }, at)).toBeNull();
    expect(gpsNotTaken({ latitude: 48.5819, longitude: 7.7509 }, at)).toBe("Lightroom read back (48.5819, 7.7509), not (48.5818, 7.7509).");
    expect(gpsNotTaken(null, at)).toBe("Lightroom read back no GPS position, not (48.5818, 7.7509).");
    expect(gpsNotTaken(null, null)).toBeNull();
    expect(gpsNotTaken(at, null)).toBe("Lightroom read back (48.5818, 7.7509), not no GPS position.");
  });
});

describe("the argument schemas", () => {
  it("lr_set_keywords: refuses an empty level, a path given twice in two spellings, and one both added and removed", () => {
    const kw = schema("lr_set_keywords");
    expect(kw.safeParse({ uuids: ["A"], add: ["Places|Europe|Paris"] }).success).toBe(true);
    expect(kw.safeParse({ uuids: ["A"], add: ["Places||Paris"] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["|Paris"] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["A|B", "A | B"] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["A|B"], remove: ["A | B"] }).success).toBe(false);
    expect(kw.safeParse({ uuids: ["A"], add: ["x".repeat(101)] }).success).toBe(false);
  });

  it("lr_set_gps: latitude -90..90, longitude -180..180, finite, or null to remove; 1-100 uuids", () => {
    const gps = schema("lr_set_gps");
    const at = (latitude: number, longitude: number) => gps.safeParse({ uuids: ["A"], position: { latitude, longitude } }).success;
    expect(at(-90, 180)).toBe(true);
    expect(at(90, -180)).toBe(true);
    expect(at(90.0001, 0)).toBe(false);
    expect(at(0, -180.5)).toBe(false);
    expect(at(Number.NaN, 0)).toBe(false);
    expect(at(0, Number.POSITIVE_INFINITY)).toBe(false);
    expect(gps.safeParse({ uuids: ["A"], position: null }).success).toBe(true);
    expect(gps.safeParse({ uuids: ["A"] }).success).toBe(false);
    expect(gps.safeParse({ uuids: ["A"], position: { latitude: 1 } }).success).toBe(false);
    expect(gps.safeParse({ uuids: [], position: null }).success).toBe(false);
    expect(gps.safeParse({ uuids: Array.from({ length: 101 }, (_, i) => `U${i}`), position: null }).success).toBe(false);
  });

  it("lr_list_keywords: a non-empty query, a limit of 1-500", () => {
    const list = schema("lr_list_keywords");
    expect(list.safeParse({ query: "bird", limit: 500, offset: 3 }).success).toBe(true);
    expect(list.safeParse({ query: "  " }).success).toBe(false);
    expect(list.safeParse({ limit: 501 }).success).toBe(false);
  });
});

describe("lr_set_keywords with paths", () => {
  it("adds an existing nested keyword and a new path, its missing levels created; sends the paths trimmed", async () => {
    const out = await tools.setKeywords({ uuids: ["SIM-UUID"], add: ["Places|Europe|Paris", "Places | Asia | Tokyo"] });
    expect(sent("set_keywords")[0]).toEqual({ photo_uuid: "SIM-UUID", add: ["Places|Europe|Paris", "Places|Asia|Tokyo"], remove: [] });
    expect(photos(out)).toEqual([
      { uuid: "SIM-UUID", filename: "20260907-_OZ80093.NEF", before: [], after: ["Places|Europe|Paris", "Places|Asia|Tokyo"], changed: true },
    ]);
    expect(out.json["failed"]).toEqual([]);
    expect(lr.library.keywordTree).toEqual(expect.arrayContaining(["Places|Asia", "Places|Asia|Tokyo"]));
  });

  it("settles an ambiguous plain name: added at the top level only, removed at every level", async () => {
    photo("SIM-UUID").keywords = ["Animals|bird"];
    const added = await tools.setKeywords({ uuids: ["SIM-UUID"], add: ["bird"] });
    expect(photos(added)[0]).toMatchObject({ before: ["Animals|bird"], after: ["Animals|bird", "bird"], changed: true });
    const removed = await tools.setKeywords({ uuids: ["SIM-UUID"], remove: ["bird"] });
    expect(photos(removed)[0]).toMatchObject({ before: ["Animals|bird", "bird"], after: [], changed: true });
    expect(removed.json["failed"]).toEqual([]);
  });

  it("removes by path only the keyword at that place, case aside", async () => {
    photo("SIM-LIB-3").keywords = ["bird", "heron", "Animals|bird"];
    const out = await tools.setKeywords({ uuids: ["SIM-LIB-3"], remove: ["animals | BIRD"] });
    expect(photos(out)[0]).toMatchObject({ after: ["bird", "heron"], changed: true });
  });

  it("lists a photo whose read-back still has a deeper keyword of a removed plain name in failed", async () => {
    photo("SIM-LIB-2").keywords = ["bird", "Animals|bird"];
    lr.library.stuckKeywords = ["Animals|bird"];
    const out = await tools.setKeywords({ uuids: ["SIM-LIB-2"], remove: ["bird"] });
    expect(out.json["failed"]).toEqual([
      {
        uuid: "SIM-LIB-2",
        code: "KEYWORDS_NOT_TAKEN",
        message: 'Lightroom read back keywords without [] and still with ["bird"].',
        before: ["bird", "Animals|bird"],
        after: ["Animals|bird"],
      },
    ]);
  });
});

describe("an older plugin (before 0.10.0)", () => {
  const oldPlugin = () => {
    const hello = client.hello() as HelloResult;
    vi.spyOn(client, "hello").mockReturnValue({ ...hello, plugin_version: "0.9.0" });
  };

  it("refuses a keyword path, lr_list_keywords and lr_set_gps before sending anything; plain names still go", async () => {
    oldPlugin();
    for (const call of [
      tools.setKeywords({ uuids: ["SIM-UUID"], add: ["Places|Paris"] }),
      tools.listKeywords(),
      tools.setGps({ uuids: ["SIM-UUID"], position: null }),
    ]) {
      const err = await fails(call);
      expect(err.code).toBe("PLUGIN_TOO_OLD");
      expect(err.message).toMatch(/plugin 0\.10\.0 or later.*Lightroom runs 0\.9\.0/);
    }
    expect([...sent("set_keywords"), ...sent("list_keywords"), ...sent("set_gps")]).toEqual([]);
    const plain = await tools.setKeywords({ uuids: ["SIM-UUID"], add: ["pond"] });
    expect(photos(plain)[0]).toMatchObject({ after: ["pond"] });
  });
});

describe("lr_list_keywords", () => {
  it("lists the tree as paths, a parent before its children, siblings by name", async () => {
    const out = await tools.listKeywords();
    expect(sent("list_keywords")[0]).toEqual({ offset: 0, limit: 100 });
    expect(out.json).toEqual({
      count: 7,
      offset: 0,
      returned: 7,
      has_more: false,
      keywords: ["Animals", "Animals|bird", "bird", "heron", "Places", "Places|Europe", "Places|Europe|Paris"],
    });
  });

  it("says when the page is truncated and how to get the rest; filters by query, case aside", async () => {
    const page = await tools.listKeywords({ limit: 2 });
    expect(page.json).toMatchObject({ count: 7, returned: 2, has_more: true, keywords: ["Animals", "Animals|bird"] });
    expect(page.json["truncated"]).toBe("2 of 7 keywords from offset 0: call again with offset 2, or narrow with query.");
    const found = await tools.listKeywords({ query: "BIRD" });
    expect(sent("list_keywords")[1]).toEqual({ query: "BIRD", offset: 0, limit: 100 });
    expect(found.json).toMatchObject({ count: 2, keywords: ["Animals|bird", "bird"], has_more: false });
    expect(found.json["truncated"]).toBeUndefined();
  });
});

describe("lr_set_gps", () => {
  it("sets a position on each photo, with before and after (null for none)", async () => {
    const out = await tools.setGps({ uuids: ["SIM-UUID", "SIM-LIB-2"], position: { latitude: 48.5818, longitude: 7.7509 } });
    expect(sent("set_gps")).toEqual([
      { photo_uuid: "SIM-UUID", latitude: 48.5818, longitude: 7.7509 },
      { photo_uuid: "SIM-LIB-2", latitude: 48.5818, longitude: 7.7509 },
    ]);
    expect(out.json).toMatchObject({ position: { latitude: 48.5818, longitude: 7.7509 }, changed: 2, failed: [] });
    expect(photos(out).map((p) => [p.before, p.after])).toEqual([
      [null, { latitude: 48.5818, longitude: 7.7509 }],
      [{ latitude: 47.6062, longitude: -122.3321 }, { latitude: 48.5818, longitude: 7.7509 }],
    ]);
  });

  it("removes a position with null, and writes nothing to a photo that has none", async () => {
    const out = await tools.setGps({ uuids: ["SIM-LIB-2", "SIM-LIB-3"], position: null });
    expect(sent("set_gps")).toEqual([
      { photo_uuid: "SIM-LIB-2", clear: true },
      { photo_uuid: "SIM-LIB-3", clear: true },
    ]);
    expect(photos(out).map((p) => [p.before, p.after, p.changed])).toEqual([
      [{ latitude: 47.6062, longitude: -122.3321 }, null, true],
      [null, null, false],
    ]);
    expect(lr.library.writes).toBe(1);
  });

  it("lists a position not taken in failed, and keeps `before` when the write gate or the read-back fails", async () => {
    lr.library.dropGps = true;
    const dropped = await tools.setGps({ uuids: ["SIM-LIB-2"], position: null });
    expect(dropped.json["failed"]).toEqual([
      {
        uuid: "SIM-LIB-2",
        code: "GPS_NOT_TAKEN",
        message: "Lightroom read back (47.6062, -122.3321), not no GPS position.",
        before: { latitude: 47.6062, longitude: -122.3321 },
        after: { latitude: 47.6062, longitude: -122.3321 },
      },
    ]);
    lr.library.dropGps = false;
    lr.library.readBackError = "getRawMetadata: catalog busy";
    const lost = (await tools.setGps({ uuids: ["SIM-UUID"], position: { latitude: 1, longitude: 2 } })).json["failed"] as Array<Record<string, unknown>>;
    expect(lost).toEqual([expect.objectContaining({ uuid: "SIM-UUID", code: "READ_BACK_FAILED", before: null })]);
    expect(lost[0]?.["message"]).toMatch(/could not read the GPS position back: getRawMetadata: catalog busy/);
    lr.library.readBackError = null;
    lr.library.writeError = "blocked by another write access call";
    const raised = (await tools.setGps({ uuids: ["SIM-LIB-3"], position: { latitude: 1, longitude: 2 } })).json["failed"] as Array<Record<string, unknown>>;
    expect(raised).toEqual([expect.objectContaining({ uuid: "SIM-LIB-3", code: "WRITE_FAILED", before: null, after: { latitude: 1, longitude: 2 } })]);
  });

  it("is refused while a session is open, and sends nothing", async () => {
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.setGps({ uuids: ["SIM-LIB-2"], position: null }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent("set_gps")).toEqual([]);
    expect((await tools.listKeywords({ query: "paris" })).json["count"]).toBe(1);
  });
});
