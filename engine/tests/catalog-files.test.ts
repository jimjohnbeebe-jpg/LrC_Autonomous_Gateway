// GitHub issue #55 (engine 0.17.0, plugin 0.17.0): lr_create_collection, lr_add_to_collection,
// lr_export_photos and lr_import_photos through the Tools class against the simulated Lightroom
// (lightroom-sim-files.ts), plus the disk side (library\files.ts) on real temp folders.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BridgeError, type CommandName, type HelloResult } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { copyForImport, importFiles, placeExport } from "../src/library/index.js";
import { FILE_DEFS } from "../src/mcp/defs-files.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import type { ToolOutput } from "../src/mcp/tools-shared.js";
import { PreviewService } from "../src/preview/index.js";
import { client, logDir, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

let tools: Tools;
let exportDir: string;
beforeEach(() => {
  exportDir = path.join(tmp, "exports");
  lr.files.exportDir = exportDir;
  tools = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    exportDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
});

const fails = async (p: Promise<ToolOutput>): Promise<ToolError> => {
  try {
    await p;
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected the call to fail");
};
const schema = (name: string) => FILE_DEFS.find((d) => d.name === name)?.schema as (typeof FILE_DEFS)[number]["schema"];
/** A clock that moves `step` ms each time it is read: the budget runs out after a few photos. */
const ticking = (step: number, ms: number) => {
  let t = 0;
  return { now: () => (t += step), ms };
};
const sent = (name: string) => plugin.received.filter((r) => r.name === name).map((r) => r.payload);

describe("lr_create_collection", () => {
  it("creates one at the top level or in sets, and returns an existing one (case aside) without making it again", async () => {
    const made = await tools.createCollection({ name: "Ella's Wedding" });
    expect(made.json).toMatchObject({ name: "Ella's Wedding", set: null, created: true });
    const again = await tools.createCollection({ name: "ella's wedding" });
    expect(again.json).toMatchObject({ id: made.json["id"], created: false });
    const nested = await tools.createCollection({ name: "2026-10-04", set: " 2026 / Trips " });
    expect(nested.json).toMatchObject({ set: "2026 / Trips", created: true });
    expect(sent("create_collection").at(-1)).toEqual({ name: "2026-10-04", set_path: ["2026", "Trips"] });
  });

  it("refuses a smart collection's name, and an empty set level", async () => {
    expect((await fails(tools.createCollection({ name: "five stars", set: "Best / 2026" }))).code).toBe("SMART_COLLECTION");
    expect(schema("lr_create_collection").safeParse({ name: "x", set: "2026 / / Trips" }).success).toBe(false);
  });

  it("refuses an older plugin before sending anything", async () => {
    const hello = client.hello() as HelloResult;
    vi.spyOn(client, "hello").mockReturnValue({ ...hello, plugin_version: "0.16.0" });
    expect((await fails(tools.createCollection({ name: "x" }))).code).toBe("PLUGIN_TOO_OLD");
    expect(sent("create_collection")).toEqual([]);
  });
});

describe("lr_add_to_collection", () => {
  it("adds, reports what was already there and what has no photo, and removes again", async () => {
    const birds = 501;
    const added = await tools.addToCollection({ collection_id: birds, uuids: ["SIM-UUID", "SIM-LIB-2", "NOPE"] });
    expect(added.json).toMatchObject({ added: ["SIM-UUID"], unchanged: ["SIM-LIB-2"], not_found: ["NOPE"] });
    const removed = await tools.addToCollection({ collection_id: birds, uuids: ["SIM-UUID"], remove: true });
    expect(removed.json).toMatchObject({ removed: ["SIM-UUID"], unchanged: [] });
    expect(lr.library.collections.find((c) => c.local_id === birds)?.photos).toEqual(["SIM-LIB-2", "SIM-LIB-3"]);
  });

  it("names the photos Lightroom read back unchanged", async () => {
    lr.files.dropCollection = true;
    const out = await tools.addToCollection({ collection_id: 501, uuids: ["SIM-UUID"] });
    expect(out.json).toMatchObject({ added: [], not_taken: ["SIM-UUID"] });
  });

  it("refuses a smart collection", async () => {
    expect((await fails(tools.addToCollection({ collection_id: 502, uuids: ["SIM-UUID"] }))).code).toBe("SMART_COLLECTION");
  });
});

describe("lr_export_photos", () => {
  it("moves each photo's files into the folder, renames on a clash, and removes the plugin's folder", async () => {
    const folder = path.join(tmp, "out", "Ella Wedding Exports");
    const first = await tools.exportPhotos({ uuids: ["SIM-LIB-2", "SIM-LIB-3"], folder, format: "png", width: 2040, height: 1080 });
    expect(sent("export_photo")[0]).toEqual({ photo_uuid: "SIM-LIB-2", format: "png", width: 2040, height: 1080 });
    expect(readdirSync(folder).sort()).toEqual(["20260907-_OZ80099.png", "20260908-_OZ80100.png"]);
    expect(first.json["not_yet"]).toBeUndefined();
    const again = await tools.exportPhotos({ uuids: ["SIM-LIB-2"], folder, format: "png" });
    const files = (again.json["exported"] as Array<{ files: Array<{ file: string; status: string }> }>)[0]?.files;
    expect(files).toEqual([{ file: path.join(folder, "20260907-_OZ80099-2.png"), status: "renamed" }]);
    const skipped = await tools.exportPhotos({ uuids: ["SIM-LIB-2"], folder, format: "png", on_existing: "skip" });
    expect((skipped.json["exported"] as Array<{ files: Array<{ status: string }> }>)[0]?.files[0]?.status).toBe("skipped");
    expect(readdirSync(exportDir)).toEqual([]);
  });

  it("stops starting photos when the time is up and lists the rest, and lists a missing photo as failed", async () => {
    const folder = path.join(tmp, "out2");
    const out = await tools.exportPhotos({ uuids: ["NOPE", "SIM-LIB-2", "SIM-LIB-3"], folder, format: "jpeg", quality: 80 }, ticking(10, 15));
    expect(out.json["failed"]).toMatchObject([{ uuid: "NOPE", code: "UNKNOWN_PHOTO" }]);
    expect(out.json["not_yet"]).toEqual(["SIM-LIB-3"]);
    expect(out.json["next"]).toMatch(/call again with uuids = not_yet/);
  });

  it("stops at a photo Lightroom did not answer for, naming it and what was done", async () => {
    const real = client.request.bind(client);
    vi.spyOn(client, "request").mockImplementation(((name: CommandName, payload: Record<string, unknown>, options?: { timeoutMs?: number }) =>
      payload["photo_uuid"] === "SIM-LIB-3"
        ? Promise.reject(new BridgeError("timeout", "export_photo: no response", true, "export_photo"))
        : real(name, payload as never, options)) as typeof client.request);
    const e = await fails(tools.exportPhotos({ uuids: ["SIM-LIB-2", "SIM-LIB-3", "SIM-UUID"], folder: path.join(tmp, "out3"), format: "jpeg" }, { now: () => 0, ms: 1e9 }));
    expect(e.code).toBe("BRIDGE_TIMEOUT");
    expect(e.details).toMatchObject({ maybe_done: "SIM-LIB-3", not_started: ["SIM-UUID"] });
    expect((e.details as { done: unknown[] }).done).toHaveLength(1);
  });

  it("checks the arguments: a relative folder, width without height, quality on png, a resized original", () => {
    const s = schema("lr_export_photos");
    const base = { uuids: ["A"], folder: "C:\\Out", format: "jpeg" };
    expect(s.safeParse(base).success).toBe(true);
    expect(s.safeParse({ ...base, folder: "~/Desktop/Out" }).success).toBe(true);
    expect(s.safeParse({ ...base, folder: "Out" }).success).toBe(false);
    expect(s.safeParse({ ...base, width: 100 }).success).toBe(false);
    expect(s.safeParse({ ...base, format: "png", quality: 80 }).success).toBe(false);
    expect(s.safeParse({ ...base, format: "original", long_edge: 100 }).success).toBe(false);
  });
});

describe("placeExport (library\\files.ts)", () => {
  it("refuses files outside the export folder and moves nothing", async () => {
    const outside = path.join(tmp, "elsewhere");
    mkdirSync(outside, { recursive: true });
    writeFileSync(path.join(outside, "a.jpg"), "x");
    await expect(placeExport(exportDir, outside, [path.join(outside, "a.jpg")], path.join(tmp, "dest"), "rename")).rejects.toThrow(/not inside/);
    expect(existsSync(path.join(outside, "a.jpg"))).toBe(true);
  });

  const exported = (name: string, text: string) => {
    const dir = path.join(exportDir, `req-${name}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, name), text);
    return { dir, file: path.join(dir, name) };
  };

  it("overwrites in one step, and keeps the old file when the replacement cannot be placed (CodeRabbit, PR #73)", async () => {
    const dest = path.join(tmp, "dest-ow");
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "a.jpg"), "old");
    const one = exported("a.jpg", "new");
    expect(await placeExport(exportDir, one.dir, [one.file], dest, "overwrite")).toEqual([{ file: path.join(dest, "a.jpg"), status: "overwritten" }]);
    expect(readFileSync(path.join(dest, "a.jpg"), "utf8")).toBe("new");
    // A folder of that name cannot be renamed over: the call fails and leaves it, and no temporary file, behind.
    mkdirSync(path.join(dest, "b.jpg", "keep"), { recursive: true });
    const two = exported("b.jpg", "new");
    await expect(placeExport(exportDir, two.dir, [two.file], dest, "overwrite")).rejects.toThrow();
    expect(existsSync(path.join(dest, "b.jpg", "keep"))).toBe(true);
    expect(readdirSync(dest).sort()).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("lr_import_photos", () => {
  const card = () => {
    const dir = path.join(tmp, "DCIM");
    mkdirSync(path.join(dir, "100NIKON"), { recursive: true });
    writeFileSync(path.join(dir, "100NIKON", "_DSC0001.NEF"), "raw one");
    writeFileSync(path.join(dir, "100NIKON", "_DSC0001.xmp"), "sidecar");
    writeFileSync(path.join(dir, "100NIKON", "_DSC0002.NEF"), "raw two");
    writeFileSync(path.join(dir, "100NIKON", "notes.txt"), "not a photo");
    writeFileSync(path.join(dir, "broken.bad.jpg"), "x");
    return dir;
  };

  it("copies the photos with their sidecars, imports the copies, and skips them on a second call", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos", "2026");
    const out = await tools.importPhotos({ source, copy_to: copyTo });
    expect(out.json).toMatchObject({ found: 3, failed: [{ code: "IMPORT_FAILED" }] });
    const imported = out.json["imported"] as Array<{ uuid: string; path: string }>;
    expect(imported.map((p) => p.path)).toEqual([path.join(copyTo, "100NIKON", "_DSC0001.NEF"), path.join(copyTo, "100NIKON", "_DSC0002.NEF")]);
    expect(readFileSync(path.join(copyTo, "100NIKON", "_DSC0001.xmp"), "utf8")).toBe("sidecar");
    const again = await tools.importPhotos({ source, copy_to: copyTo });
    expect(again.json["imported"]).toEqual([]);
    expect((again.json["already_in_catalog"] as Array<{ uuid: string }>).map((p) => p.uuid)).toEqual(imported.map((p) => p.uuid));
  });

  it("goes on where the last call stopped, and refuses a copy_to inside the source", async () => {
    const source = card();
    const first = await tools.importPhotos({ source }, ticking(10, 15));
    expect(first.json["not_yet"]).toBe(1);
    const rest = await tools.importPhotos({ source }, { now: () => 0, ms: 1e9 });
    // The two raw files done in the first call are found again; the third file, left over, is now tried.
    expect(rest.json).toMatchObject({ imported: [], failed: [{ code: "IMPORT_FAILED" }] });
    expect((rest.json["already_in_catalog"] as unknown[]).length).toBe(2);
    expect(rest.json["not_yet"]).toBeUndefined();
    expect((await fails(tools.importPhotos({ source, copy_to: path.join(source, "copies") }))).code).toBe("BAD_ARGUMENTS");
  });

  it("never overwrites a different file at the copy's path", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos2");
    mkdirSync(path.join(copyTo, "100NIKON"), { recursive: true });
    writeFileSync(path.join(copyTo, "100NIKON", "_DSC0001.NEF"), "another photo, longer");
    await expect(copyForImport(path.join(source, "100NIKON", "_DSC0001.NEF"), source, copyTo)).rejects.toThrow(/different file/);
    expect(readFileSync(path.join(copyTo, "100NIKON", "_DSC0001.NEF"), "utf8")).toBe("another photo, longer");
    // Same size, other contents: not the copy either (CodeRabbit, PR #73).
    writeFileSync(path.join(copyTo, "100NIKON", "_DSC0002.NEF"), "raw TWO");
    await expect(copyForImport(path.join(source, "100NIKON", "_DSC0002.NEF"), source, copyTo)).rejects.toThrow(/different file/);
    expect(await importFiles(path.join(source, "100NIKON"), false)).toHaveLength(2);
  });
});
