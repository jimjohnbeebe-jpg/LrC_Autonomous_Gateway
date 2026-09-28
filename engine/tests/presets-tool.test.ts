// lr_create_preset_from_active through the tool layer and the session queue, against the simulated
// Lightroom (tests\helpers\sync-harness.ts): the file it writes, what it reads from Lightroom (and
// that it writes nothing there), and its refusals. The preset folder is a temp folder, never
// Lightroom's.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { IntentLibrary } from "../src/intents/index.js";
import { Tools, toToolError, type ToolError } from "../src/mcp/index.js";
import type { CreatePresetArgs } from "../src/mcp/tools-propagation.js";
import { presetIdentity, RESTART_NOTE } from "../src/presets/index.js";
import { PreviewService } from "../src/preview/index.js";
import { client, lr, map, plugin, sent, tmp, useSyncHarness } from "./helpers/sync-harness.js";

useSyncHarness();

let dir: string;
let presets: Tools;

const newTools = (presetDir: string | undefined): Tools =>
  new Tools({
    client,
    map,
    previews: new PreviewService(client, { previewDir: path.join(tmp, "previews") }),
    intents: new IntentLibrary({ map, userDir: path.join(tmp, "intents") }),
    sessionLogDir: path.join(tmp, "logs"),
    presetDir,
    engineVersion: "test",
    ensureBridge: () => client.waitConnected(2000).then(() => undefined),
  });

beforeEach(() => {
  dir = path.join(tmp, "Settings");
  mkdirSync(dir);
  presets = newTools(dir);
});

async function fails(args: CreatePresetArgs, tools: Tools = presets): Promise<ToolError> {
  try {
    await tools.createPresetFromActive(args);
  } catch (err) {
    return toToolError(err);
  }
  throw new Error("expected lr_create_preset_from_active to fail");
}

const WRITES = ["apply_settings", "create_snapshot", "apply_snapshot", "select_photo", "create_virtual_copies"];

describe("lr_create_preset_from_active", () => {
  it("writes <name>.xmp in the preset folder, reads the selected photo and writes nothing to Lightroom", async () => {
    const out = await presets.createPresetFromActive({ name: "AVG test look" });
    const file = path.join(dir, "AVG test look.xmp");
    expect(out.json).toMatchObject({
      ok: true,
      path: file,
      name: "AVG test look",
      group: "LrC-AVG",
      categories: ["basic_tone", "white_balance", "tone_curve", "hsl", "grading", "detail", "lens", "camera_profile"],
      source: { uuid: "SIM-UUID", filename: "20260907-_OZ80093.NEF", process_version: "15.4" },
      restart_required: true,
      note: RESTART_NOTE,
    });
    expect(out.json["uuid"]).toMatch(/^[0-9A-F]{32}$/);
    expect(presetIdentity(readFileSync(file, "utf8"))).toEqual({ name: "AVG test look", group: "LrC-AVG" });
    expect(readFileSync(file, "utf8")).toContain(`crs:UUID="${out.json["uuid"] as string}"`);
    expect(sent("get_settings")).toEqual([{ target_uuid: "SIM-UUID" }]);
    for (const name of WRITES) expect(sent(name), name).toEqual([]);
  });

  it("writes the group given in `folder` and only the categories asked for", async () => {
    const out = await presets.createPresetFromActive({ name: "Tones", folder: "My looks", categories: ["basic_tone"] });
    expect(out.json).toMatchObject({ group: "My looks", categories: ["basic_tone"], left_out: [] });
    expect(out.json["written"]).toEqual(["blacks", "clarity", "contrast", "dehaze", "exposure", "highlights", "saturation", "shadows", "texture", "vibrance", "whites"]);
    const text = readFileSync(path.join(dir, "Tones.xmp"), "utf8");
    expect(presetIdentity(text).group).toBe("My looks");
    expect(text).not.toContain("crs:HueAdjustmentRed");
  });

  it("refuses a name another preset has, before asking Lightroom anything", async () => {
    mkdirSync(path.join(dir, "Other"));
    await presets.createPresetFromActive({ name: "Taken" });
    writeFileSync(path.join(dir, "Other", "renamed.xmp"), readFileSync(path.join(dir, "Taken.xmp")));
    const before = plugin.received.length;
    const error = await fails({ name: "Taken" });
    expect(error.code).toBe("PRESET_EXISTS");
    expect(error.message).toContain("Taken.xmp");
    expect(plugin.received.length).toBe(before);
  });

  it("never writes over a file of that name, preset or not", async () => {
    writeFileSync(path.join(dir, "Plain.xmp"), "not a preset");
    expect((await fails({ name: "Plain" })).code).toBe("PRESET_EXISTS");
    expect(readFileSync(path.join(dir, "Plain.xmp"), "utf8")).toBe("not a preset");
  });

  it.each([["a/b"], ["what?"], ["CON"], ["lpt1.txt"], ["COM¹"], [" lead"], ["trail "], ["dot."], ["x".repeat(101)], ["tab\there"]])("refuses the name %j", async (name) => {
    expect((await fails({ name })).code).toBe("INVALID_PRESET_NAME");
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses a group with a control character, but takes one with a slash", async () => {
    expect((await fails({ name: "g", folder: "a\nb" })).code).toBe("INVALID_PRESET_NAME");
    await presets.createPresetFromActive({ name: "g", folder: "Looks/Warm" });
    expect(presetIdentity(readFileSync(path.join(dir, "g.xmp"), "utf8")).group).toBe("Looks/Warm");
  });

  it("refuses when the preset folder is missing or unknown", async () => {
    expect((await fails({ name: "x" }, newTools(path.join(tmp, "nowhere")))).code).toBe("PRESET_FOLDER_MISSING");
    expect((await fails({ name: "x" }, newTools(undefined))).code).toBe("PRESET_FOLDER_MISSING");
    expect(existsSync(path.join(tmp, "nowhere"))).toBe(false);
  });

  it("refuses when nothing asked for can go into a preset, and writes no file", async () => {
    Object.assign(lr.settings, map.cameraProfiles().toSdk("Adobe Color"));
    const error = await fails({ name: "Profile only", categories: ["camera_profile"] });
    expect(error.code).toBe("NOTHING_TO_WRITE");
    expect(error.details).toEqual({ left_out: [{ name: "camera_profile", reason: expect.stringMatching(/^an Adobe profile/) }] });
    expect(readdirSync(dir)).toEqual([]);
  });

  it("refuses while a session is open", async () => {
    await presets.beginSession({ intent_id: "test_plain", return_image: "none" });
    expect((await fails({ name: "Mid-session" })).code).toBe("SESSION_ALREADY_ACTIVE");
    expect(readdirSync(dir)).toEqual([]);
  });
});
