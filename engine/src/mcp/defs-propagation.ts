// The MCP definitions of the propagation tools (tools-propagation.ts): lr_sync_series and lr_create_preset_from_active.

import { z } from "zod";
import { DEFAULT_GROUP, MAX_NAME_LENGTH } from "../presets/index.js";
import { MASK_GROUPS, MAX_ADAPTIVE_TARGETS, MAX_TARGETS } from "../sync/index.js";
import { longEdge, type ToolDef } from "./defs-shared.js";

const canonicalValue = z.union([z.number(), z.boolean(), z.string(), z.array(z.number())]);
const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;

const syncArgs = z.object({
  source: z
    .union([
      z.strictObject({ session_id: z.string().min(1).describe("an accepted session's id: its recipe is synced") }),
      z.strictObject({ recipe_path: z.string().min(1).describe("a .recipe.json file in the log folder (lr_end_session returns recipe_path)") }),
      z.strictObject({
        settings: z
          .record(z.string(), canonicalValue)
          .refine((s) => Object.keys(s).length > 0, "settings must name at least one parameter")
          .describe("canonical name -> ABSOLUTE value, e.g. {\"contrast\": 15, \"vibrance\": 10}"),
      }),
    ])
    .describe("where the settings come from: {session_id}, {recipe_path} or {settings}"),
  targets: z
    .union([
      z.literal("selected"),
      z.strictObject({
        uuids: z.array(z.string().min(1)).min(1).max(MAX_TARGETS).refine(distinct, "uuids must differ").describe("the photos' uuids (from lr_get_active_photo_context or an earlier result)"),
      }),
    ])
    .describe('"selected": the photos selected in Lightroom; or {uuids: [...]}. The source photo is left out'),
  parameter_mask: z
    .array(z.enum(MASK_GROUPS))
    .min(1)
    .refine(distinct, "groups must differ")
    .optional()
    .describe("the groups to copy (default: all): basic_tone (exposure, contrast, highlights, shadows, whites, blacks, texture, clarity, dehaze, vibrance, saturation), white_balance, tone_curve, hsl, grading, detail (sharpening, noise), lens, camera_profile"),
  adaptive_exposure: z
    .boolean()
    .describe("true (same-scene bursts): exposure is not copied; each target's exposure is moved until its mean luma matches the source photo's within 2/255"),
  return_image: z.enum(["sheet", "none"]).optional().describe('"sheet" (default): the source and the first three targets side by side; "none"'),
  long_edge: longEdge,
});

const presetArgs = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).describe("the preset's name in the Develop Presets panel; also its file name, so none of < > : \" / \\ | ? *"),
  folder: z.string().min(1).max(MAX_NAME_LENGTH).optional().describe(`the preset group it is listed under (default "${DEFAULT_GROUP}")`),
  categories: z
    .array(z.enum(MASK_GROUPS))
    .min(1)
    .refine(distinct, "categories must differ")
    .optional()
    .describe("the setting groups the preset carries (default: all), as in lr_sync_series' parameter_mask: basic_tone, white_balance, tone_curve, hsl, grading, detail, lens, camera_profile"),
});

export const PROPAGATION_DEFS: ToolDef[] = [
  {
    name: "lr_sync_series",
    title: "Sync settings to other photos",
    description:
      "Copy settings onto other photos: the recipe of a session that ended with accept ({session_id}), a recipe file ({recipe_path}), or " +
      "canonical settings as absolute values ({settings}). Targets are the photos selected in Lightroom (\"selected\") or {uuids}; the " +
      "photos are written by uuid and the selection is not changed. `parameter_mask` limits what is copied, by group. For each target " +
      "the engine takes a Develop snapshot \"AVG pre-sync <id>\" (applying it undoes the sync), writes the copied settings as one History " +
      "step \"AVG sync <id>\" and reads them back. adaptive_exposure (for bursts of the same scene): exposure is not copied; each target " +
      "is rendered and its exposure moved (\"AVG sync <id> exposure k\", at most 4 renders of about 3.5 s) until its mean luma is within " +
      "2/255 of the source photo's; the source photo must still hold the recipe's settings (else SOURCE_CHANGED). " +
      `At most ${MAX_TARGETS} targets per call, ${MAX_ADAPTIVE_TARGETS} with adaptive_exposure: sync more in several calls. ` +
      "Tell the user which photos will change before calling. A target that fails is listed in `skipped` with the reason, and the " +
      "others still sync; if Lightroom stops answering, the call stops and the error names the photo it stopped at and any step " +
      "that may still have been written (`maybe_written`). Across pipelines (a raw recipe onto a JPEG, or the reverse) the shared " +
      "groups are written and the target's `not_transferable` lists white_balance (Kelvin on raw, relative -100..100 on rendered: the " +
      "numbers mean different things) and camera_profile (each pipeline has its own profiles) with the reason; a target that could take " +
      "nothing is skipped (NOTHING_TRANSFERABLE). Returns applied, skipped, per_target_exposure_offsets (target exposure minus the source's), each target's " +
      "pipeline, History steps, snapshot and not_transferable, and a contact sheet. Not while a session is open.",
    schema: syncArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.syncSeries(args as z.infer<typeof syncArgs>),
  },
  {
    name: "lr_create_preset_from_active",
    title: "Save the photo's settings as a Develop preset",
    description:
      "Save the selected photo's current Develop settings as a Lightroom Develop preset: an .xmp preset file in Lightroom's preset " +
      `folder, listed under the group \`folder\` (default "${DEFAULT_GROUP}"). Nothing in Lightroom changes. Lightroom shows the new ` +
      "preset only after it restarts: tell the user to quit Lightroom (File > Exit) and start it again. `categories` limits which " +
      "setting groups the preset carries. Settings Lightroom's own presets leave out are left out too, and listed in `left_out` with " +
      "the reason (e.g. temperature and tint when white balance is As Shot, i.e. never edited: every temperature or tint this engine " +
      "writes sets it to Custom; an Adobe camera profile on a raw photo, whose preset form has not been " +
      "observed). A JPEG's (rendered pipeline) white balance and profile are written as Lightroom writes them. A name another preset already has is refused (PRESET_EXISTS). Returns the file's path, the group, the settings " +
      "written and left out, and the source photo. Not while a session is open.",
    schema: presetArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    run: (tools, args) => tools.createPresetFromActive(args as z.infer<typeof presetArgs>),
  },
];
