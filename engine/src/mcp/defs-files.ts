// The MCP definitions of the collection and file tools (GitHub issue #55; tools-collections.ts,
// tools-files.ts): lr_create_collection, lr_add_to_collection, lr_export_photos and lr_import_photos.

import { z } from "zod";
import { MAX_COLLECTION_PHOTOS, MAX_EXPORT_PHOTOS, isAbsoluteFolder } from "../library/index.js";
import { setLevels } from "./tools-collections.js";
import type { ToolDef } from "./defs-shared.js";

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

const createArgs = z.object({
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
    quality: z.number().int().min(1).max(100).optional().describe("JPEG quality 1-100 (default 90)"),
    bit_depth: z.union([z.literal(8), z.literal(16)]).optional().describe("PNG and TIFF bits per channel, 8 or 16 (default 8)"),
    long_edge: pixels.optional().describe("resize so the long edge is at most this many pixels"),
    width: pixels.optional().describe("with height: resize to fit inside width x height pixels, keeping the aspect ratio"),
    height: pixels.optional().describe("with width, as above"),
    on_existing: z.enum(["rename", "overwrite", "skip"]).optional().describe('a file of that name already in the folder: rename the new one ("name-2.jpg", default), overwrite it, or skip'),
  })
  .refine((a) => (a.width === undefined) === (a.height === undefined), "give width and height together")
  .refine((a) => !(a.long_edge !== undefined && a.width !== undefined), "give long_edge, or width and height, not both")
  .refine((a) => a.format === "jpeg" || a.quality === undefined, "quality is for jpeg only")
  .refine((a) => a.format === "png" || a.format === "tiff" || a.bit_depth === undefined, "bit_depth is for png and tiff only")
  .refine((a) => a.format !== "original" || (a.long_edge === undefined && a.width === undefined), "an original cannot be resized");
const importArgs = z.object({
  source: folder.describe("a photo file, or a folder of them (an absolute path; ~ is the user's home folder)"),
  copy_to: folder
    .optional()
    .describe("copy the files here first, keeping their folders below the source, and import the copies (never overwrites; a same-size file already there counts as the copy). Omit to import the files where they are"),
  recursive: z.boolean().optional().describe("look in the source's subfolders too (default true)"),
});

const META_WRITE =
  "Tell the user what will change before calling. Runs only between editing sessions. If Lightroom stops answering, the call stops and the " +
  "error lists what was done.";
const TIMED =
  "A call works for about 40 seconds, then stops starting new photos and returns `not_yet` and `next`, saying how to go on: keep calling " +
  "until `not_yet` is gone, and tell the user how far along it is.";

export const FILE_DEFS: ToolDef[] = [
  {
    name: "lr_create_collection",
    title: "Create a collection",
    description:
      "Create a collection (not a smart collection), at the top level or inside collection sets, which are created when missing. If one of " +
      "that name is already there (case aside), it is returned with `created` false and nothing is made. Returns its id, for " +
      `lr_add_to_collection and lr_search_photos' collection_id. Set names containing "/" cannot be given. Collections are not deleted by any tool. ${META_WRITE}`,
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
      "(`already_in_catalog`, with its uuid); a photo imported earlier from another path is not recognised. Returns the uuids, for " +
      "lr_add_to_collection, lr_set_keywords and the other tools. No develop or metadata preset is passed to the import, and no tool can remove a photo from " +
      `the catalog: the user does that in Lightroom (Library > Remove Photo). ${TIMED} ${META_WRITE}`,
    schema: importArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.importPhotos(args as z.infer<typeof importArgs>),
  },
];
