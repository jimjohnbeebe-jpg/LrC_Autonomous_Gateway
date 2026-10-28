// A Lightroom Develop preset's settings (preset:getSetting(), the bridge's get_preset; issue #215) in canonical
// names, and the mask-table facts lr_apply_preset and lr_compare_presets need. A preset holds a partial settings
// table, with no pipeline and maybe no process version, so it is not read through fromSdk (map.ts), which needs both.
// Each key is read by its raw-pipeline name first, then by its rendered one (temperature and tint as relative
// values, -100..100) [inference: the two pipelines' specs differ only there, map.ts spec()]. Whether getSetting()
// gives the keys and value types getDevelopSettings() gives is [unverified] until Jim's `npm run presets:check`; the
// SDK reference lists an older, shorter set [handle: D:\Developer\LightRoom Classic Dev Kit\API Reference\modules\
// LrDevelopPreset.html, preset:getSetting()].

import { isEmptyLook } from "./camera-profiles.js";
import { CAMERA_PROFILE_PARAM } from "./canonical.js";
import type { ParamMap, SdkSettings } from "./map.js";
import { C, M, MASK_TABLE_KEY, WHAT } from "./mask-table.js";
import { CAMERA_PROFILE_KEY, CONVERT_TO_GRAYSCALE_KEY, LOOK_KEY } from "./preset-keys.js";

export type PresetReading = {
  /** Canonical name -> value as the preset holds it. */
  settings: Record<string, unknown>;
  /** The canonical names read from a rendered-pipeline key: temperature and tint as relative values. */
  relative: string[];
  /** The preset's SDK keys no canonical name holds (process version, white balance mode, masks, ...). */
  other_keys: string[];
  /** How many mask corrections the preset carries. */
  masks: number;
};

const corrections = (sdk: Readonly<SdkSettings>): Array<Record<string, unknown>> => {
  const table = sdk[MASK_TABLE_KEY];
  return Array.isArray(table) ? table.filter((c): c is Record<string, unknown> => typeof c === "object" && c !== null) : [];
};

const hasAiPart = (c: Record<string, unknown>): boolean => {
  const parts = c[C.masks];
  return Array.isArray(parts) && parts.some((m) => typeof m === "object" && m !== null && (m as Record<string, unknown>)[M.what] === WHAT.image);
};

/** True when the settings carry an AI mask (a Mask/Image part), which Lightroom computes per photo [upstream claim: Automaat efce08f]. */
export const hasAiMask = (sdk: Readonly<SdkSettings>): boolean => corrections(sdk).some(hasAiPart);

/** The CorrectionIDs of the corrections with an AI part, for update_ai_settings' watch (mask-ops.ts aiWatch). */
export const aiCorrectionIds = (sdk: Readonly<SdkSettings>): string[] => corrections(sdk).filter(hasAiPart).map((c) => String(c[C.id]));

/**
 * A value with every CorrectionID and MaskID left out: Lightroom mints them afresh on each getSetting() call, so they
 * name a read, not the preset [upstream claim: Automaat HandlerDevelop.lua VOLATILE_SETTING_KEYS, at 1040453].
 */
export function withoutVolatileIds(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutVolatileIds);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).filter(([k]) => k !== C.id && k !== M.id).map(([k, v]) => [k, withoutVolatileIds(v)]));
}

export function readPreset(map: ParamMap, sdk: Readonly<SdkSettings>): PresetReading {
  const settings: Record<string, unknown> = {};
  const relative: string[] = [];
  const used = new Set<string>();
  for (const name of map.names()) {
    if (name === CAMERA_PROFILE_PARAM) continue;
    const rawKey = map.sdkKey(name, "raw");
    const renderedKey = map.sdkKey(name, "rendered");
    const key = rawKey !== undefined && rawKey in sdk ? rawKey : renderedKey !== undefined && renderedKey in sdk ? renderedKey : undefined;
    if (key === undefined) continue;
    const value = sdk[key];
    settings[name] = map.spec(name)?.kind === "curve" && isEmptyLook(value) ? [] : value; // Lua's empty table may arrive as {}
    used.add(key);
    if (key !== rawKey) relative.push(name);
  }
  if (CAMERA_PROFILE_KEY in sdk) {
    const id = map.cameraProfiles().identify(sdk[CAMERA_PROFILE_KEY], sdk[LOOK_KEY], sdk[CONVERT_TO_GRAYSCALE_KEY] ?? false);
    if (id.name !== null) {
      settings[CAMERA_PROFILE_PARAM] = id.name;
      for (const k of [CAMERA_PROFILE_KEY, LOOK_KEY, CONVERT_TO_GRAYSCALE_KEY]) used.add(k);
    }
  }
  return { settings, relative, other_keys: Object.keys(sdk).filter((k) => !used.has(k)).sort(), masks: corrections(sdk).length };
}
