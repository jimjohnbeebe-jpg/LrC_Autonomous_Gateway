// The read-only preset tools of issue #215 (tools-presets.ts, presets\lightroom.ts, params\preset-read.ts) against a
// fake plugin's list_presets and get_preset (helpers\presets-sim.ts): listing by folder, exact choice, canonical
// reading, comparing, and the export's copy that never replaces a file.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tools } from "../src/mcp/index.js";
import { readPreset, withoutVolatileIds } from "../src/params/index.js";
import { underAppData } from "../src/presets/index.js";
import { installPresets, newTools } from "./helpers/presets-sim.js";
import { fails, map, plugin, tmp, useSessionHarness } from "./helpers/session-harness.js";

useSessionHarness();
let tools: Tools;
beforeEach(() => {
  installPresets();
  tools = newTools();
});
const sentNames = (): string[] => plugin.received.map((r) => r.name);

describe("lr_list_presets", () => {
  it("groups by folder and scope, filters by part of the name, and pages", async () => {
    const all = (await tools.listPresets()).json;
    expect(all["total"]).toBe(5);
    expect((all["folders"] as Array<{ folder: string; scope: string }>).map((f) => `${f.scope}/${f.folder}`)).toEqual([
      "lightroom/User Presets",
      "lightroom/Favorites",
      "lightroom/Mine",
      "lightroom/Adaptive: Sky",
      "plugin/Plugin Develop Presets",
    ]);
    const sky = (await tools.listPresets({ query: "sky" })).json;
    expect(sky["folders"]).toEqual([{ folder: "Adaptive: Sky", scope: "lightroom", presets: [{ name: "Adaptive: Sky", uuid: "U-SKY" }] }]);
    const page = (await tools.listPresets({ limit: 2, offset: 1 })).json;
    expect([page["count"], page["next_offset"]]).toEqual([2, 3]);
    expect((await tools.listPresets({ scope: "plugin" })).json["total"]).toBe(1);
  });
});

describe("lr_get_preset", () => {
  it("reads a preset in canonical names, with its file, other keys and masks", async () => {
    const out = (await tools.getPreset({ preset_uuid: "U-WARM" })).json;
    expect(out).toMatchObject({ name: "Warm", uuid: "U-WARM", exportable: true, settings: { exposure: 0.5, contrast: 10, temperature: 5600 }, masks: 0, ai_masks: false });
    expect(out["other_keys"]).toEqual(["ProcessVersion", "WhiteBalance"]);
    expect(out["raw_settings"]).toBeUndefined();
    const raw = (await tools.getPreset({ preset_uuid: "U-WARM", raw: true })).json;
    expect(raw["raw_settings"]).toMatchObject({ Exposure2012: 0.5 });
  });

  it("reads a rendered-pipeline white balance as relative, and an AI mask preset as such", async () => {
    const mine = (await tools.getPreset({ preset_uuid: "U-WARM-2" })).json;
    expect(mine).toMatchObject({ settings: { temperature: 12, contrast: 20 }, relative: ["temperature"] });
    const sky = (await tools.getPreset({ preset_name: "Adaptive: Sky" })).json;
    expect(sky).toMatchObject({ masks: 1, ai_masks: true, exportable: false });
  });

  it("takes a uuid listed twice (a favourite) as one preset, and refuses a name several presets have, with the candidates", async () => {
    expect((await tools.getPreset({ preset_name: "Warm", preset_folder: "Favorites" })).json["uuid"]).toBe("U-WARM");
    const e = await fails(tools.getPreset({ preset_name: "Warm" }));
    expect(e.code).toBe("PRESET_AMBIGUOUS");
    expect((e.details as { candidates: Array<{ uuid: string }> }).candidates.map((c) => c.uuid)).toEqual(["U-WARM", "U-WARM-2"]);
  });

  it("refuses an unknown preset with similar names, and a call that names none", async () => {
    const e = await fails(tools.getPreset({ preset_name: "warm v" }));
    expect(e.code).toBe("PRESET_NOT_FOUND");
    expect((e.details as { similar: Array<{ name: string }> }).similar.map((s) => s.name)).toEqual(["Warm v1"]);
    expect((await fails(tools.getPreset({}))).code).toBe("INVALID_ARGUMENTS");
    expect(sentNames()).not.toContain("get_preset");
  });
});

describe("lr_compare_presets", () => {
  it("lists each canonical setting that differs, null where a preset lacks it, and the other keys", async () => {
    const out = (await tools.comparePresets({ base: { preset_uuid: "U-WARM" }, candidate: { preset_uuid: "P-1" } })).json;
    expect(out["changes"]).toEqual([
      { name: "contrast", base: 10, candidate: null },
      { name: "exposure", base: 0.5, candidate: 0.4 },
      { name: "temperature", base: 5600, candidate: null },
    ]);
    expect(out["other_changes"]).toEqual(["WhiteBalance"]);
    expect(out["changed_count"]).toBe(4);
    const raw = (await tools.comparePresets({ base: { preset_uuid: "U-WARM" }, candidate: { preset_uuid: "P-1" }, raw: true })).json;
    expect(raw["other_changes"]).toEqual([{ key: "WhiteBalance", base: "Custom", candidate: null }]);
  });

  it("does not count mask ids Lightroom renews on every read", () => {
    const a = { MaskGroupBasedCorrections: [{ CorrectionID: "A", CorrectionMasks: [{ What: "Mask/Image", MaskID: "1" }] }] };
    const b = { MaskGroupBasedCorrections: [{ CorrectionID: "B", CorrectionMasks: [{ What: "Mask/Image", MaskID: "2" }] }] };
    expect(withoutVolatileIds(a)).toEqual(withoutVolatileIds(b));
    expect(readPreset(map, a).masks).toBe(1);
  });
});

describe("lr_export_preset", () => {
  it("copies the preset's file, keeps its extension, and never replaces a file", async () => {
    const dir = path.join(tmp, "out", "presets");
    const out = (await tools.exportPreset({ preset_uuid: "U-WARM", destination_dir: dir, filename: "Warm approved" })).json;
    expect(out["destination"]).toBe(path.join(dir, "Warm approved.xmp"));
    expect(readFileSync(path.join(dir, "Warm approved.xmp"), "utf8")).toBe("<x:xmpmeta/>\n");
    expect((await fails(tools.exportPreset({ preset_uuid: "U-WARM", destination_dir: dir, filename: "Warm approved" }))).code).toBe("PRESET_EXISTS");
    expect((await fails(tools.exportPreset({ preset_uuid: "U-WARM", destination_dir: dir, filename: "x.lrtemplate" }))).code).toBe("INVALID_ARGUMENTS");
    expect((await fails(tools.exportPreset({ preset_uuid: "U-WARM", destination_dir: "relative" }))).code).toBe("INVALID_ARGUMENTS");
  });

  it("refuses a preset without a file", async () => {
    const e = await fails(tools.exportPreset({ preset_uuid: "U-SKY", destination_dir: path.join(tmp, "x") }));
    expect(e.code).toBe("PRESET_NOT_EXPORTABLE");
    expect(existsSync(path.join(tmp, "x"))).toBe(false);
  });

  it("knows a folder under AppData (issue #182)", () => {
    const env = { APPDATA: "C:\\Users\\a\\AppData\\Roaming", LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local" };
    if (path.sep !== "\\") return; // Windows paths
    expect(underAppData("C:\\Users\\a\\AppData\\Roaming\\Adobe", env)).toBe(true);
    expect(underAppData("c:\\users\\a\\appdata\\local", env)).toBe(true);
    expect(underAppData("D:\\Presets", env)).toBe(false);
  });
});
