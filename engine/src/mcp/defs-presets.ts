// The MCP definitions of the Develop preset tools (tools-presets.ts; issue #215).

import { z } from "zod";
import { PRESET_SCOPES } from "../bridge/index.js";
import { MAX_NAME_LENGTH } from "../presets/index.js";
import { MASK_GROUPS } from "../sync/index.js";
import { TIMED, type ToolDef } from "./defs-shared.js";
import { LIST_LIMIT, MAX_PRESET_PHOTOS } from "./tools-presets.js";

const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;
const canonicalValue = z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]);
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const selector = {
  preset_uuid: z.string().min(1).optional().describe("the preset's uuid from lr_list_presets (exact; preferred)"),
  preset_name: z.string().min(1).optional().describe("the preset's name as Lightroom lists it; refused with the candidates when several presets have it"),
  preset_folder: z.string().min(1).optional().describe("the folder (preset group) to look in, to tell same-named presets apart"),
  preset_scope: z.enum(PRESET_SCOPES).optional().describe('"lightroom" (the Develop Presets panel) or "plugin" (LrC-AVG checkpoints)'),
};
const selectorObject = z.object(selector).describe("a preset: preset_uuid, or preset_name with preset_folder / preset_scope when needed");
const raw = z.boolean().optional().describe("true: also the SDK keys and values as Lightroom gives them");

const listArgs = z.object({
  folder: z.string().min(1).optional().describe("only this folder (preset group)"),
  scope: z.enum(PRESET_SCOPES).optional().describe('"lightroom" or "plugin" (checkpoints)'),
  query: z.string().min(1).optional().describe("only presets whose name contains this, case aside"),
  offset: z.number().int().min(0).optional().describe("skip this many (default 0)"),
  limit: z.number().int().min(1).max(LIST_LIMIT.max).optional().describe(`at most this many (default ${LIST_LIMIT.default})`),
});
const getArgs = z.object({ ...selector, raw });
const compareArgs = z.object({ base: selectorObject.describe("the preset compared from (e.g. the approved one)"), candidate: selectorObject.describe("the preset compared to"), raw });
const exportArgs = z.object({
  ...selector,
  destination_dir: z.string().min(1).describe("a full folder path, made if missing, e.g. D:\\Presets"),
  filename: z.string().min(1).max(MAX_NAME_LENGTH).optional().describe("the copy's file name (default: the preset file's own); its extension must be the preset file's"),
});
const applyArgs = z.object({
  ...selector,
  uuids: z.array(z.string().min(1)).min(1).max(MAX_PRESET_PHOTOS).refine(distinct, "uuids must differ").describe("the photos' uuids (lr_get_selected_photos, lr_search_photos)"),
});
const checkpointArgs = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).describe('a new name, versioned (e.g. "Warm look v3"); a name in use is refused; none of < > : " / \\ | ? *'),
  photo_uuid: z.string().min(1).optional().describe("the photo to capture (default: the selected photo)"),
  settings: z
    .record(z.string(), canonicalValue)
    .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
    .optional()
    .describe('canonical name -> ABSOLUTE value, e.g. {"contrast": 15}: the checkpoint holds exactly these (for the photo\'s pipeline) instead of the photo\'s settings'),
  categories: z.array(z.enum(MASK_GROUPS)).min(1).refine(distinct, "categories must differ").optional().describe("without `settings`: the groups of the photo's settings to capture (default: all), as in lr_create_preset_from_active"),
});

export const PRESET_DEFS: ToolDef[] = [
  {
    name: "lr_list_presets",
    title: "List Develop presets",
    description:
      "List the Develop presets Lightroom has (built-in and the user's, scope \"lightroom\") and LrC-AVG checkpoints (scope \"plugin\", which the " +
      "Develop Presets panel does not show), grouped by folder, each with its uuid. Filter by folder, scope or a part of the name; page with offset and " +
      "limit (`next_offset`). Changes nothing.",
    schema: listArgs,
    annotations: READ_ONLY,
    run: (tools, args) => tools.listPresets(args as z.infer<typeof listArgs>),
  },
  {
    name: "lr_get_preset",
    title: "Read a Develop preset",
    description:
      "Read one preset's settings in canonical names (the names lr_sync_series and lr_create_checkpoint take), its file (`file`, `exportable`), the " +
      "SDK keys no canonical name holds (`other_keys`), its masks and whether any is an AI mask. raw: true adds the SDK keys and values. Name the " +
      "preset by preset_uuid (from lr_list_presets) or preset_name. Changes nothing.",
    schema: getArgs,
    annotations: READ_ONLY,
    run: (tools, args) => tools.getPreset(args as z.infer<typeof getArgs>),
  },
  {
    name: "lr_compare_presets",
    title: "Compare two Develop presets",
    description:
      "Diff two presets (e.g. an approved one as `base` and a new checkpoint as `candidate`): `changes` lists each canonical setting that differs " +
      "with both values (null: that preset does not carry it); `other_changes` the other SDK keys that differ (with values when raw: true). Mask ids " +
      "Lightroom renews on every read are not compared. Changes nothing.",
    schema: compareArgs,
    annotations: READ_ONLY,
    run: (tools, args) => tools.comparePresets(args as z.infer<typeof compareArgs>),
  },
  {
    name: "lr_export_preset",
    title: "Copy a preset's file to a folder",
    description:
      "Copy a user preset's or checkpoint's own file (.xmp or .lrtemplate) into `destination_dir`, to keep or share it. Never replaces a file: an " +
      "existing one is refused (PRESET_EXISTS). Built-in presets may have no file (PRESET_NOT_EXPORTABLE). Nothing in Lightroom changes.",
    schema: exportArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.exportPreset(args as z.infer<typeof exportArgs>),
  },
  {
    name: "lr_apply_preset",
    title: "Apply a Develop preset to photos",
    description:
      "Apply one exact preset (preset_uuid, or a preset_name only one preset has) to photos named by uuid; the selection and the module stay as " +
      "they are. Each photo first gets a snapshot \"AVG pre-preset <id>\" (applying it puts the photo back), then the preset as the History step " +
      "\"AVG preset <id>: <name>\". Each applied photo lists the canonical settings the preset changed, before and after. A preset with AI masks has " +
      "them recomputed for each photo (Lightroom Classic 13.3 or later; `ai_update`). " +
      `At most ${MAX_PRESET_PHOTOS} photos. ${TIMED} Tell the user which photos will change before calling. A photo that fails is in \`failed\` and ` +
      "the others go on. Not while a session is open.",
    schema: applyArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.applyPreset(args as z.infer<typeof applyArgs>),
  },
  {
    name: "lr_create_checkpoint",
    title: "Save a preset checkpoint",
    description:
      "Save a photo's current settings (the selected photo, or photo_uuid; `categories` limits the groups), or exactly the canonical `settings` given, " +
      "as an LrC-AVG checkpoint: a versioned Develop preset kept by the plugin. Lightroom does not show checkpoints in the Develop Presets panel; " +
      "lr_list_presets lists them (scope \"plugin\"), lr_apply_preset applies them, lr_compare_presets compares them, lr_export_preset copies their " +
      "file. For a preset in the panel use lr_create_preset_from_active. A name in use is refused with a suggested next version. Nothing on the " +
      "photo changes. Not while a session is open.",
    schema: checkpointArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.createCheckpoint(args as z.infer<typeof checkpointArgs>),
  },
];
