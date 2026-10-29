// The MCP definitions of the collection and file tools (GitHub issue #55; tools-collections.ts,
// tools-files.ts): lr_create_collection, lr_add_to_collection, lr_export_photos and lr_import_photos; and
// lr_apply_denoise (tools-denoise.ts, issue #190), which works through photos the same way.

import { z } from "zod";
import { MAX_COLLECTION_PHOTOS, MAX_EXPORT_PHOTOS, isAbsoluteFolder, templateProblem } from "../library/index.js";
import { setLevels } from "./tools-collections.js";
import { TIMED, type ToolDef } from "./defs-shared.js";

const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;
const uuids = (max: number) =>
  z
    .array(z.string().min(1))
    .min(1)
    .max(max)
    .refine(distinct, "uuids must differ")
    .describe(`the photos' uuids, 1-${max} (from lr_search_photos, lr_get_selected_photos or lr_import_photos)`);
const folder = z
  .string()
  .trim()
  .min(1)
  .refine(isAbsoluteFolder, "must be an absolute path, such as C:\\Users\\<name>\\Pictures\\Exports; ~ is the user's home folder");
const pixels = z.number().int().min(1).max(65000);

export const createArgs = z.object({
  name: z.string().trim().min(1).max(255).describe("the collection's name"),
  set: z
    .string()
    .trim()
    .min(1)
    .refine((s) => setLevels(s).every((level) => level.length > 0), 'a set path cannot have an empty level ("2026 / / Trips")')
    .optional()
    .describe('the collection sets to put it in, top level first, as lr_list_collections writes them ("2026 / Trips"); missing sets are created. Omit for the top level'),
});
const addArgs = z.object({
  collection_id: z.number().int().min(0).describe("the collection's id, from lr_list_collections or lr_create_collection"),
  uuids: uuids(MAX_COLLECTION_PHOTOS),
  remove: z.boolean().optional().describe("true takes the photos out of the collection instead (to undo an add); default false"),
});
const exportArgs = z
  .object({
    uuids: uuids(MAX_EXPORT_PHOTOS),
    folder: folder.describe("the folder to write the files into, made if missing; an absolute path, a leading ~ being the user's home folder"),
    format: z.enum(["jpeg", "png", "tiff", "original"]).describe("jpeg, png, tiff, or original (the photo's own file, unedited)"),
    quality: z.number().int().min(1).max(100).optional().describe("JPEG quality 1-100 (default 90); ignored for the other formats"),
    bit_depth: z.union([z.literal(8), z.literal(16)]).optional().describe("PNG and TIFF bits per channel, 8 or 16 (default 8); ignored for jpeg and original"),
    long_edge: pixels.optional().describe("resize so the long edge is at most this many pixels; wins over width and height; ignored for original"),
    width: pixels.optional().describe("with height: resize to fit inside width x height pixels, keeping the aspect ratio; ignored with long_edge and for original"),
    height: pixels.optional().describe("with width, as above"),
    on_existing: z.enum(["rename", "overwrite", "skip"]).optional().describe('a file of that name already in the folder: rename the new one ("name-2.jpg", default), overwrite it, or skip'),
  })
  // Only a lone width or height that would be used is refused. An argument that does not apply is ignored
  // (tools-files.ts exportPayload): a model that fills every optional field could not export while these
  // were refused [handle: docs\reports\phase8.5\clients-probe.json clients[1], OpenCode].
  .refine(
    (a) => a.format === "original" || a.long_edge !== undefined || (a.width === undefined) === (a.height === undefined),
    "give width and height together",
  );
// Issue #139 gap 1: the tokens and refusals are library\capture-date.ts templateProblem.
const template = (isFolder: boolean) =>
  z
    .string()
    .trim()
    .min(1)
    .max(200)
    .superRefine((t, ctx) => {
      const problem = templateProblem(t, isFolder);
      if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
    });
const importArgs = z
  .object({
    source: folder.describe("a photo file, or a folder of them (an absolute path; ~ is the user's home folder)"),
    copy_to: folder
      .optional()
      .describe("copy the files here first, keeping their folders below the source, and import the copies (never overwrites; a same-size file already there counts as the copy). Omit to import the files where they are"),
    folder_template: template(true)
      .optional()
      .describe("with copy_to: the folder below copy_to for each file, from its capture date instead of its folder below the source, e.g. \"{yyyy}-{mm}-{dd}\" or \"{yyyy}/{yyyy}-{mm}-{dd}\" (a level per / or \\). Tokens {yyyy} {mm} {dd} {name} (the source file's name without extension)"),
    name_template: template(false)
      .optional()
      .describe("with copy_to: the copy's name without extension (the extension and the XMP sidecar follow it), e.g. \"{yyyy}{mm}{dd}-{name}\"; must hold {name}; no \\ or /"),
    recursive: z.boolean().optional().describe("look in the source's subfolders too (default true)"),
    resume_after: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("to go on after a call that ran out of time: that call's `resume_after` (a source file's path); the call starts with the file after it. Omit to start from the first file"),
    dry_run: z.boolean().optional().describe("true: return `planned` (each file's source, the path it would have and its capture_date) and copy, import and change nothing; default false"),
  })
  .refine((a) => a.copy_to !== undefined || (a.folder_template === undefined && a.name_template === undefined), "folder_template and name_template need copy_to");

