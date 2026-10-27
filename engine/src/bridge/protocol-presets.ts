// Result schemas of the Develop preset commands (plugin\LrC-AVG.lrplugin\Presets.lua; GitHub issue #215), kept apart
// from protocol-results.ts by size; protocol.ts merges them into COMMANDS. Lightroom's preset API is LrApplication
// developPresetFolders, getDevelopPresetsForPlugin and addDevelopPresetForPlugin, LrDevelopPreset getName, getUuid,
// getFile and getSetting, and photo:applyDevelopPreset [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\
// modules\LrApplication.html, LrDevelopPreset.html, LrPhoto.html].

import { z } from "zod";

/** "lightroom": a preset the Develop Presets panel lists; "plugin": an LrC-AVG checkpoint (addDevelopPresetForPlugin), which it does not. */
export const PRESET_SCOPES = ["lightroom", "plugin"] as const;
export type PresetScope = (typeof PRESET_SCOPES)[number];

/** One preset as the plugin lists it; `file` is getFile(), absent when Lightroom gives none. */
export const presetEntry = z.object({
  name: z.string(),
  folder: z.string(),
  scope: z.enum(PRESET_SCOPES),
  uuid: z.string().min(1),
  file: z.string().optional(),
});
export type PresetEntry = z.infer<typeof presetEntry>;

export const PRESET_RESULTS = {
  list_presets: z.object({ presets: z.array(presetEntry) }),
  // getSetting() as a plain table: nested tables (curves, masks) kept, anything else refused by the plugin.
  get_preset: presetEntry.extend({ settings: z.record(z.string(), z.unknown()) }),
  // The photo's settings read back after applyDevelopPreset, in the write gate named history_name.
  apply_preset: z.object({ uuid: z.string(), read_back: z.record(z.string(), z.unknown()), apply_ms: z.number().optional() }),
  create_checkpoint: presetEntry,
} as const;
