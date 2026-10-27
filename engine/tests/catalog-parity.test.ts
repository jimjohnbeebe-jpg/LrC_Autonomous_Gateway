// GitHub issue #218 rows 1-8 (plugin 1.5.0): the Library search filters, lr_set_color_label, lr_set_iptc's new
// fields, lr_get_metadata's additions, collections by name, lr_create_smart_collection, lr_delete_collection,
// lr_list_folders, lr_rename_keyword, lr_remove_keyword_subtree and lr_export_metadata, through the Tools class
// against the simulated Lightroom; the plugin's new commands are stand-ins set here (what Lightroom does is
// Jim's catalog:check, docs\reports\phase11\CATALOG-PARITY.md).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchCriteria } from "../src/library/index.js";
import { CATALOG_DEFS } from "../src/mcp/defs-catalog.js";
import { ORGANIZE_DEFS } from "../src/mcp/defs-organize.js";
import { toToolError, type ToolError } from "../src/mcp/index.js";
import { createSmartCollection, deleteCollection } from "../src/mcp/tools-collections.js";
import { listFolders } from "../src/mcp/tools-catalog.js";
import { exportMetadata } from "../src/mcp/tools-export-metadata.js";
import { removeKeywordSubtree, renameKeyword } from "../src/mcp/tools-keywords.js";
import { setColorLabel } from "../src/mcp/tools-metadata.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { lr, plugin, sent, tmp, tools, useSyncHarness } from "./helpers/sync-harness.js";

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
const ok = (payload: unknown) => ({ ok: true as const, payload });
const schema = (name: string) => [...CATALOG_DEFS, ...ORGANIZE_DEFS].find((d) => d.name === name)?.schema as (typeof CATALOG_DEFS)[number]["schema"];
const photos = (out: ToolOutput) => out.json["photos"] as Array<Record<string, unknown>>;

describe("row 1: the Library filters", () => {
  it("builds findPhotos entries for camera, lens, ISO, focal length, flag, label, edits and file type", () => {
    expect(searchCriteria({ camera: "ILCE-7M3", lens: "FE 24-70mm", iso: 400, focal_length: 50, flag: "reject", color_label: "red", edited: false, file_type: "DNG" })).toEqual([
      { criteria: "camera", operation: "==", value: "ILCE-7M3" },
      { criteria: "lens", operation: "==", value: "FE 24-70mm" },
      { criteria: "isoSpeedRating", operation: "==", value: 400 },
      { criteria: "focalLength", operation: "==", value: 50 },
      { criteria: "pick", operation: "==", value: -1 },
      { criteria: "labelColor", operation: "==", value: 1 },
      { criteria: "hasAdjustments", operation: "isFalse", value: false },
      { criteria: "fileFormat", operation: "==", value: "DNG" },
    ]);
    expect(searchCriteria({ color_label: "none", edited: true })).toEqual([
      { criteria: "labelColor", operation: "==", value: "none" },
      { criteria: "hasAdjustments", operation: "isTrue", value: true },
    ]);
  });

  it("passes them to search_photos with the others, and takes no collection with a collection_id", async () => {
    plugin.handlers.set("search_photos", () => ok({ count: 0, photos: [] }));
    await tools.searchPhotos({ rating: 3, camera: "Z 8" });
    expect(sent("search_photos")[0]).toMatchObject({ criteria: [{ criteria: "rating", value: 3 }, { criteria: "camera", value: "Z 8" }] });
    expect(schema("lr_search_photos").safeParse({ collection: "Birds", collection_id: 501 }).success).toBe(false);
    expect(schema("lr_search_photos").safeParse({ file_type: "NEF" }).success).toBe(false);
  });
});

