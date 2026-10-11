// Issue #75: lr_import_photos goes on from a cursor (resume_after), counts the folder scan against the
// call's time budget, and copies a sidecar missing at the destination on a retry.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { FILE_DEFS } from "../src/mcp/defs-files.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { client, fails, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

let tools: Tools;
beforeEach(() => {
  tools = new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
});

const card = () => {
  const dir = path.join(tmp, "DCIM");
  mkdirSync(path.join(dir, "100NIKON"), { recursive: true });
  writeFileSync(path.join(dir, "100NIKON", "_DSC0001.NEF"), "raw one");
  writeFileSync(path.join(dir, "100NIKON", "_DSC0001.xmp"), "sidecar");
  writeFileSync(path.join(dir, "100NIKON", "_DSC0002.NEF"), "raw two");
  writeFileSync(path.join(dir, "100NIKON", "_DSC0003.NEF"), "raw three");
  return dir;
};
const imports = () => plugin.received.filter((r) => r.name === "import_photo").map((r) => r.payload["path"]);
const ticking = (step: number, ms: number) => {
  let t = 0;
  return { now: () => (t += step), ms };
};

describe("lr_import_photos resume_after (issue #75)", () => {
  it("returns resume_after when the time is up, and a call with it starts after that file", async () => {
    const source = card();
    const raw = (n: number) => path.join(source, "100NIKON", `_DSC000${n}.NEF`);
    const first = await tools.importPhotos({ source }, ticking(10, 15));
    expect(first.json).toMatchObject({ not_yet: 1, resume_after: raw(2) });
    expect(first.json["next"]).toMatch(/resume_after/);
    plugin.received.length = 0;
    const rest = await tools.importPhotos({ source, resume_after: raw(2) }, { now: () => 0, ms: 1e9 });
    expect(imports()).toEqual([raw(3)]);
    expect(rest.json["resume_after"]).toBeUndefined();
    expect(rest.json["not_yet"]).toBeUndefined();
  });

  // Review, 2026-10-11: compared as a string, a cursor in another case put every file on one side.
  it.runIf(process.platform === "win32")("finds the cursor whatever its case on Windows", async () => {
    const source = card();
    const cursor = path.join(source, "100NIKON", "_DSC0002.NEF").toLowerCase();
    await tools.importPhotos({ source, resume_after: cursor }, { now: () => 0, ms: 1e9 });
    expect(imports()).toEqual([path.join(source, "100NIKON", "_DSC0003.NEF")]);
  });

  it("refuses a cursor that is not one of the source's files, importing nothing", async () => {
    const source = card();
    const err = await fails(tools.importPhotos({ source, resume_after: path.join(source, "100NIKON", "_DSC0009.NEF") }));
    expect(err.code).toBe("BAD_ARGUMENTS");
    expect(imports()).toEqual([]);
  });

  it("is in the tool's arguments", () => {
    const s = FILE_DEFS.find((d) => d.name === "lr_import_photos")?.schema as (typeof FILE_DEFS)[number]["schema"];
    expect(s.safeParse({ source: "C:\\Card", resume_after: "C:\\Card\\a.NEF" }).success).toBe(true);
    expect(s.safeParse({ source: "C:\\Card", resume_after: "" }).success).toBe(false);
  });
});

describe("lr_import_photos budget (issue #75)", () => {
  it("counts the folder scan against the call's time", async () => {
    const source = card();
    let t = 0;
    const readdir = fs.readdir.bind(fs);
    vi.spyOn(fs, "readdir").mockImplementation((async (...a: Parameters<typeof fs.readdir>) => {
      t += 1000; // a slow card reader
      return readdir(...a);
    }) as typeof fs.readdir);
    const out = await tools.importPhotos({ source }, { now: () => t, ms: 500 });
    // The first file always runs, so every call gets somewhere; the scan spent the rest.
    expect(imports()).toHaveLength(1);
    expect(out.json["not_yet"]).toBe(2);
  });
});

describe("lr_import_photos sidecar retry (issue #75)", () => {
  it("copies a sidecar missing at the destination when the raw is already there, and never overwrites one", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos");
    await tools.importPhotos({ source, copy_to: copyTo });
    const xmp = path.join(copyTo, "100NIKON", "_DSC0001.xmp");
    rmSync(xmp);
    await tools.importPhotos({ source, copy_to: copyTo });
    expect(readFileSync(xmp, "utf8")).toBe("sidecar");
    writeFileSync(xmp, "edited by Lightroom");
    const again = await tools.importPhotos({ source, copy_to: copyTo });
    expect(again.json["failed"]).toEqual([]);
    expect(readFileSync(xmp, "utf8")).toBe("edited by Lightroom");
  });
});