const denoiseArgs = z.object({
  uuids: uuids(100),
  amount: z.number().int().min(1).max(100).describe("Denoise amount, 1-100, as Lightroom's Detail panel shows it (50 is its default)"),
});

export const META_WRITE =
  "Tell the user what will change before calling. Runs only between editing sessions. If Lightroom stops answering, the call stops and the " +
  "error lists what was done.";

export const FILE_DEFS: ToolDef[] = [
  {
    name: "lr_create_collection",
    title: "Create a collection",
    description:
      "Create a collection (not a smart collection), at the top level or inside collection sets, which are created when missing. If one of " +
      "that name is already there (case aside), it is returned with `created` false and nothing is made. Returns its id, for " +
      `lr_add_to_collection and lr_search_photos' collection_id. Set names containing "/" cannot be given. lr_create_smart_collection makes a smart one, lr_delete_collection deletes one. ${META_WRITE}`,
    schema: createArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.createCollection(args as z.infer<typeof createArgs>),
  },
  {
    name: "lr_add_to_collection",
    title: "Add photos to a collection",
    description:
      "Put photos named by uuid into a collection named by id, or take them out with remove: true. Refused for a smart collection. Returns " +
      "the photos `added` (or `removed`), those `unchanged` (already as asked), `not_found` (no photo has that uuid) and `not_taken` (Lightroom " +
      `read them back unchanged). Only collection membership changes, never the photos. ${META_WRITE}`,
    schema: addArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.addToCollection(args as z.infer<typeof addArgs>),
  },
  {
    name: "lr_export_photos",
    title: "Export photos to a folder",
    description:
      "Export photos named by uuid, with their Lightroom edits, to files in a folder: JPEG, PNG, TIFF (sRGB, no output sharpening) or the " +
      "original file; full size, or resized by long_edge or to fit width x height. Each photo's `files` give the paths written, and whether a " +
      `name already there was renamed, overwritten or skipped. Writes only into that folder; the catalog and the photos are unchanged. ${TIMED} ${META_WRITE}`,
    schema: exportArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.exportPhotos(args as z.infer<typeof exportArgs>),
  },
  {
    name: "lr_import_photos",
    title: "Import photos into the catalog",
    description:
      "Import a photo file, or the photo files in a folder (raw, DNG, JPEG, TIFF, PNG, HEIC, PSD), into the Lightroom catalog: where they " +
      "are, or copied first into copy_to (do that for a memory card). A file the catalog already holds at that path is not imported again " +
      "(`already_in_catalog`, with its uuid); a photo imported earlier from another path is not recognised. Returns the uuids, each with its source file, its path in the catalog and capture_time, for " +
      "lr_add_to_collection, lr_set_keywords and the other tools. With copy_to, folder_template and name_template sort and rename the copies by capture " +
      "date, which the engine reads from NEF, DNG and the other TIFF-based raws, TIFF and JPEG; a file it cannot read (CR3, RAF, HEIC, PNG, PSD) fails " +
      "alone with NO_CAPTURE_DATE. dry_run: true shows where each file would go and changes nothing. No develop or metadata preset is passed to the import; lr_remove_photos removes photos from " +
      `the catalog again. ${TIMED} Here \`resume_after\` comes with \`not_yet\`: pass it back to go on ` +
      `from the next file. ${META_WRITE}`,
    schema: importArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.importPhotos(args as z.infer<typeof importArgs>),
  },
  {
    name: "lr_apply_denoise",
    title: "Apply AI Denoise",
    description:
      "Turn on Lightroom's AI Denoise (Detail panel) at `amount` on photos named by uuid, or change the amount where it is on; Lightroom Classic 15 or later. " +
      "For each photo Lightroom switches to Develop and selects it, then the module and the selection are put back. Each photo's `status`: applied, " +
      "amount_changed (`previous_amount`), unchanged (already at that amount), skipped (Lightroom says Denoise is not available for it, `reason`) or " +
      "failed (`reason`; Lightroom can show a change and not save it while it still computes: try again later). A changed photo first gets a snapshot " +
      "(`snapshot`, \"AVG pre-denoise …\"), which puts it back. Lightroom computes Denoise in the background, about 10 s a photo. Not while a session is open. " +
      `${TIMED}`,
    schema: denoiseArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.applyDenoise(args as z.infer<typeof denoiseArgs>),
  },
];
