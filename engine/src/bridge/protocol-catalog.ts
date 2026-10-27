// Payloads and result schemas of plugin 1.5.0's catalog commands (GitHub issue #218; plugin\LrC-AVG.lrplugin\
// CollectionEdit.lua, Folders.lua, KeywordEdit.lua and Metadata.lua set_color_label), kept apart from
// protocol-results.ts by size; protocol.ts merges both into COMMANDS. Lua writes an empty table as [], so no
// schema below requires a non-empty table to be an object.

import { z } from "zod";

/** One entry of a findPhotos search descriptor (engine\src\library\search.ts builds them); protocol.ts re-exports it. */
export type SearchCriterion = { criteria: string; operation: string; value: string | number | boolean; value2?: string };

/** A collection as create_collection describes it (Transfer.describeCollection). */
const collection = { local_id: z.number(), name: z.string(), set_path: z.string().optional(), smart: z.boolean(), photo_count: z.number() };

export type CatalogPayloads = {
  /** "red" ... "purple" or "none" (Metadata.lua setColorLabel). */
  set_color_label: { photo_uuid: string; label: string };
  /** The search descriptor's entries, intersected; set_path as create_collection's. */
  create_smart_collection: { name: string; set_path: string[]; criteria: SearchCriterion[] };
  delete_collection: { collection_id: number };
  /** limit 1-500. */
  list_folders: { offset: number; limit: number };
  /** A keyword path; new_name one level. */
  rename_keyword: { path: string; new_name: string };
  /** With photos: the uuids of the photos holding a keyword of the subtree too. */
  keyword_subtree: { path: string; photos: boolean };
};

export const CATALOG_RESULTS = {
  // The label's name before and after; not written when the photo already held it.
  set_color_label: z.object({
    uuid: z.string().min(1),
    filename: z.string().optional(),
    before: z.string(),
    after: z.string().optional(),
    write_error: z.string().optional(),
    after_error: z.string().optional(),
  }),
  create_smart_collection: z.object({ ...collection, created: z.boolean() }),
  // `before`: member_uuids for a regular collection, search_description for a smart one.
  delete_collection: z.object({
    before: z.object({
      ...collection,
      member_uuids: z.array(z.string()).optional(),
      members_truncated: z.boolean().optional(),
      search_description: z.unknown().optional(),
      search_error: z.string().optional(),
    }),
    deleted: z.boolean(),
  }),
  list_folders: z.object({
    count: z.number(),
    folders: z.array(z.object({ path: z.string(), name: z.string(), depth: z.number(), photo_count: z.number() })),
  }),
  rename_keyword: z.object({
    before: z.string(),
    after: z.string().optional(),
    after_error: z.string().optional(),
    photo_count: z.number(),
    write_error: z.string().optional(),
  }),
  keyword_subtree: z.object({ paths: z.array(z.string()), uuids: z.array(z.string()).optional(), photo_count: z.number().optional() }),
} as const;