describe("row 7: collections by name", () => {
  it("finds a collection by its set path or its name, case aside, and lists its members as search_photos' collection_id", async () => {
    await tools.searchPhotos({ collection: "best / 2026 / FIVE STARS" });
    await tools.searchPhotos({ collection: "five stars" });
    expect(sent("search_photos").map((p) => p["collection_id"])).toEqual([502, 502]);
  });

  it("refuses a name two collections share, with the candidates; a set path, or a top-level collection's own name, still finds one", async () => {
    lr.library.collections.push({ local_id: 503, name: "Owls", set_path: "2025", smart: false, photos: [] }, { local_id: 504, name: "Owls", set_path: "2026", smart: true, photos: [] });
    lr.library.collections.push({ local_id: 505, name: "Birds", set_path: "2025", smart: false, photos: [] });
    const e = await fails(tools.searchPhotos({ collection: "Owls" }));
    expect(e.code).toBe("AMBIGUOUS_COLLECTION");
    expect((e.details as { candidates: unknown[] }).candidates).toEqual([
      { id: 503, name: "Owls", set: "2025", smart: false },
      { id: 504, name: "Owls", set: "2026", smart: true },
    ]);
    await tools.searchPhotos({ collection: "2026/Owls" });
    await tools.searchPhotos({ collection: "Birds" });
    expect(sent("search_photos").map((p) => p["collection_id"])).toEqual([504, 501]);
    expect((await fails(tools.searchPhotos({ collection: "Nope" }))).code).toBe("UNKNOWN_COLLECTION");
  });

  it("lr_create_smart_collection sends the filters as rules and needs one", async () => {
    plugin.handlers.set("create_smart_collection", (p) => ok({ local_id: 600, name: p["name"], set_path: "Best", smart: true, photo_count: 4, created: true }));
    const out = await tools.call(createSmartCollection, { name: " Reds ", set: "Best", color_label: "red", rating: 5 });
    expect(sent("create_smart_collection")).toEqual([{ name: "Reds", set_path: ["Best"], criteria: [{ criteria: "rating", operation: "==", value: 5 }, { criteria: "labelColor", operation: "==", value: 1 }] }]);
    expect(out.json).toMatchObject({ id: 600, smart: true, photo_count: 4, undo: expect.stringContaining("lr_delete_collection with collection_id 600") });
    expect((await fails(tools.call(createSmartCollection, { name: "All" }))).code).toBe("BAD_ARGUMENTS");
  });

  it("lr_delete_collection needs confirm, finds the collection by name, and returns what makes it again", async () => {
    plugin.handlers.set("delete_collection", (p) =>
      ok({ before: { local_id: p["collection_id"], name: "Birds", smart: false, photo_count: 2, member_uuids: ["SIM-LIB-2", "SIM-LIB-3"], members_truncated: false }, deleted: true }),
    );
    expect((await fails(tools.call(deleteCollection, { collection: "Birds", confirm: false }))).code).toBe("CONFIRM_REQUIRED");
    expect(sent("delete_collection")).toEqual([]);
    const out = await tools.call(deleteCollection, { collection: "birds", confirm: true });
    expect(sent("delete_collection")).toEqual([{ collection_id: 501 }]);
    expect(out.json).toMatchObject({ deleted: true, before: { id: 501, name: "Birds", set: null, member_uuids: ["SIM-LIB-2", "SIM-LIB-3"] }, undo: expect.stringContaining("lr_add_to_collection") });
    const del = ORGANIZE_DEFS.find((d) => d.name === "lr_delete_collection");
    expect(del?.annotations).toMatchObject({ destructiveHint: true });
    expect(del?.schema.safeParse({ collection_id: 1, collection: "x", confirm: true }).success).toBe(false);
  });
});

