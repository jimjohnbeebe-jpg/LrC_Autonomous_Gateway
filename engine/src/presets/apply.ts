// lr_apply_preset on one photo (issue #215), through the safety layer of epic #207: a snapshot first, the preset in a
// write gate named "AVG preset …", the settings before and after in canonical names, and the AI masks the preset
// brought recomputed for this photo. Automaat applies presets without a snapshot [upstream claim: HandlerDevelop.lua
// applyDevelopPreset at 1040453]. The recompute is update_ai_settings (Masks.lua): photo:updateAISettings() in its own
// write gate, behind Needs.lua's 13.3 gate, and with the plugin's guard over the AI entries (Pending.lua). It is never
// applyDevelopPreset's own updateAISettings argument, which reportedly brings back the modal "calculating AI settings"
// lockup [upstream claim: Automaat commit efce08f, citing Adobe community bug 14459471].

import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { BridgeClient } from "../bridge/index.js";
import { toToolError } from "../mcp/errors.js";
import { aiCorrectionIds, aiWatch, readPreset, type ParamMap, type SdkSettings } from "../params/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import type { LrPreset } from "./lightroom.js";

export type ApplyNames = { snapshot: string; history: string };
export type ApplyOutcome = {
  uuid: string;
  snapshot: { id: string; name: string };
  history_name: string;
  /** The canonical settings the preset changed, before and after. */
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  /** Other SDK keys that changed (masks, modes, ...). */
  other_changed: string[];
  /** The AI-mask recompute: the update's state ("started", ...), or why it did not start. Absent when the preset carries no AI mask. */
  ai_update?: string;
};

/** Canonical settings of a photo's table, by the photo's pipeline when it reads; else read as a preset (preset-read.ts). */
function canonical(map: ParamMap, sdk: SdkSettings): Record<string, unknown> {
  try {
    return map.fromSdk(sdk).settings;
  } catch {
    return readPreset(map, sdk).settings;
  }
}

function changes(map: ParamMap, before: SdkSettings, after: SdkSettings): Pick<ApplyOutcome, "before" | "after" | "other_changed"> {
  const [a, b] = [canonical(map, before), canonical(map, after)];
  const out: Pick<ApplyOutcome, "before" | "after" | "other_changed"> = { before: {}, after: {}, other_changed: [] };
  for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (isDeepStrictEqual(a[name], b[name])) continue;
    out.before[name] = a[name] ?? null;
    out.after[name] = b[name] ?? null;
  }
  const others = readPreset(map, { ...before, ...after }).other_keys;
  out.other_changed = others.filter((k) => !isDeepStrictEqual(before[k], after[k])).sort();
  return out;
}

async function recomputeAi(client: BridgeClient, uuid: string, readBack: SdkSettings): Promise<string> {
  const ids = aiCorrectionIds(readBack);
  if (ids.length === 0) return "no AI mask on the photo after the preset";
  try {
    const u = await client.request("update_ai_settings", { photo_uuid: uuid, request_id: randomUUID(), watch: aiWatch(ids) });
    return u.state ?? u.status ?? "started";
  } catch (err) {
    return `not started: ${toToolError(err).message}`;
  }
}

export async function applyPresetToPhoto(deps: { client: BridgeClient; map: ParamMap }, preset: LrPreset, presetHasAi: boolean, uuid: string, names: ApplyNames): Promise<ApplyOutcome> {
  const { client, map } = deps;
  const before = (await client.request("get_settings", { photo_uuid: uuid })).settings;
  const snap = await client.request("create_snapshot", { photo_uuid: uuid, name: names.snapshot });
  const r = await client.request("apply_preset", { photo_uuid: uuid, preset_uuid: preset.uuid, scope: preset.scope, history_name: names.history }, { timeoutMs: WRITE_TIMEOUT_MS });
  const outcome: ApplyOutcome = { uuid, snapshot: { id: snap.snapshot_id, name: names.snapshot }, history_name: names.history, ...changes(map, before, r.read_back) };
  if (presetHasAi) outcome.ai_update = await recomputeAi(client, uuid, r.read_back);
  return outcome;
}
