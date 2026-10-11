// Issue #76: lr_export_photos' placement (library\files.ts placeExport). A failed placement keeps the
// plugin's folder and names it, the rename policy places with an exclusive create (no check-then-move
// race), and the exports folder is purged at engine start and exit, a kept folder excepted.

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { placeExport, purgeExports } from "../src/library/files.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { client, logDir, lr, map, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

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

const exported = (name: string, text: string) => {
  const dir = path.join(exportDir, `req-${name}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), text);
  return { dir, file: path.join(dir, name) };
};

describe("a failed placement (issue #76)", () => {
  it("keeps the plugin's folder with the file in it, and names the folder in the MOVE_FAILED result", async () => {
    const folder = path.join(tmp, "out-fail");
    // A folder of the export's name cannot be overwritten, so placing the file fails.
    mkdirSync(path.join(folder, "20260907-_OZ80099.png", "keep"), { recursive: true });
    const out = await tools.exportPhotos({ uuids: ["SIM-LIB-2"], folder, format: "png", on_existing: "overwrite" });
    const failed = out.json["failed"] as Array<{ code: string; message: string }>;
    expect(failed[0]?.code).toBe("MOVE_FAILED");
    const kept = path.join(exportDir, "req-1");
    expect(failed[0]?.message).toContain(kept);
    expect(readdirSync(kept)).toEqual(["20260907-_OZ80099.png"]);
  });

  it("keeps the plugin's folder when the destination folder cannot be made", async () => {
    const notAFolder = path.join(tmp, "a-file");
    writeFileSync(notAFolder, "x");
    const one = exported("a.jpg", "new");
    await expect(placeExport(exportDir, one.dir, [one.file], path.join(notAFolder, "sub"), "rename")).rejects.toThrow();
    expect(readFileSync(one.file, "utf8")).toBe("new");
  });
});

describe("the rename policy (issue #76)", () => {
  it("never replaces a file that appears after a name was found free", async () => {
    const dest = path.join(tmp, "dest-race");
    mkdirSync(dest, { recursive: true });
    writeFileSync(path.join(dest, "a.jpg"), "first");
    writeFileSync(path.join(dest, "a-2.jpg"), "another program's");
    // A stale check: a-2.jpg reads as free although it is there, as if made just after the check.
    const access = fs.access.bind(fs);
    vi.spyOn(fs, "access").mockImplementation(async (p, mode) => {
      if (path.basename(String(p)) === "a-2.jpg") throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return access(p, mode);
    });
    const one = exported("a.jpg", "new");
    expect(await placeExport(exportDir, one.dir, [one.file], dest, "rename")).toEqual([{ file: path.join(dest, "a-3.jpg"), status: "renamed" }]);
    expect(readFileSync(path.join(dest, "a-2.jpg"), "utf8")).toBe("another program's");
    expect(readFileSync(path.join(dest, "a-3.jpg"), "utf8")).toBe("new");
    expect(existsSync(one.dir)).toBe(false);
  });

  // Review, 2026-10-11: a source Windows holds open after the copy landed made a placed file a
  // MOVE_FAILED, and a retry under the rename policy wrote a duplicate a-2.jpg.
  it("counts the file as placed when removing the plugin's copy fails after the copy", async () => {
    const dest = path.join(tmp, "dest-busy");
    const one = exported("a.jpg", "new");
    const rm = fs.rm.bind(fs);
    vi.spyOn(fs, "rm").mockImplementation(async (p, o) => {
      // The held file blocks its folder's removal too [inference].
      if (String(p) === one.file || String(p) === one.dir) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      return rm(p, o);
    });
    expect(await placeExport(exportDir, one.dir, [one.file], dest, "rename")).toEqual([{ file: path.join(dest, "a.jpg"), status: "written" }]);
    expect(readdirSync(dest)).toEqual(["a.jpg"]);
  });
});

describe("purgeExports (issue #76)", () => {
  it("empties the exports folder but for a folder kept by a failed placement", async () => {
    const left = exported("old.jpg", "left by a timed-out export");
    const dest = path.join(tmp, "dest-purge");
    mkdirSync(path.join(dest, "b.jpg"), { recursive: true });
    const failing = exported("b.jpg", "new");
    await expect(placeExport(exportDir, failing.dir, [failing.file], dest, "overwrite")).rejects.toThrow();
    purgeExports(exportDir);
    expect(existsSync(left.dir)).toBe(false);
    expect(readFileSync(failing.file, "utf8")).toBe("new");
    purgeExports(path.join(tmp, "no-such-folder"));
  });
});