describe("rows 2-4: colour labels, text fields, metadata", () => {
  beforeEach(() => {
    const labels = new Map<string, string>();
    plugin.handlers.set("set_color_label", (p) => {
      const uuid = String(p["photo_uuid"]);
      const before = labels.get(uuid) ?? "none";
      labels.set(uuid, String(p["label"]));
      return ok({ uuid, filename: "x.NEF", before, after: labels.get(uuid) });
    });
  });

  it("lr_set_color_label writes each photo and gives before and after with an undo hint", async () => {
    const out = await tools.call(setColorLabel, { uuids: ["SIM-UUID", "SIM-LIB-2"], label: "green" });
    expect(sent("set_color_label")).toEqual([{ photo_uuid: "SIM-UUID", label: "green" }, { photo_uuid: "SIM-LIB-2", label: "green" }]);
    expect(photos(out).map((p) => [p["before"], p["after"]])).toEqual([["none", "green"], ["none", "green"]]);
    expect(out.json).toMatchObject({ changed: 2, undo: expect.stringContaining("lr_set_color_label") });
  });

  it("lr_set_iptc sends the new fields by SDK key and answers by tool name", async () => {
    const held: Record<string, string> = { title: "", location: "", isoCountryCode: "" };
    plugin.handlers.set("set_iptc", (p) => {
      const before = { ...held };
      for (const [k, v] of Object.entries(p)) if (k !== "photo_uuid") held[k] = String(v);
      return ok({ uuid: p["photo_uuid"], before, after: { ...held } });
    });
    const out = await tools.setIptc({ uuids: ["SIM-UUID"], sublocation: "Pike Place", iso_country_code: "USA" });
    expect(sent("set_iptc")).toEqual([{ photo_uuid: "SIM-UUID", location: "Pike Place", isoCountryCode: "USA" }]);
    expect(photos(out)[0]).toMatchObject({ before: { title: "", sublocation: "", iso_country_code: "" }, after: { sublocation: "Pike Place", iso_country_code: "USA" } });
  });

  it("lr_set_iptc lists a field Lightroom did not read back in failed", async () => {
    plugin.handlers.set("set_iptc", (p) => ok({ uuid: p["photo_uuid"], before: { title: "" }, after: { title: "" } }));
    const out = await tools.setIptc({ uuids: ["SIM-UUID"], alt_text: "A heron" });
    expect(out.json["failed"]).toMatchObject([{ code: "IPTC_NOT_TAKEN", message: expect.stringContaining("alt_text (not read)") }]);
  });

  it("lr_get_metadata gives the location and accessibility fields by tool name, with label, rating and copy name", async () => {
    plugin.handlers.set("get_metadata", (p) =>
      ok({ uuid: p["photo_uuid"], filename: "x.NEF", title: "T", location: "Pike Place", stateProvince: "WA", altTextAccessibility: "A heron", label: "red", rating: 3, copy_name: "Copy 1", virtual_copy: true, flag: 1, gps: false, stack: false }),
    );
    const out = await tools.getMetadata({ uuids: ["SIM-UUID"] });
    const p = photos(out)[0] as Record<string, unknown>;
    expect(p).toMatchObject({ title: "T", sublocation: "Pike Place", state: "WA", alt_text: "A heron", label: "red", rating: 3, copy_name: "Copy 1", virtual_copy: true, flag: "pick" });
    expect(p).not.toHaveProperty("location");
    expect(p).not.toHaveProperty("altTextAccessibility");
  });
});

describe("row 6: lr_list_folders", () => {
  it("pages the folder tree", async () => {
    plugin.handlers.set("list_folders", (p) => ok({ count: 3, folders: [{ path: "D:\\Photos", name: "Photos", depth: 0, photo_count: 3 }].slice(Number(p["offset"])) }));
    const out = await tools.call(listFolders, { limit: 1 });
    expect(sent("list_folders")).toEqual([{ offset: 0, limit: 1 }]);
    expect(out.json).toMatchObject({ count: 3, returned: 1, has_more: true, folders: [{ path: "D:\\Photos", photo_count: 3 }] });
  });
});

describe("row 5: keywords", () => {
  it("lr_rename_keyword renames by path and says how to put it back", async () => {
    plugin.handlers.set("rename_keyword", (p) => ok({ before: "Animals|bird", after: `Animals|${String(p["new_name"])}`, photo_count: 1 }));
    const out = await tools.call(renameKeyword, { path: "Animals | bird", new_name: " Bird " });
    expect(sent("rename_keyword")).toEqual([{ path: "Animals|bird", new_name: "Bird" }]);
    expect(out.json).toMatchObject({ before: "Animals|bird", after: "Animals|Bird", photo_count: 1, undo: expect.stringContaining('new_name "bird"') });
  });

  it("lr_rename_keyword fails when the read-back is not the new name", async () => {
    plugin.handlers.set("rename_keyword", () => ok({ before: "bird", after: "bird (renaming)", photo_count: 0, write_error: "Lightroom refused the name Bird" }));
    const e = await fails(tools.call(renameKeyword, { path: "bird", new_name: "Bird" }));
    expect(e.code).toBe("KEYWORD_NOT_RENAMED");
    expect(e.details).toEqual({ before: "bird", after: "bird (renaming)" });
  });

  it("lr_remove_keyword_subtree takes the subtree off the selected photos through set_keywords", async () => {
    photoKeywords("SIM-UUID", ["Animals|bird", "heron"]);
    plugin.handlers.set("keyword_subtree", () => ok({ paths: ["Animals", "Animals|bird"] }));
    const out = await tools.call(removeKeywordSubtree, { path: "Animals" });
    expect(sent("keyword_subtree")).toEqual([{ path: "Animals", photos: false }]);
    expect(sent("set_keywords")).toEqual([{ photo_uuid: "SIM-UUID", add: [], remove: ["Animals", "Animals|bird"] }]);
    expect(photos(out)[0]).toMatchObject({ before: ["Animals|bird", "heron"], after: ["heron"], changed: true });
    expect(out.json).toMatchObject({ keywords: ["Animals", "Animals|bird"], undo: expect.stringContaining("lr_set_keywords") });
  });

  it("catalog_wide needs confirm, then takes the holders from keyword_subtree; a spent budget leaves the rest for the next call", async () => {
    plugin.handlers.set("keyword_subtree", () => ok({ paths: ["bird"], uuids: ["SIM-LIB-2", "SIM-LIB-3"], photo_count: 2 }));
    expect((await fails(tools.call(removeKeywordSubtree, { path: "bird", catalog_wide: true }))).code).toBe("CONFIRM_REQUIRED");
    const out = await tools.call((ctx, a: Parameters<typeof removeKeywordSubtree>[1]) => removeKeywordSubtree(ctx, a, -1), { path: "bird", catalog_wide: true, confirm: true });
    expect(sent("keyword_subtree")).toEqual([{ path: "bird", photos: true }]);
    expect(sent("set_keywords").map((p) => p["photo_uuid"])).toEqual(["SIM-LIB-2", "SIM-LIB-3"]);
    expect(out.json).toMatchObject({ changed: 2 });
    expect(out.json).not.toHaveProperty("remaining");
  });
});

