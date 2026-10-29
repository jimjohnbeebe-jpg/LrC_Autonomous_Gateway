// Issue #139 gap 1: lr_import_photos with folder_template, name_template and dry_run, against the
// simulated Lightroom (helpers\lightroom-sim-files.ts). The raws are TIFF headers built in
// helpers\exif.ts, as fixtures are never committed (rule 04).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { tiff } from "./helpers/exif.js";
import { client, fails, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();

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

const JIM = { folder_template: "{yyyy}-{mm}-{dd}", name_template: "{yyyy}{mm}{dd}-{name}" };
const card = () => {
  const dir = path.join(tmp, "DCIM");
  mkdirSync(path.join(dir, "100NCZ_8"), { recursive: true });
  writeFileSync(path.join(dir, "100NCZ_8", "_OZ80005.NEF"), tiff(true, "2026:09:06 11:12:07"));
  writeFileSync(path.join(dir, "100NCZ_8", "_OZ80005.xmp"), "sidecar");
  writeFileSync(path.join(dir, "100NCZ_8", "_OZ80006.NEF"), tiff(true, "2026:09:07 08:00:00"));
  writeFileSync(path.join(dir, "100NCZ_8", "_OZ80007.CR3"), "no tiff header here");
  return dir;
};
const imports = () => plugin.received.filter((r) => r.name === "import_photo").map((r) => r.payload["path"]);

describe("lr_import_photos templates (issue #139)", () => {
  it("copies into dated folders under the new names, with the sidecar, and fails a file with no date alone", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos");
    const out = await tools.importPhotos({ source, copy_to: copyTo, ...JIM });
    const first = path.join(copyTo, "2026-09-06", "20260906-_OZ80005.NEF");
    expect(imports()).toEqual([first, path.join(copyTo, "2026-09-07", "20260907-_OZ80006.NEF")]);
    expect(readFileSync(path.join(copyTo, "2026-09-06", "20260906-_OZ80005.xmp"), "utf8")).toBe("sidecar");
    expect(out.json["imported"]).toEqual([expect.objectContaining({ path: first, source: path.join(source, "100NCZ_8", "_OZ80005.NEF") }), expect.anything()]);
    expect(out.json["failed"]).toEqual([expect.objectContaining({ file: path.join(source, "100NCZ_8", "_OZ80007.CR3"), code: "NO_CAPTURE_DATE" })]);
    expect(existsSync(path.join(copyTo, "100NCZ_8"))).toBe(false);
  });

  it("counts a same-content rerun as already copied, and never overwrites a different file under the new name", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos");
    await tools.importPhotos({ source, copy_to: copyTo, ...JIM });
    const again = await tools.importPhotos({ source, copy_to: copyTo, ...JIM });
    expect((again.json["already_in_catalog"] as unknown[]).length).toBe(2);
    const other = path.join(copyTo, "2026-09-07", "20260907-_OZ80006.NEF");
    writeFileSync(other, "another camera's file of that number");
    const clash = await tools.importPhotos({ source, copy_to: copyTo, ...JIM });
    expect(clash.json["failed"]).toEqual(expect.arrayContaining([expect.objectContaining({ code: "COPY_FAILED" })]));
    expect(readFileSync(other, "utf8")).toBe("another camera's file of that number");
  });

  it("dry_run lists the planned paths and capture dates, and copies or sends nothing", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos");
    const out = await tools.importPhotos({ source, copy_to: copyTo, ...JIM, dry_run: true });
    expect(out.json["planned"]).toEqual([
      { source: path.join(source, "100NCZ_8", "_OZ80005.NEF"), path: path.join(copyTo, "2026-09-06", "20260906-_OZ80005.NEF"), capture_date: "2026-09-06 11:12:07" },
      { source: path.join(source, "100NCZ_8", "_OZ80006.NEF"), path: path.join(copyTo, "2026-09-07", "20260907-_OZ80006.NEF"), capture_date: "2026-09-07 08:00:00" },
    ]);
    expect(out.json["failed"]).toEqual([expect.objectContaining({ code: "NO_CAPTURE_DATE" })]);
    expect(out.json["imported"]).toBeUndefined();
    expect(plugin.received.filter((r) => r.name !== "hello")).toEqual([]);
    expect(existsSync(copyTo)).toBe(false);
  });

  it("goes on with resume_after while the templates are on", async () => {
    const source = card();
    const copyTo = path.join(tmp, "Photos");
    let t = 0;
    const first = await tools.importPhotos({ source, copy_to: copyTo, ...JIM }, { now: () => (t += 10), ms: 15 });
    expect(first.json).toMatchObject({ not_yet: 1, resume_after: path.join(source, "100NCZ_8", "_OZ80006.NEF") });
    plugin.received.length = 0;
    const rest = await tools.importPhotos({ source, copy_to: copyTo, ...JIM, resume_after: first.json["resume_after"] as string }, { now: () => 0, ms: 1e9 });
    expect(imports()).toEqual([]);
    expect(rest.json["failed"]).toEqual([expect.objectContaining({ code: "NO_CAPTURE_DATE" })]);
  });

  it("refuses templates without copy_to", async () => {
    expect((await fails(tools.importPhotos({ source: card(), ...JIM }))).code).toBe("BAD_ARGUMENTS");
    expect(plugin.received.filter((r) => r.name !== "hello")).toEqual([]);
  });
});
