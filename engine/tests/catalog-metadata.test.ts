// GitHub issues #111, #112, #139 gaps 2 and 4 (engine 0.33.0, plugin 0.22.0): lr_set_flag,
// lr_set_iptc, lr_get_metadata and lr_search_photos' folder, through the Tools class against the
// simulated Lightroom (lightroom-sim-metadata.ts, lightroom-sim-library.ts), plus the helpers
// (library\metadata.ts) and the argument schemas.

import { afterEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { flagName, folderPath, textNotTaken } from "../src/library/index.js";
import { CATALOG_DEFS } from "../src/mcp/defs-catalog.js";
import { METADATA_DEFS } from "../src/mcp/defs-metadata.js";
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
const schema = (name: string) => [...CATALOG_DEFS, ...METADATA_DEFS].find((d) => d.name === name)?.schema as (typeof CATALOG_DEFS)[number]["schema"];
const photo = (uuid: string) => lr.library.photos.find((p) => p.uuid === uuid) as (typeof lr.library.photos)[number];
const photos = (out: ToolOutput) => out.json["photos"] as Array<Record<string, unknown>>;
const EMPTY = { title: "", caption: "", headline: "" };

describe("the helpers (library\\metadata.ts)", () => {
  it("names pickStatus values, drops trailing separators from a folder but keeps a drive root, and checks a text read-back", () => {
    expect([flagName(1), flagName(0), flagName(-1), flagName(2)]).toEqual(["pick", "none", "reject", 2]);
    expect(folderPath(" D:\\Photos\\2026\\ ")).toBe("D:\\Photos\\2026");
    expect(folderPath("D:/Photos//")).toBe("D:/Photos");
    expect(folderPath("D:\\")).toBe("D:\\");
    expect(textNotTaken({ title: "a", caption: "b", headline: "" }, { title: "a", headline: "" })).toBeNull();
    expect(textNotTaken({ title: "a ", caption: "b", headline: "" }, { title: "a", caption: "b" })).toBe('Lightroom read back title "a ", not what was written.');
  });
});

describe("the argument schemas", () => {
  it("lr_set_flag takes pick, reject or none; lr_set_iptc at least one field of at most 2000 characters", () => {
    const flag = schema("lr_set_flag");
    for (const f of ["pick", "reject", "none"]) expect(flag.safeParse({ uuids: ["A"], flag: f }).success).toBe(true);
    expect(flag.safeParse({ uuids: ["A"], flag: 1 }).success).toBe(false);
    const iptc = schema("lr_set_iptc");
    expect(iptc.safeParse({ uuids: ["A"], caption: "" }).success).toBe(true);
    expect(iptc.safeParse({ uuids: ["A"], title: "x".repeat(2000) }).success).toBe(true);
    expect(iptc.safeParse({ uuids: ["A"], title: "x".repeat(2001) }).success).toBe(false);
    expect(iptc.safeParse({ uuids: ["A"] }).success).toBe(false);
  });

  it("lr_search_photos: include_subfolders needs a folder", () => {
    const search = schema("lr_search_photos");
    expect(search.safeParse({ folder: "D:\\Photos", include_subfolders: true }).success).toBe(true);
    expect(search.safeParse({ include_subfolders: false }).success).toBe(false);
    expect(search.safeParse({ folder: "  " }).success).toBe(false);
  });
});

describe("lr_set_flag", () => {
  it("flags each photo, with before and after by name, and writes nothing to a photo that already holds the flag", async () => {
    photo("SIM-LIB-3").flag = 1;
    const out = await tools.setFlag({ uuids: ["SIM-UUID", "SIM-LIB-3"], flag: "pick" });
    expect(sent("set_flag")).toEqual([
      { photo_uuid: "SIM-UUID", flag: 1 },
      { photo_uuid: "SIM-LIB-3", flag: 1 },
    ]);
    expect(out.json).toMatchObject({ flag: "pick", changed: 1, failed: [] });
    expect(photos(out).map((p) => [p["before"], p["after"], p["changed"]])).toEqual([
      ["none", "pick", true],
      ["pick", "pick", false],
    ]);
    expect(lr.library.metadata.writes).toBe(1);
  });

  it("lists a flag not taken in failed", async () => {
    lr.library.metadata.dropWrites = true;
    const out = await tools.setFlag({ uuids: ["SIM-LIB-2"], flag: "reject" });
    expect(out.json["failed"]).toEqual([
      { uuid: "SIM-LIB-2", code: "FLAG_NOT_TAKEN", message: "Lightroom read back flag none, not reject.", before: "none", after: "none" },
    ]);
  });

  it("is refused while a session is open, and sends nothing", async () => {
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails(tools.setFlag({ uuids: ["SIM-LIB-2"], flag: "pick" }))).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(sent("set_flag")).toEqual([]);
  });
});

