// The MCP definitions of the catalog tools (tools-catalog.ts): lr_search_photos,
// lr_get_selected_photos, lr_list_collections, lr_set_rating and lr_set_keywords.

import { z } from "zod";
import { DEFAULT_PAGE, MAX_KEYWORDS, MAX_KEYWORD_LENGTH, MAX_PAGE, MAX_PHOTOS, isCalendarDay } from "../library/index.js";
import type { ToolDef } from "./defs-shared.js";

const distinct = (list: readonly unknown[]): boolean => new Set(list).size === list.length;

const limit = z.number().int().min(1).max(MAX_PAGE).optional().describe(`how many to return, 1-${MAX_PAGE} (default ${DEFAULT_PAGE})`);
const offset = z.number().int().min(0).optional().describe("how many to skip, for the next page (default 0)");
const day = z.string().refine(isCalendarDay, "must be a calendar day, YYYY-MM-DD");
const uuids = z
  .array(z.string().min(1))
  .min(1)
  .max(MAX_PHOTOS)
  .refine(distinct, "uuids must differ")
  .describe(`the photos' uuids, 1-${MAX_PHOTOS} (from lr_search_photos, lr_get_selected_photos or lr_get_active_photo_context)`);
const keywords = z
  .array(z.string().trim().min(1).max(MAX_KEYWORD_LENGTH))
  .max(MAX_KEYWORDS)
  .refine(distinct, "keywords must differ")
  .optional();

/** A photo listing, as every read tool describes its photos. */
const LISTED = "Each photo: uuid (what lr_set_rating, lr_set_keywords and lr_sync_series take), filename, rating (0 = none), capture_time, virtual_copy and copy_name.";

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
const ratingArgs = z.object({ uuids, rating: z.number().int().min(0).max(5).describe("stars, 0-5; 0 removes the rating") });
const keywordArgs = z
  .object({
    uuids,
    add: keywords.describe(`keyword names to add, at most ${MAX_KEYWORDS}; a name the catalog lacks is created as a top-level keyword`),
    remove: keywords.describe(`keyword names to take off the photos, at most ${MAX_KEYWORDS}; the keywords stay in the catalog`),
  })
  .refine((a) => (a.add?.length ?? 0) + (a.remove?.length ?? 0) > 0, "name at least one keyword to add or remove")
  .refine((a) => !(a.add ?? []).some((k) => (a.remove ?? []).includes(k)), "a keyword cannot be both added and removed");

const WRITE_RULES =
  "Tell the user which photos will change before calling. Ratings and keywords are catalog metadata, not Develop settings: no History " +
  "step or snapshot covers them, so the result gives each photo's value before and after, and another call puts it back. A photo that " +
  "fails is listed in `failed` with the reason, and the others are still written; if Lightroom stops answering, the call stops and the " +
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
      "Add keywords to and/or remove keywords from photos named by uuid, matched by exact name. An added name the catalog lacks is created as a " +
      `top-level keyword; a removed one stays in the catalog's Keyword List. ${WRITE_RULES}`,
    schema: keywordArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.setKeywords(args as z.infer<typeof keywordArgs>),
  },
];
