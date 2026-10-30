// Issue #139: lr_import_photos' stack_gap_seconds against the simulated Lightroom (helpers\lightroom-sim-files.ts
// keeps the stacks import_photo's stack_with makes), and the groups of library\stack-groups.ts. The raws are TIFF
// headers built in helpers\exif.ts, as fixtures are never committed (rule 04).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HelloResult } from "../src/bridge/index.js";
import { IntentLibrary } from "../src/intents/index.js";
import { captureSeconds, datesOnce, joinsPrevious, type CaptureDate } from "../src/library/index.js";
import { FILE_DEFS } from "../src/mcp/defs-files.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { tiff } from "./helpers/exif.js";
import { client, fails, logDir, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

useSessionHarness();
afterEach(() => vi.restoreAllMocks());

let tools: Tools;
const pluginAt = (version: string) => {
  const hello = client.hello() as HelloResult;
  vi.spyOn(client, "hello").mockReturnValue({ ...hello, plugin_version: version });
};
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
  pluginAt("1.9.0");
});

/** Three frames of one bracket (0.4 s and 0.5 s apart), then a frame shot a day later. */
const card = () => {
  const dir = path.join(tmp, "DCIM", "100NCZ_8");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "_OZ80001.NEF"), tiff(true, "2026:09:06 11:12:07", "1"));
  writeFileSync(path.join(dir, "_OZ80002.NEF"), tiff(true, "2026:09:06 11:12:07", "5"));
  writeFileSync(path.join(dir, "_OZ80003.NEF"), tiff(false, "2026:09:06 11:12:08", "0"));
  writeFileSync(path.join(dir, "_OZ80004.NEF"), tiff(true, "2026:09:07 08:00:00"));
  return dir;
};
const raw = (dir: string, n: number) => path.join(dir, `_OZ8000${n}.NEF`);
const imports = () => plugin.received.filter((r) => r.name === "import_photo").map((r) => r.payload);
const all = { now: () => 0, ms: 1e9 };

describe("stack groups (library\\stack-groups.ts)", () => {
  const date = (time: string, subsec: string | null = null): CaptureDate => ({ yyyy: "2026", mm: "09", dd: "06", time, subsec });

  it("reads seconds with their fraction, and joins within the gap only", async () => {
    expect(captureSeconds(date("11:12:08", "25")) - captureSeconds(date("11:12:07"))).toBeCloseTo(1.25);
    const dates: Record<string, CaptureDate | null> = { a: date("11:12:07"), b: date("11:12:08"), c: date("11:12:09", "1"), d: null, e: date("11:12:09", "1") };
    const joins = joinsPrevious(["a", "b", "c", "d", "e"], 1, async (f) => dates[f] ?? null);
    expect(await Promise.all([0, 1, 2, 3, 4].map(joins))).toEqual([false, true, false, false, false]);
  });

  it("joins frames exactly the gap apart despite float rounding (Greptile, PR #271)", async () => {
    const dates: Record<string, CaptureDate> = { a: date("11:12:07", "1"), b: date("11:12:07", "7"), c: date("11:12:08", "4") };
    const joins = joinsPrevious(["a", "b", "c"], 0.6, async (f) => dates[f] ?? null);
    expect(await Promise.all([1, 2].map(joins))).toEqual([true, false]);
  });

  it("reads each file once", async () => {
    const read = vi.fn(async () => null);
    const dateOf = datesOnce(read);
    await Promise.all([dateOf("x"), dateOf("x"), dateOf("y")]);
    expect(read).toHaveBeenCalledTimes(2);
  });
});

