// The MCP definitions of the catalog tools (tools-catalog.ts): lr_search_photos,
// lr_get_selected_photos, lr_list_collections, lr_list_keywords, lr_set_rating, lr_set_keywords and
// lr_set_gps.

import { z } from "zod";
import { DEFAULT_PAGE, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, MAX_PAGE, MAX_PHOTOS, isCalendarDay, keywordLevels, normalizeKeyword } from "../library/index.js";
import type { ToolDef } from "./defs-shared.js";

const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;
const normalized = (list: readonly string[] | undefined): string[] => (list ?? []).map(normalizeKeyword);

const limit = z.number().int().min(1).max(MAX_PAGE).optional().describe(`how many to return, 1-${MAX_PAGE} (default ${DEFAULT_PAGE})`);
const offset = z.number().int().min(0).optional().describe("how many to skip, for the next page (default 0)");
const day = z.string().refine(isCalendarDay, "must be a calendar day, YYYY-MM-DD");
const uuids = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_PHOTOS)
  .refine(distinct, "uuids must differ")
  .describe(`the photos' uuids, 1-${MAX_PHOTOS} (from lr_search_photos, lr_get_selected_photos or lr_get_active_photo_context)`);
const keyword = z
  .string()
  .trim()
  .min(1)
  .max(MAX_KEYWORD_LENGTH)
  .refine((k) => keywordLevels(k) !== null, 'a keyword path cannot have an empty level ("A||B", "|A", "A|")');
const keywords = z
  .array(keyword)
  .max(MAX_KEYWORDS)
  .refine((list) => distinct(normalized(list)), "keywords must differ")
  .optional();

/** A photo listing, as every read tool describes its photos. */
const LISTED = "Each photo: uuid (what lr_set_rating, lr_set_keywords, lr_set_gps and lr_sync_series take), filename, rating (0 = none), capture_time, virtual_copy and copy_name.";
/** How lr_set_keywords and lr_list_keywords write a keyword. */
const PATHS = 'A keyword is a plain name or a hierarchy path, parent first with | between the levels ("Places|Europe|Paris"); levels match case aside.';

const searchArgs = z
  .object({
    filename: z.string().min(1).optional().describe("part of the file name"),
    keywords: z.array(z.string().min(1)).min(1).max(MAX_KEYWORDS).optional().describe("keywords the photo has, all of them"),
    rating: z.number().int().min(0).max(5).optional().describe("exactly this many stars, 0-5"),
    start_date: day.optional().describe("captured on or after this day, YYYY-MM-DD"),
    end_date: day.optional().describe("captured on or before this day, YYYY-MM-DD"),
    collection_id: z.number().int().min(0).optional().describe("only photos in this collection (its id from lr_list_collections)"),
    limit,
    offset,
  })
  .refine((a) => !(a.start_date && a.end_date && a.start_date > a.end_date), "start_date must be on or before end_date");

const selectedArgs = z.object({ limit });
const collectionArgs = z.object({ limit, offset });
const keywordListArgs = z.object({
  query: z.string().trim().min(1).max(MAX_KEYWORD_LENGTH).optional().describe("only the paths that contain this text, case aside"),
  limit,
  offset,
});
const ratingArgs = z.object({ uuids, rating: z.number().int().min(0).max(5).describe("stars, 0-5; 0 removes the rating") });
const keywordArgs = z
  .object({
    uuids,
    add: keywords.describe(
      `keywords to add, at most ${MAX_KEYWORDS}, ${MAX_KEYWORD_LENGTH} characters each: a plain name is the top-level keyword of that name, ` +
        "created there if missing; a path is the keyword at that place, its missing levels created",
    ),
    remove: keywords.describe(
      `keywords to take off the photos, at most ${MAX_KEYWORDS}: a plain name takes off every keyword of exactly that name, at any level; ` +
        "a path only the keyword at that place. The keywords stay in the catalog",
    ),
  })
  .refine((a) => (a.add?.length ?? 0) + (a.remove?.length ?? 0) > 0, "name at least one keyword to add or remove")
  .refine((a) => !normalized(a.add).some((k) => normalized(a.remove).includes(k)), "a keyword cannot be both added and removed");
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

const WRITE_RULES =
  "Tell the user which photos will change before calling. Ratings, keywords and GPS positions are catalog metadata, not Develop settings: " +
  "no History step or snapshot covers them, so the result gives each photo's value before and after, and another call puts it back. A photo " +
  "that fails is listed in `failed` with the reason, and the others are still written; if Lightroom stops answering, the call stops and the " +
  "error names the photo that may still have been written (`maybe_written`). Not while a session is open.";

export const CATALOG_DEFS: ToolDef[] = [
  {
    name: "lr_search_photos",
    title: "Search the catalog",
    description:
      "Search the Lightroom catalog for photos: by part of the file name, keywords (all of them), an exact star rating, capture dates " +
      "(YYYY-MM-DD, inclusive) and a collection; the filters combine (all must match). With no filter it searches every photo and says so. " +
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
      "true and `truncated` says how to get the rest. Changes nothing.",
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
      `Add keywords to and/or remove keywords from photos named by uuid. ${PATHS} A name that fits several keywords is settled so: an ` +
      "added plain name is always the top-level keyword of that name (created there if missing), never a deeper keyword of the same " +
      "name; a removed plain name takes off every keyword of exactly that name, at any level. To reach one particular keyword, give its " +
      "path (lr_list_keywords lists them). `before` and `after` give each photo's keywords as paths. A removed keyword, and every level " +
      `created, stays in the catalog's Keyword List: this tool deletes no keyword. ${WRITE_RULES}`,
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
