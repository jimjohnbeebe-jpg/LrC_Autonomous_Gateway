// A fake Lightroom's Develop presets (plugin\LrC-AVG.lrplugin\Presets.lua, issue #215) on top of the session
// harness's simulated photo: list_presets, get_preset, apply_preset (the preset's keys written over the photo's,
// read back) and create_checkpoint. The shapes follow Presets.lua; what Lightroom itself does is [unverified].

import { writeFileSync } from "node:fs";
import path from "node:path";
import { Tools } from "../../src/mcp/index.js";
import { PreviewService } from "../../src/preview/index.js";
import { IntentLibrary } from "../../src/intents/index.js";
import type { FakeReply } from "./fake-plugin.js";
import { client, logDir, lr, map, plugin, tmp, userDir } from "./session-harness.js";

export type SimPreset = { name: string; folder: string; scope: "lightroom" | "plugin"; uuid: string; file?: string; settings: Record<string, unknown> };

export const SKY_TABLE = [{ CorrectionID: "C-SKY", CorrectionMasks: [{ What: "Mask/Image", MaskID: "M-1", MaskSubType: 2 }], LocalExposure2012: 0.3 }];

/** The presets the fake Lightroom lists; "Warm" is in two folders, and once more as a favourite (one uuid). */
export function samplePresets(): SimPreset[] {
  const warmFile = path.join(tmp, "Warm.xmp");
  writeFileSync(warmFile, "<x:xmpmeta/>\n");
  const warm = { ProcessVersion: "15.4", Exposure2012: 0.5, Contrast2012: 10, Temperature: 5600, WhiteBalance: "Custom" };
  return [
    { name: "Warm", folder: "User Presets", scope: "lightroom", uuid: "U-WARM", file: warmFile, settings: warm },
    { name: "Warm", folder: "Favorites", scope: "lightroom", uuid: "U-WARM", file: warmFile, settings: warm },
    { name: "Warm", folder: "Mine", scope: "lightroom", uuid: "U-WARM-2", settings: { ProcessVersion: "15.4", Contrast2012: 20, IncrementalTemperature: 12 } },
    { name: "Adaptive: Sky", folder: "Adaptive: Sky", scope: "lightroom", uuid: "U-SKY", settings: { ProcessVersion: "15.4", MaskGroupBasedCorrections: SKY_TABLE } },
    { name: "Warm v1", folder: "Plugin Develop Presets", scope: "plugin", uuid: "P-1", settings: { ProcessVersion: "15.4", Exposure2012: 0.4 } },
  ];
}

const ok = (payload: unknown): FakeReply => ({ ok: true, payload });
const fail = (code: string, message: string): FakeReply => ({ ok: false, error: { code, message, recoverable: false } });
const summary = (p: SimPreset) => ({ name: p.name, folder: p.folder, scope: p.scope, uuid: p.uuid, ...(p.file ? { file: p.file } : {}) });

/** Install the preset commands; returns the list, which a test may change, and the checkpoints created. */
export function installPresets(presets: SimPreset[] = samplePresets()): { presets: SimPreset[]; created: Array<{ name: string; settings: Record<string, unknown> }> } {
  const created: Array<{ name: string; settings: Record<string, unknown> }> = [];
  const find = (uuid: unknown, scope: unknown) => presets.find((p) => p.uuid === uuid && p.scope === scope);
  plugin.handlers.set("list_presets", () => ok({ presets: presets.map(summary) }));
  plugin.handlers.set("get_preset", (p) => {
    const found = find(p["uuid"], p["scope"]);
    return found ? ok({ ...summary(found), settings: structuredClone(found.settings) }) : fail("unknown_preset", "no such preset");
  });
  plugin.handlers.set("apply_preset", (p) => {
    const found = find(p["preset_uuid"], p["scope"]);
    if (!found) return fail("unknown_preset", "no such preset");
    if (!String(p["history_name"]).startsWith("AVG ")) return fail("bad_request", "history_name must start with 'AVG '");
    const uuid = String(p["photo_uuid"]);
    if (uuid === "GONE") return fail("unknown_photo", "no photo has that uuid");
    lr.history.push(String(p["history_name"]));
    Object.assign(lr.settingsOf(uuid), structuredClone(found.settings));
    return ok({ uuid, apply_ms: 5, read_back: structuredClone(lr.settingsOf(uuid)) });
  });
  plugin.handlers.set("create_checkpoint", (p) => {
    const name = String(p["name"]);
    if (presets.some((x) => x.scope === "plugin" && x.name === name)) return fail("preset_exists", "exists");
    const settings = p["settings"] as Record<string, unknown>;
    created.push({ name, settings });
    const made: SimPreset = { name, folder: "Plugin Develop Presets", scope: "plugin", uuid: `P-${presets.length + 1}`, file: path.join(tmp, `${name}.lrtemplate`), settings };
    presets.push(made);
    return ok(summary(made));
  });
  return { presets, created };
}

export function newTools(): Tools {
  return new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir }),
    sessionLogDir: logDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });
}
