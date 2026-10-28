// The MCP definitions of the catalog tools (tools-catalog.ts): lr_search_photos,
// lr_get_selected_photos, lr_list_collections, lr_list_keywords, lr_set_rating, lr_set_keywords and
// lr_set_gps.

import { z } from "zod";
import {
  DEFAULT_PAGE,
  FILE_TYPES,
  LABEL_VALUES,
  MAX_KEYWORDS,
  MAX_KEYWORD_LENGTH,
  MAX_KEYWORD_PATH_LENGTH,
  MAX_PAGE,
  MAX_PHOTOS,
  isCalendarDay,
  keywordKey,
  keywordLevels,
  type LabelName,
} from "../library/index.js";
import type { ToolDef } from "./defs-shared.js";

const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;
/** The keywords trimmed and case-folded, so two spellings of one keyword compare equal. */
const keys = (list: readonly string[] | undefined): string[] => (list ?? []).map(keywordKey);

export const limit = z.number().int().min(1).max(MAX_PAGE).optional().describe(`how many to return, 1-${MAX_PAGE} (default ${DEFAULT_PAGE})`);
export const offset = z.number().int().min(0).optional().describe("how many to skip, for the next page (default 0)");
const day = z.string().refine(isCalendarDay, "must be a calendar day, YYYY-MM-DD");
const exact = z.string().trim().min(1).max(200);
/** A collection named as lr_list_collections shows it: its name, or "Set / Subset / Name" (issue #218 row 7). */
export const collectionName = z.string().trim().min(1).max(1000);
export const COLLECTION_NAMES = 'its name, or "Set / Name" as lr_list_collections shows its set; a name that several collections share is refused with the candidates';
export const uuids = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_PHOTOS)
  .refine(distinct, "uuids must differ")
  .describe(`the photos' uuids, 1-${MAX_PHOTOS} (from lr_search_photos, lr_get_selected_photos or lr_get_active_photo_context)`);
export const keyword = z
  .string()
  .trim()
  .min(1)
  .max(MAX_KEYWORD_PATH_LENGTH)
  .refine((k) => keywordLevels(k) !== null, 'a keyword path cannot have an empty level ("A||B", "|A", "A|")')
  .refine((k) => (keywordLevels(k) ?? []).every((level) => level.length <= MAX_KEYWORD_LENGTH), `a keyword level has at most ${MAX_KEYWORD_LENGTH} characters`);
const keywords = z
  .array(keyword)
  .max(MAX_KEYWORDS)
  .refine((list) => distinct(keys(list)), "keywords must differ, case aside")
  .optional();

/** A photo listing, as every read tool describes its photos. */
const LISTED = "Each photo: uuid (what lr_set_rating, lr_set_keywords, lr_set_gps and lr_sync_series take), filename, rating (0 = none), capture_time, virtual_copy, copy_name, gps ({latitude, longitude}, null for none) and path (the file); `notice` when the plugin is too old for gps and path.";
/** How lr_set_keywords and lr_list_keywords write a keyword. */
const PATHS = 'A keyword is a plain name or a hierarchy path, parent first with | between the levels ("Places|Europe|Paris"); levels match case aside.';

/** The search descriptor's filters (library\search.ts searchCriteria): lr_search_photos and lr_create_smart_collection. */
export const FILTERS = {
  filename: z.string().min(1).optional().describe("part of the file name"),
  keywords: z.array(z.string().min(1)).min(1).max(MAX_KEYWORDS).optional().describe("keywords the photo has, all of them"),
  rating: z.number().int().min(0).max(5).optional().describe("exactly this many stars, 0-5"),
  start_date: day.optional().describe("captured on or after this day, YYYY-MM-DD"),
  end_date: day.optional().describe("captured on or before this day, YYYY-MM-DD"),
  camera: exact.optional().describe('the camera model exactly as Lightroom indexes it (Library filter bar > Metadata > Camera): "ILCE-7M3" matches, "Sony ILCE-7M3" does not'),
  lens: exact.optional().describe("the lens exactly as Lightroom indexes it (Library filter bar > Metadata > Lens)"),
  iso: z.number().positive().finite().optional().describe("this ISO speed"),
  focal_length: z.number().positive().finite().optional().describe("this focal length in mm"),
  flag: z.enum(["pick", "reject", "none"]).optional().describe("this pick flag"),
  color_label: z.enum(Object.keys(LABEL_VALUES) as [LabelName, ...LabelName[]]).optional().describe('this colour label; "none" for no label'),
  edited: z.boolean().optional().describe("true: only photos with Develop edits; false: only unedited ones"),
  file_type: z.enum(FILE_TYPES).optional().describe("this file type"),
};
export const datesInOrder = (a: { start_date?: string | undefined; end_date?: string | undefined }): boolean => !(a.start_date && a.end_date && a.start_date > a.end_date);

