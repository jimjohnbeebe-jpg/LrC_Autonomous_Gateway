// Lightroom's own Develop presets and LrC-AVG's checkpoints, as the plugin lists them (issue #215; the port of
// Automaat's list/get/compare_develop_presets, HandlerDevelop.lua at 1040453 [upstream claim]): choosing one
// exactly, reading it in canonical names, comparing two. The choice is made here, not in the plugin (CLAUDE.md
// standing rule b): the plugin lists and reads, the engine decides which preset a call means.

import { isDeepStrictEqual } from "node:util";
import type { BridgeClient, PresetEntry as LrPreset, PresetScope } from "../bridge/index.js";
import { ToolError } from "../mcp/errors.js";
import { hasAiMask, readPreset, withoutVolatileIds, type ParamMap, type SdkSettings } from "../params/index.js";

export type { LrPreset };
/** Which preset a call means: its uuid (getUuid(), from lr_list_presets), or its name, narrowed by folder and scope. */
export type PresetSelector = { preset_uuid?: string | undefined; preset_name?: string | undefined; preset_folder?: string | undefined; preset_scope?: PresetScope | undefined };

export const brief = (p: LrPreset): { name: string; folder: string; scope: PresetScope; uuid: string } => ({ name: p.name, folder: p.folder, scope: p.scope, uuid: p.uuid });

const MAX_SUGGESTIONS = 10;

/**
 * The one preset `sel` names. Entries that share scope and uuid are one preset: Lightroom can list a preset twice,
 * as a favourite and in its own group [upstream claim: HandlerDevelop.lua findPreset]. Several presets that fit a name
 * are refused with the candidates, so the caller asks again by uuid or folder.
 */
export function choosePreset(list: readonly LrPreset[], sel: PresetSelector): LrPreset {
  if (!sel.preset_uuid && !sel.preset_name) throw new ToolError("INVALID_ARGUMENTS", "Name the preset with preset_uuid or preset_name (lr_list_presets lists both).", false);
  const fits = (p: LrPreset): boolean =>
    (sel.preset_uuid === undefined || p.uuid === sel.preset_uuid) &&
    (sel.preset_name === undefined || p.name === sel.preset_name) &&
    (sel.preset_folder === undefined || p.folder === sel.preset_folder) &&
    (sel.preset_scope === undefined || p.scope === sel.preset_scope);
  const matches = list.filter(fits);
  const distinct = [...new Map(matches.map((p) => [`${p.scope}:${p.uuid}`, p])).values()];
  if (distinct.length === 1) return distinct[0] as LrPreset;
  if (distinct.length > 1) {
    throw new ToolError("PRESET_AMBIGUOUS", `${distinct.length} presets fit "${sel.preset_name}": call again with preset_uuid, or with preset_folder or preset_scope.`, false, { candidates: distinct.map(brief) });
  }
  const word = (sel.preset_name ?? "").toLowerCase();
  const similar = word ? list.filter((p) => p.name.toLowerCase().includes(word)).slice(0, MAX_SUGGESTIONS).map(brief) : [];
  throw new ToolError("PRESET_NOT_FOUND", `No preset fits ${JSON.stringify(sel)}. lr_list_presets lists them by folder.`, false, similar.length ? { similar } : undefined);
}

export async function listPresets(client: BridgeClient): Promise<LrPreset[]> {
  return (await client.request("list_presets", {})).presets;
}

export async function presetSettings(client: BridgeClient, p: LrPreset): Promise<SdkSettings> {
  return (await client.request("get_preset", { uuid: p.uuid, scope: p.scope })).settings;
}

/** A preset in canonical names; `raw` adds its SDK table as getSetting() gave it. */
export function describePreset(map: ParamMap, p: LrPreset, sdk: SdkSettings, raw: boolean): Record<string, unknown> {
  const r = readPreset(map, sdk);
  return {
    ...brief(p),
    file: p.file ?? null,
    exportable: p.file !== undefined,
    settings: r.settings,
    ...(r.relative.length ? { relative: r.relative, relative_note: "temperature and tint are relative values (-100..100), as on JPEGs and other rendered files" } : {}),
    other_keys: r.other_keys,
    masks: r.masks,
    ai_masks: hasAiMask(sdk),
    ...(raw ? { raw_settings: sdk } : {}),
  };
}

const union = (a: Iterable<string>, b: Iterable<string>): string[] => [...new Set([...a, ...b])].sort();
const valueOrNull = (v: unknown): unknown => (v === undefined ? null : v);

/**
 * What differs from `base` to `candidate`: canonical settings by name, the other SDK keys by key (their values only
 * with `raw`). null: the preset does not carry it. CorrectionIDs and MaskIDs are left out of the comparison
 * (params\preset-read.ts withoutVolatileIds).
 */
export function diffPresets(map: ParamMap, base: SdkSettings, candidate: SdkSettings, raw: boolean): { changes: unknown[]; other_changes: unknown[] } {
  const a = readPreset(map, base);
  const b = readPreset(map, candidate);
  const changes = union(Object.keys(a.settings), Object.keys(b.settings))
    .filter((n) => !isDeepStrictEqual(a.settings[n], b.settings[n]))
    .map((name) => ({ name, base: valueOrNull(a.settings[name]), candidate: valueOrNull(b.settings[name]) }));
  const other = union(a.other_keys, b.other_keys).filter((k) => !isDeepStrictEqual(withoutVolatileIds(base[k]), withoutVolatileIds(candidate[k])));
  return { changes, other_changes: raw ? other.map((key) => ({ key, base: valueOrNull(base[key]), candidate: valueOrNull(candidate[key]) })) : other };
}
