// Issue #139 gap 3 and traceability (plugin 0.21.0): the listings and the context carry each photo's
// gps and path, a notice says so when Lightroom runs an older plugin, and lr_import_photos returns each
// photo's source file and capture_time; against the simulated Lightroom (lightroom-sim-library.ts,
// lightroom-sim-files.ts).

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { WHERE_NOTICE } from "../src/library/index.js";
import { Tools } from "../src/mcp/index.js";
import { PreviewService } from "../src/preview/index.js";
import { waitUntil } from "./helpers/fake-plugin.js";
import { client, logDir, lr, map, plugin, tmp, useSessionHarness, userDir } from "./helpers/session-harness.js";

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

/** Reconnect so the next hello reports `version`. */
async function pluginAt(version: string): Promise<void> {
  lr.pluginVersion = version;
  const drops = client.stats.drops;
  plugin.dropEventClient();
  await waitUntil(() => client.stats.drops === drops + 1);
  await client.waitConnected(2000);
}

const HERE = { latitude: 47.6062, longitude: -122.3321 };

describe("gps and path in the listings (issue #139 gap 3)", () => {
  it("lr_search_photos and lr_get_selected_photos carry gps, null for none, and path", async () => {
    await pluginAt("0.21.0");
    const found = await tools.searchPhotos({ keywords: ["bird"] });
    expect(found.json["photos"]).toMatchObject([
      { uuid: "SIM-LIB-2", gps: HERE, path: "D:\\Photos\\20260907-_OZ80099.NEF" },
      { uuid: "SIM-LIB-3", gps: null, path: "D:\\Photos\\20260908-_OZ80100.NEF" },
    ]);
    expect(found.json["notice"]).toBeUndefined();
    const selected = await tools.getSelectedPhotos({});
    expect(selected.json["photos"]).toMatchObject([{ uuid: "SIM-UUID", gps: null, path: expect.stringMatching(/^D:\\Photos\\/) }]);
    expect(selected.json["notice"]).toBeUndefined();
  });

  it("with a plugin before 0.21.0: no gps or path, and the notice says why", async () => {
    await pluginAt("0.20.0");
    for (const out of [await tools.searchPhotos({ keywords: ["bird"] }), await tools.getSelectedPhotos({})]) {
      expect(out.json["notice"]).toBe(WHERE_NOTICE);
      for (const photo of out.json["photos"] as Array<Record<string, unknown>>) {
        expect(photo).not.toHaveProperty("gps");
        expect(photo).not.toHaveProperty("path");
      }
    }
  });
});

describe("gps in lr_get_active_photo_context (issue #139 gap 3)", () => {
  it("carries the selected photo's position, null for none, and a notice from an older plugin", async () => {
    await pluginAt("0.21.0");
    expect((await tools.getActivePhotoContext()).json).toMatchObject({ gps: null });
    (lr.library.find("SIM-UUID") as { gps: unknown }).gps = HERE;
    const located = (await tools.getActivePhotoContext()).json;
    expect(located["gps"]).toEqual(HERE);
    expect(located["gps_notice"]).toBeUndefined();
    await pluginAt("0.20.0");
    const old = (await tools.getActivePhotoContext()).json;
    expect(old).not.toHaveProperty("gps");
    expect(old["gps_notice"]).toBe(WHERE_NOTICE);
  });
});

describe("lr_import_photos traceability (issue #139)", () => {
  it("returns each photo's source file, its path in the catalog and capture_time, imported or already there", async () => {
    const source = path.join(tmp, "DCIM");
    mkdirSync(path.join(source, "100NCZ_8"), { recursive: true });
    writeFileSync(path.join(source, "100NCZ_8", "_OZ80139.NEF"), "raw");
    const copyTo = path.join(tmp, "Archive");
    const want = {
      source: path.join(source, "100NCZ_8", "_OZ80139.NEF"),
      path: path.join(copyTo, "100NCZ_8", "_OZ80139.NEF"),
      capture_time: "2026-10-04 12:00:00",
    };
    const first = await tools.importPhotos({ source, copy_to: copyTo });
    expect(first.json["imported"]).toEqual([{ uuid: "SIM-IMP-1", filename: "_OZ80139.NEF", ...want }]);
    const again = await tools.importPhotos({ source, copy_to: copyTo });
    expect(again.json["already_in_catalog"]).toEqual([{ uuid: "SIM-IMP-1", filename: "_OZ80139.NEF", ...want }]);
  });
});