const searchArgs = z
  .object({
    ...FILTERS,
    collection_id: z.number().int().min(0).optional().describe("only photos in this collection (its id from lr_list_collections)"),
    collection: collectionName.optional().describe(`only photos in the collection of this name or path (${COLLECTION_NAMES}); not with collection_id`),
    folder: z.string().trim().min(1).optional().describe("only photos in the catalog folder at this full path, as a listing's `path` shows its folder (D:\\Photos\\2026\\2026-09-07)"),
    include_subfolders: z.boolean().optional().describe("with folder: the photos of its subfolders too (default false)"),
    limit,
    offset,
  })
  .refine(datesInOrder, "start_date must be on or before end_date")
  .refine((a) => a.include_subfolders === undefined || a.folder !== undefined, "include_subfolders needs a folder")
  .refine((a) => a.collection === undefined || a.collection_id === undefined, "give collection or collection_id, not both");

const selectedArgs = z.object({ limit });
const collectionArgs = z.object({ limit, offset });
const keywordListArgs = z.object({
  query: z.string().trim().min(1).max(MAX_KEYWORD_PATH_LENGTH).optional().describe("only the paths that contain this text, case aside"),
  limit,
  offset,
  refresh: z.boolean().optional().describe("true: read the keyword tree from Lightroom again, not the copy kept for 2 minutes (after keywords were changed by hand in Lightroom)"),
});
const ratingArgs = z.object({ uuids, rating: z.number().int().min(0).max(5).describe("stars, 0-5; 0 removes the rating") });
const keywordArgs = z
  .object({
    uuids,
    add: keywords.describe(
      `keywords to add, at most ${MAX_KEYWORDS} (${MAX_KEYWORD_LENGTH} characters a level, ${MAX_KEYWORD_PATH_LENGTH} a path): a plain name is ` +
        "the top-level keyword of that name, created there if missing; a path is the keyword at that place, its missing levels created",
    ),
    remove: keywords.describe(
      `keywords to take off the photos, at most ${MAX_KEYWORDS}: a plain name takes off the top-level keyword of that name only; a path ` +
        "the keyword at that place. The keywords stay in the catalog",
    ),
  })
  .refine((a) => (a.add?.length ?? 0) + (a.remove?.length ?? 0) > 0, "name at least one keyword to add or remove")
  .refine((a) => !keys(a.add).some((k) => keys(a.remove).includes(k)), "a keyword cannot be both added and removed, case aside");
const gpsArgs = z.object({
  uuids,
  position: z
    .object({
      latitude: z.number().min(-90).max(90).describe("decimal degrees, -90 to 90, north positive"),
      longitude: z.number().min(-180).max(180).describe("decimal degrees, -180 to 180, east positive"),
    })
    .nullable()
    .describe("the position to set, replacing any the photos have; null removes their position"),
});

export const WRITE_RULES =
  "Tell the user which photos will change before calling. Ratings, keywords, GPS positions, pick flags, colour labels and text fields are catalog metadata, not Develop settings: " +
  "no History step or snapshot covers them, so the result gives each photo's value before and after, and another call puts it back (for " +
  "keywords: remove exactly the names and paths that were added, or add back those removed). A photo " +
  "that fails is listed in `failed` with the reason, and the others are still written; if Lightroom stops answering, the call stops and the " +
  "error names the photo that may still have been written (`maybe_written`). Not while a session is open.";

