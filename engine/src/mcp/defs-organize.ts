// The MCP definitions of issue #218's catalog organisation tools (plugin 1.5.0): lr_create_smart_collection and
// lr_delete_collection (tools-collections.ts), lr_list_folders (tools-catalog.ts), lr_rename_keyword and
// lr_remove_keyword_subtree (tools-keywords.ts), lr_export_metadata (tools-export-metadata.ts).

import { z } from "zod";
import { MAX_KEYWORD_LENGTH, MAX_PAGE, MAX_PHOTOS } from "../library/index.js";
import { COLLECTION_NAMES, FILTERS, WRITE_RULES, collectionName, datesInOrder, keyword, limit, offset, uuids } from "./defs-catalog.js";
import { META_WRITE, createArgs } from "./defs-files.js";
import type { ToolDef } from "./defs-shared.js";
import { createSmartCollection, deleteCollection } from "./tools-collections.js";
import { listFolders } from "./tools-catalog.js";
import { exportMetadata } from "./tools-export-metadata.js";
import { removeKeywordSubtree, renameKeyword } from "./tools-keywords.js";

const smartArgs = createArgs.extend(FILTERS).refine(datesInOrder, "start_date must be on or before end_date");
const deleteArgs = z
  .object({
    collection_id: z.number().int().min(0).optional().describe("the collection's id from lr_list_collections"),
    collection: collectionName.optional().describe(`or the collection by ${COLLECTION_NAMES}`),
    confirm: z.boolean().describe("must be true: the user agreed to delete this collection"),
  })
  .refine((a) => (a.collection_id === undefined) !== (a.collection === undefined), "give collection_id or collection, one of them");
const pageArgs = z.object({ limit, offset });
const renameArgs = z.object({
  path: keyword.describe('the keyword: a plain name is the top-level keyword, a path ("Places|Europe|Paris") the keyword at that place'),
  new_name: z.string().trim().min(1).max(MAX_KEYWORD_LENGTH).refine((s) => !s.includes("|"), "new_name is one keyword name, not a path").describe("its new name (one level)"),
});
const subtreeArgs = z
  .object({
    path: keyword.describe("the keyword whose subtree comes off: it and every keyword under it (a plain name is the top-level keyword)"),
    uuids: uuids.optional().describe(`the photos to take them off, 1-${MAX_PHOTOS}; left out (and no catalog_wide), the photos selected in Lightroom`),
    catalog_wide: z.boolean().optional().describe("true: every photo in the catalog that holds one of them; needs confirm: true"),
    confirm: z.boolean().optional().describe("true when the user agreed to a catalog_wide removal"),
  })
  .refine((a) => !(a.catalog_wide === true && a.uuids !== undefined), "give uuids or catalog_wide, not both");
const exportArgs = z.object({
  uuids: z.array(z.string().min(1)).min(1).max(MAX_PAGE).optional().describe(`the photos, 1-${MAX_PAGE}; left out, the photos selected in Lightroom`),
  folder: z.string().trim().min(1).optional().describe("an absolute folder for the file; left out, %TEMP%\\LrC-AVG\\metadata"),
});

export const ORGANIZE_DEFS: ToolDef[] = [
  {
    name: "lr_create_smart_collection",
    title: "Create a smart collection",
    description:
      "Create a smart collection whose rules are lr_search_photos' filters (all must match; at least one; no folder or collection rule), at " +
      "the top level or inside collection sets, which are created when missing. A collection of that name already there is refused " +
      `(ALREADY_EXISTS): nothing is replaced. Returns its id, photo_count and the rules; Lightroom keeps it filled. ${META_WRITE}`,
    schema: smartArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.call(createSmartCollection, args as z.infer<typeof smartArgs>),
  },
  {
    name: "lr_delete_collection",
    title: "Delete a collection",
    description:
      "Delete a collection or smart collection, named by id or by name; its photos stay in the catalog. Needs confirm: true: ask the user " +
      "first. `before` gives what makes it again (member_uuids of a collection, search_description of a smart one) and `undo` how. " +
      META_WRITE,
    schema: deleteArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.call(deleteCollection, args as z.infer<typeof deleteArgs>),
  },
  {
    name: "lr_list_folders",
    title: "The catalog's folders",
    description:
      "List the catalog's folders as a tree in order, a parent before its children: path (the full path lr_search_photos' folder takes), name, " +
      "depth (0 for a root) and photo_count (the folder's own photos, not its subfolders'). Paged like lr_search_photos. For a folder's photos " +
      "call lr_search_photos with folder (and include_subfolders). Changes nothing.",
    schema: pageArgs,
    annotations: { readOnlyHint: true, openWorldHint: false },
    run: (tools, args) => tools.call(listFolders, args as z.infer<typeof pageArgs>),
  },
  {
    name: "lr_rename_keyword",
    title: "Rename a keyword",
    description:
      "Rename one keyword in place: every photo that holds it shows the new name; its parent, children and synonyms stay. A sibling of the new " +
      "name (case aside) is refused: a rename never merges keywords. A change of case only works too. `before` and `after` are its paths; " +
      `\`undo\` says how to put it back. ${META_WRITE}`,
    schema: renameArgs,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.call(renameKeyword, args as z.infer<typeof renameArgs>),
  },
  {
    name: "lr_remove_keyword_subtree",
    title: "Take a keyword and its children off photos",
    description:
      "Take a keyword and every keyword under it off photos: those named by uuid, else those selected in Lightroom, or with catalog_wide and " +
      `confirm: true every photo that holds one. The keywords stay in the Keyword List. At most ${MAX_PHOTOS} photos a call; \`not_yet\` or ` +
      `\`remaining\` with \`next\` say how to go on. \`before\` and \`after\` give each photo's keywords. ${WRITE_RULES}`,
    schema: subtreeArgs,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    run: (tools, args) => tools.call(removeKeywordSubtree, args as z.infer<typeof subtreeArgs>),
  },
  {
    name: "lr_export_metadata",
    title: "Export photos' metadata to a JSON file",
    description:
      `Write the catalog metadata of photos (named by uuid, else the selection; at most ${MAX_PAGE}) to a new JSON file: per photo what ` +
      "lr_get_metadata reads, keyword paths included. The file is new each time (lrc-avg-metadata-<time>.json); no file is ever overwritten. " +
      "Returns its path. Photos not reached in about 30 seconds are in `not_yet`. Changes nothing in the catalog.",
    schema: exportArgs,
    // Not read-only: each call writes a new file (a retry after `pending` must not be treated as disposable).
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    run: (tools, args) => tools.call(exportMetadata, args as z.infer<typeof exportArgs>),
  },
];
