// lr_create_preset_from_active (MCP_TOOLS; PRD 6.11; PHASE4_PLAN row 9): the selected photo's
// settings as a Develop preset file, by the mechanism S7 chose: an .xmp file that Lightroom lists
// after its next restart, not before [handle: docs\reports\phase4\S7.md Verdict 1]. Reads the photo
// through the bridge (nothing is written to Lightroom), chooses the settings (select.ts), writes the
// file (xmp-write.ts, folder.ts).

import { randomUUID } from "node:crypto";
import type { BridgeClient } from "../bridge/index.js";
import { ToolError } from "../mcp/errors.js";
import type { ParamMap } from "../params/index.js";
import type { PresetFormat } from "../params/preset-format.js";
import { MASK_GROUPS, type MaskGroup } from "../sync/mask.js";
import { checkFree, checkPresetName, DEFAULT_GROUP, writePresetFile } from "./folder.js";
import { selectPresetSettings } from "./select.js";
import { renderPreset } from "./xmp-write.js";

export type CreatePresetArgs = { name: string; folder?: string | undefined; categories?: MaskGroup[] | undefined };
export type CreatePresetDeps = {
  client: BridgeClient;
  map: ParamMap;
  format: PresetFormat;
  /** Lightroom's preset folder (folder.ts defaultPresetDir). */
  dir: string;
  newUuid?: () => string;
};

export const RESTART_NOTE =
  "Lightroom lists a new preset file only after it restarts (S7): quit Lightroom (File > Exit) and start it again, then the preset is in the Develop Presets panel under its group.";

/** A preset uuid in the form of Lightroom's own: 32 upper-case hex digits (crs:UUID in both reference files). */
export function newPresetUuid(): string {
  return randomUUID().replace(/-/g, "").toUpperCase();
}

export async function createPreset(deps: CreatePresetDeps, args: CreatePresetArgs): Promise<{ json: Record<string, unknown>; log: Record<string, unknown> }> {
  const name = checkPresetName(args.name, "name");
  const group = checkPresetName(args.folder ?? DEFAULT_GROUP, "folder");
  const categories = args.categories ?? [...MASK_GROUPS];
  checkFree(deps.dir, name);

  const context = await deps.client.request("get_context", {});
  const { settings } = await deps.client.request("get_settings", { target_uuid: context.uuid });
  const filename = typeof context["filename"] === "string" ? context["filename"] : null;
  const selection = selectPresetSettings(deps.map, settings, categories);
  if (selection.written.length === 0) {
    throw new ToolError("NOTHING_TO_WRITE", `None of the photo's settings in ${categories.join(", ")} can go into a preset; nothing was written.`, false, { left_out: selection.left_out });
  }

  const uuid = (deps.newUuid ?? newPresetUuid)();
  const path = writePresetFile(deps.dir, name, renderPreset(deps.format, { uuid, name, group, entries: selection.entries }));
  const json = {
    ok: true,
    path,
    name,
    group,
    uuid,
    categories,
    source: { uuid: context.uuid, filename, process_version: selection.process_version },
    written: selection.written,
    left_out: selection.left_out,
    restart_required: true,
    note: RESTART_NOTE,
  };
  return { json, log: { path, uuid, group, source_uuid: context.uuid, written: selection.written.length, left_out: selection.left_out.map((l) => l.name) } };
}
