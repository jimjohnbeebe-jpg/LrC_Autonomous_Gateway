// lr_create_checkpoint (issue #215): a photo's settings, or canonical settings given, as an LrC-AVG checkpoint through
// LrApplication.addDevelopPresetForPlugin. Beside lr_create_preset_from_active's file route (create.ts), not instead:
// Lightroom wrote such a preset to %APPDATA%\Adobe\Lightroom\Plugin Develop Presets\<toolkit id>\<name>.lrtemplate, it
// never showed in the Develop Presets panel, before or after a restart, and photo:applyDevelopPreset(preset, _PLUGIN)
// applied it [handle: vault LR_SDK_NOTES "Recorded in Phase 4", spike S7 runs 1 and 2, LrC 15.5.1]; the SDK reference
// says the same of the panel [handle: API Reference\modules\LrApplication.html, addDevelopPresetForPlugin]. The plugin
// writes the file, inside Lightroom, so the MSIX redirection of issue #182 does not reach it [inference: Lightroom is
// not a packaged app]. Checkpoints are versioned, never replaced: a name in use is refused [upstream claim: Automaat
// HandlerDevelop.lua createDevelopPreset at 1040453, "use a versioned preset_name"].

import type { BridgeClient } from "../bridge/index.js";
import { ToolError } from "../mcp/errors.js";
import { PROCESS_VERSION_KEY, type CanonicalSettings, type ParamMap } from "../params/index.js";
import { MASK_GROUPS, type MaskGroup } from "../sync/mask.js";
import { checkPresetName } from "./folder.js";
import { brief, listPresets } from "./lightroom.js";
import { selectPresetSettings, type LeftOut } from "./select.js";

export type CheckpointArgs = { name: string; photo_uuid?: string | undefined; settings?: CanonicalSettings | undefined; categories?: MaskGroup[] | undefined };

export const CHECKPOINT_NOTE =
  "A checkpoint is not in the Develop Presets panel (Lightroom keeps plugin presets out of it): lr_list_presets lists it with scope \"plugin\", " +
  "lr_apply_preset applies it, lr_export_preset copies its file. To have a preset in the panel, use lr_create_preset_from_active.";

/** The next free "<name> vN" among the checkpoint names in use. */
function nextVersion(name: string, taken: ReadonlySet<string>): string {
  const stem = name.replace(/\s+v\d+$/i, "");
  let n = 2;
  while (taken.has(`${stem} v${n}`)) n++;
  return `${stem} v${n}`;
}

type Table = { table: Record<string, unknown>; written: string[]; left_out?: LeftOut[] };

/** The SDK table to store: the given settings for the photo's process version and pipeline, or the photo's own (select.ts). */
function tableOf(map: ParamMap, sdk: Record<string, unknown>, args: CheckpointArgs): Table {
  if (args.settings) {
    const read = map.fromSdk(sdk);
    const table = { [PROCESS_VERSION_KEY]: read.process_version, ...map.toSdk(args.settings, { processVersion: read.process_version, pipeline: read.pipeline, hdr: read.hdr }) };
    return { table, written: Object.keys(args.settings).sort() };
  }
  const selection = selectPresetSettings(map, sdk, args.categories ?? [...MASK_GROUPS]);
  if (selection.entries.length <= 1) throw new ToolError("NOTHING_TO_WRITE", "None of the photo's settings in those categories can go into a checkpoint; nothing was written.", false, { left_out: selection.left_out });
  return { table: Object.fromEntries(selection.entries.map((e) => [e.key, e.value])), written: selection.written, left_out: selection.left_out };
}

export async function createCheckpoint(deps: { client: BridgeClient; map: ParamMap }, args: CheckpointArgs): Promise<{ json: Record<string, unknown>; log: Record<string, unknown> }> {
  const { client, map } = deps;
  const name = checkPresetName(args.name, "name");
  const taken = new Set((await listPresets(client)).filter((p) => p.scope === "plugin").map((p) => p.name));
  if (taken.has(name)) {
    const suggested = nextVersion(name, taken);
    throw new ToolError("PRESET_EXISTS", `A checkpoint named "${name}" exists; checkpoints are versioned, not replaced. Use a new name such as "${suggested}".`, false, { suggested_name: suggested });
  }
  const target = args.photo_uuid !== undefined ? { photo_uuid: args.photo_uuid } : {};
  const context = await client.request("get_context", target);
  const { settings: sdk } = await client.request("get_settings", args.photo_uuid !== undefined ? target : { target_uuid: context.uuid });
  const { table, written, left_out } = tableOf(map, sdk, args);
  const created = await client.request("create_checkpoint", { name, settings: table });
  const filename = typeof context["filename"] === "string" ? context["filename"] : null;
  const json = {
    ok: true,
    checkpoint: { ...brief(created), file: created.file ?? null },
    source: { uuid: context.uuid, filename },
    written,
    ...(left_out ? { left_out } : {}),
    visible_in_develop_panel: false,
    note: CHECKPOINT_NOTE,
  };
  return { json, log: { name, uuid: created.uuid, source_uuid: context.uuid, written: written.length } };
}