/** Puts `paths` on the sim photo and selects it alone. */
function photoKeywords(uuid: string, paths: string[]): void {
  const photo = lr.library.photos.find((p) => p.uuid === uuid);
  if (photo) photo.keywords = paths;
  plugin.handlers.set("get_selection", () => ok({ count: 1, photos: [{ uuid, local_id: 1, filename: "x.NEF" }] }));
}

describe("row 8: lr_export_metadata", () => {
  beforeEach(() => {
    plugin.handlers.set("get_metadata", (p) => ok({ uuid: p["photo_uuid"], filename: "x.NEF", title: "T", keywords: ["Places|Paris"], flag: 0, gps: false, stack: false }));
  });

  it("writes a new JSON file each call, never over another, and refuses a relative folder", async () => {
    const folder = path.join(tmp, "meta");
    const a = await tools.call(exportMetadata, { uuids: ["SIM-UUID", "SIM-LIB-2"], folder });
    const file = a.json["file"] as string;
    expect(path.dirname(file)).toBe(folder);
    const body = JSON.parse(readFileSync(file, "utf8")) as { count: number; photos: Array<Record<string, unknown>> };
    expect(body.count).toBe(2);
    expect(body.photos[0]).toMatchObject({ uuid: "SIM-UUID", title: "T", keywords: ["Places|Paris"], flag: "none", gps: null });
    vi.useFakeTimers({ now: Date.parse("2026-10-27T12:00:00Z"), toFake: ["Date"] });
    const b = await tools.call(exportMetadata, { uuids: ["SIM-UUID"], folder });
    expect((await fails(tools.call(exportMetadata, { uuids: ["SIM-UUID"], folder }))).code).toBe("FILE_EXISTS");
    vi.useRealTimers();
    expect(b.json["file"]).not.toBe(file);
    expect(existsSync(file)).toBe(true);
    expect((await fails(tools.call(exportMetadata, { folder: "relative\\x" }))).code).toBe("BAD_ARGUMENTS");
  });

  it("exports the selection when no uuid is named, and lists photos past the budget in not_yet", async () => {
    photoKeywords("SIM-LIB-3", []);
    const out = await tools.call((ctx, a: { folder: string }) => exportMetadata(ctx, a, -1), { folder: path.join(tmp, "sel") });
    expect(out.json).toMatchObject({ exported: 1 });
    plugin.handlers.set("get_selection", () => ok({ count: 2, photos: [{ uuid: "SIM-UUID", local_id: 1 }, { uuid: "SIM-LIB-2", local_id: 2 }] }));
    const cut = await tools.call((ctx, a: { folder: string }) => exportMetadata(ctx, a, -1), { folder: path.join(tmp, "sel") });
    expect(cut.json).toMatchObject({ exported: 1, not_yet: ["SIM-LIB-2"] });
  });
});