describe("lr_set_iptc", () => {
  it("sends only the fields given, and \"\" empties one", async () => {
    photo("SIM-LIB-2").caption = "old caption";
    const out = await tools.setIptc({ uuids: ["SIM-LIB-2"], title: "Heron at dawn", caption: "" });
    expect(sent("set_iptc")).toEqual([{ photo_uuid: "SIM-LIB-2", title: "Heron at dawn", caption: "" }]);
    expect(out.json).toMatchObject({ written: { title: "Heron at dawn", caption: "" }, changed: 1, failed: [] });
    expect(photos(out)[0]).toMatchObject({
      before: { ...EMPTY, caption: "old caption" },
      after: { ...EMPTY, title: "Heron at dawn" },
      changed: true,
    });
  });

  it("lists text not taken in failed, naming the field", async () => {
    lr.library.metadata.dropWrites = true;
    const out = await tools.setIptc({ uuids: ["SIM-UUID"], headline: "News" });
    expect(out.json["failed"]).toEqual([
      { uuid: "SIM-UUID", code: "IPTC_NOT_TAKEN", message: 'Lightroom read back headline "", not what was written.', before: EMPTY, after: EMPTY },
    ]);
  });
});

describe("lr_get_metadata", () => {
  it("reads each photo: text, flag by name, keywords, gps and stack (null for none); an unknown uuid in failed", async () => {
    Object.assign(photo("SIM-LIB-2"), { title: "T", flag: -1, stack: { position: 2, count: 2, collapsed: false, top_uuid: "SIM-LIB-3" } });
    const out = await tools.getMetadata({ uuids: ["SIM-LIB-2", "SIM-UUID", "NOPE"] });
    expect(photos(out)).toEqual([
      {
        uuid: "SIM-LIB-2",
        filename: "20260907-_OZ80099.NEF",
        ...EMPTY,
        title: "T",
        flag: "reject",
        keywords: ["bird"],
        gps: { latitude: 47.6062, longitude: -122.3321 },
        stack: { position: 2, count: 2, collapsed: false, top_uuid: "SIM-LIB-3" },
      },
      { uuid: "SIM-UUID", filename: "20260907-_OZ80093.NEF", ...EMPTY, flag: "none", keywords: [], gps: null, stack: null },
    ]);
    expect(out.json["failed"]).toEqual([{ uuid: "NOPE", code: "UNKNOWN_PHOTO", message: "no photo in the catalog has uuid NOPE" }]);
  });

  it("passes on the parts the plugin could not read, and runs while a session is open", async () => {
    await tools.beginSession({ intent_id: "test_plain", return_image: "none" });
    lr.library.metadata.keywordsError = "catalog busy";
    const [one] = photos(await tools.getMetadata({ uuids: ["SIM-LIB-3"] }));
    expect(one?.["errors"]).toEqual(["keywords: catalog busy"]);
    expect(one?.["keywords"]).toBeUndefined();
  });
});

describe("lr_search_photos with a folder", () => {
  it("sends the folder without trailing separators and keeps only its photos; subfolders on request", async () => {
    photo("SIM-LIB-3").folder = "D:\\Photos\\Herons";
    const top = await tools.searchPhotos({ folder: "D:\\Photos\\" });
    expect(sent("search_photos")[0]).toEqual({ criteria: [], folder: "D:\\Photos", include_subfolders: false, offset: 0, limit: 100 });
    expect(photos(top).map((p) => p["uuid"])).toEqual(["SIM-UUID", "SIM-LIB-2"]);
    expect(top.json["warning"]).toBeUndefined();
    const all = await tools.searchPhotos({ folder: "D:\\Photos", include_subfolders: true, rating: 5 });
    expect(photos(all).map((p) => p["uuid"])).toEqual(["SIM-LIB-3"]);
  });

  it("refuses a folder the catalog does not have with UNKNOWN_FOLDER", async () => {
    expect((await fails(tools.searchPhotos({ folder: "E:\\Nowhere" }))).code).toBe("UNKNOWN_FOLDER");
  });
});

describe("an older plugin (before 0.22.0)", () => {
  it("refuses the three tools and a folder search before sending anything; a search without a folder still runs", async () => {
    const hello = client.hello() as HelloResult;
    vi.spyOn(client, "hello").mockReturnValue({ ...hello, plugin_version: "0.21.0" });
    for (const call of [
      tools.setFlag({ uuids: ["SIM-UUID"], flag: "pick" }),
      tools.setIptc({ uuids: ["SIM-UUID"], title: "x" }),
      tools.getMetadata({ uuids: ["SIM-UUID"] }),
      tools.searchPhotos({ folder: "D:\\Photos" }),
    ]) {
      const err = await fails(call);
      expect(err.code).toBe("PLUGIN_TOO_OLD");
      expect(err.message).toMatch(/plugin 0\.22\.0 or later.*Lightroom runs 0\.21\.0/);
    }
    expect([...sent("set_flag"), ...sent("set_iptc"), ...sent("get_metadata"), ...sent("search_photos")]).toEqual([]);
    expect((await tools.searchPhotos({ rating: 5 })).json["count"]).toBe(1);
  });
});