describe("lr_import_photos stack_gap_seconds (issue #139)", () => {
  it("stacks the bracket below its first frame and leaves the lone frame alone", async () => {
    const source = card();
    const out = await tools.importPhotos({ source, stack_gap_seconds: 0.5 }, all);
    const sent = imports();
    expect(sent.map((p) => p["stack_with"])).toEqual([undefined, "SIM-IMP-1", "SIM-IMP-1", undefined]);
    const imported = out.json["imported"] as Array<{ uuid: string; stack?: unknown }>;
    expect(imported.map((p) => p.stack)).toEqual([undefined, { top_uuid: "SIM-IMP-1", position: 2, count: 2 }, { top_uuid: "SIM-IMP-1", position: 3, count: 3 }, undefined]);
    expect(out.json["not_stacked"]).toEqual([]);
  });

  it("stacks nothing without it, and an older plugin is refused only with it", async () => {
    pluginAt("1.8.0");
    const source = card();
    const err = await fails(tools.importPhotos({ source, stack_gap_seconds: 2 }, all));
    expect(err.code).toBe("PLUGIN_TOO_OLD");
    expect(imports()).toEqual([]);
    const out = await tools.importPhotos({ source }, all);
    expect(imports().every((p) => p["stack_with"] === undefined)).toBe(true);
    expect(out.json["not_stacked"]).toBeUndefined();
  });

  it("does not restack a frame the catalog held already; a top held already stays the top", async () => {
    const source = card();
    await tools.importPhotos({ source: raw(source, 1) }, all);
    await tools.importPhotos({ source: raw(source, 2) }, all);
    plugin.received.length = 0;
    const out = await tools.importPhotos({ source, stack_gap_seconds: 0.5 }, all);
    expect(imports().map((p) => p["stack_with"])).toEqual([undefined, "SIM-IMP-1", "SIM-IMP-1", undefined]);
    expect(out.json["not_stacked"]).toEqual([{ source: raw(source, 2), uuid: "SIM-IMP-2", reason: expect.stringMatching(/Photo > Stacking/) }]);
  });

  it("a top that fails leaves the next frame of its group on top", async () => {
    const source = card();
    // The bracket's first frame, which the simulated Lightroom refuses (a name ending .bad.jpg).
    writeFileSync(path.join(source, "_OZ80000.bad.jpg"), tiff(true, "2026:09:06 11:12:07", "0"));
    const out = await tools.importPhotos({ source, stack_gap_seconds: 0.5 }, all);
    expect((out.json["failed"] as unknown[]).length).toBe(1);
    expect(imports().map((p) => p["stack_with"])).toEqual([undefined, undefined, "SIM-IMP-1", "SIM-IMP-1", undefined]);
  });

  it("never splits a group when the time is up, and resume_after goes on after its last frame", async () => {
    const source = card();
    let t = 0;
    const first = await tools.importPhotos({ source, stack_gap_seconds: 0.5 }, { now: () => (t += 10), ms: 5 });
    expect(first.json).toMatchObject({ not_yet: 1, resume_after: raw(source, 3) });
    expect(imports()).toHaveLength(3);
    const rest = await tools.importPhotos({ source, stack_gap_seconds: 0.5, resume_after: raw(source, 3) }, all);
    expect((rest.json["imported"] as unknown[]).length).toBe(1);
    expect(imports().at(-1)?.["stack_with"]).toBeUndefined();
  });

  it("dry_run lists the groups and sends nothing", async () => {
    const source = card();
    const out = await tools.importPhotos({ source, stack_gap_seconds: 0.5, dry_run: true }, all);
    expect(out.json["groups"]).toEqual([[raw(source, 1), raw(source, 2), raw(source, 3)]]);
    expect(imports()).toEqual([]);
  });

  it("is in the tool's arguments, 0.5-60 s", () => {
    const s = FILE_DEFS.find((d) => d.name === "lr_import_photos")?.schema as (typeof FILE_DEFS)[number]["schema"];
    expect(s.safeParse({ source: "C:\\Card", stack_gap_seconds: 0.5 }).success).toBe(true);
    expect(s.safeParse({ source: "C:\\Card", stack_gap_seconds: 0.4 }).success).toBe(false);
    expect(s.safeParse({ source: "C:\\Card", stack_gap_seconds: 61 }).success).toBe(false);
  });
});