export const CATALOG_DEFS: ToolDef[] = [
  {
    name: "lr_search_photos",
    title: "Search the catalog",
    description:
      "Search the Lightroom catalog for photos: by part of the file name, keywords (all of them), an exact star rating, capture dates " +
      "(YYYY-MM-DD, inclusive), a collection (regular or smart: its members) and a folder (its full path; UNKNOWN_FOLDER when the catalog has none there), " +
      "camera and lens (exact indexed names), ISO, focal length, flag, colour label, edited or not, and file type; the filters combine (all must match) " +
      "through Lightroom's own search. With no filter it searches every photo and says so. " +
      `Paged: \`count\` is how many matched, \`photos\` at most \`limit\` of them from \`offset\`, \`has_more\` whether more follow. ${LISTED} Changes nothing.`,
    schema: searchArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.searchPhotos(args as z.infer<typeof searchArgs>),
  },
  {
    name: "lr_get_selected_photos",
    title: "The photos selected in Lightroom",
    description:
      "List the photos selected in Lightroom, the active one first. `count` is how many are selected, `photos` at most `limit` of them. " +
      `${LISTED} Refused with NO_ACTIVE_PHOTO when none is selected. Changes nothing.`,
    schema: selectedArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.getSelectedPhotos(args as z.infer<typeof selectedArgs>),
  },
  {
    name: "lr_list_collections",
    title: "The catalog's collections",
    description:
      "List the catalog's collections, those inside collection sets too: id (what lr_search_photos' collection_id takes), name, set (the " +
      "collection sets it is in, \"Set / Subset\", null at the top level), smart (a smart collection) and photo_count. Paged like " +
      "lr_search_photos. Changes nothing.",
    schema: collectionArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.listCollections(args as z.infer<typeof collectionArgs>),
  },
  {
    name: "lr_list_keywords",
    title: "The catalog's keywords",
    description:
      "List the catalog's keyword tree as paths, the form lr_set_keywords takes: parent first with | between the levels " +
      '("Places|Europe|Paris"; a top-level keyword is its name), a parent before its children, siblings by name. `query` keeps the ' +
      "paths that contain it, case aside. Paged like lr_search_photos: `count` is how many matched, and when more follow, `has_more` is " +
      "true and `truncated` says how to get the rest. The plugin keeps the tree it read for 2 minutes, so paging through it is quick, and " +
      "reads it again after every keyword change the tools make (`cached`: whether this answer used the kept copy); keywords changed by hand " +
      "in Lightroom show after at most 2 minutes, or at once with refresh: true. Changes nothing.",
    schema: keywordListArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.listKeywords(args as z.infer<typeof keywordListArgs>),
  },
  {
    name: "lr_set_rating",
    title: "Set star ratings",
    description: `Set the star rating of photos named by uuid: 0-5 stars, 0 removes the rating. ${WRITE_RULES}`,
    schema: ratingArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setRating(args as z.infer<typeof ratingArgs>),
  },
  {
    name: "lr_set_keywords",
    title: "Add or remove keywords",
    description:
      `Add keywords to and/or remove keywords from photos named by uuid. ${PATHS} A plain name always means the top-level keyword of ` +
      "that name, to add (created there if missing) and to remove alike, never a deeper keyword of the same name: to reach a nested " +
      "keyword, give its path (lr_list_keywords lists them). `before` and `after` give each photo's keywords as paths. A removed keyword, " +
      `and every level created, stays in the catalog's Keyword List: this tool deletes no keyword. ${WRITE_RULES}`,
    schema: keywordArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setKeywords(args as z.infer<typeof keywordArgs>),
  },
  {
    name: "lr_set_gps",
    title: "Set or remove GPS positions",
    description:
      "Set the GPS position of photos named by uuid, in decimal degrees, replacing any position they have; `position` null removes it. " +
      `This tool neither reads nor writes altitude. \`before\` and \`after\` give each photo's position ({latitude, longitude}, or null for none). ${WRITE_RULES}`,
    schema: gpsArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setGps(args as z.infer<typeof gpsArgs>),
  },
];
