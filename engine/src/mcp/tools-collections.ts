// lr_create_collection and lr_add_to_collection (GitHub issue #55, engine 0.17.0, plugin 0.17.0
// Transfer.lua): Automaat's create_collection and add_to_collection, added back. Collections are named
// by id (lr_list_collections), not by name as Automaat did, since two collections in different sets
// may share a name [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerCollections.lua:
// 70-72 refuses a second one for that reason]. Both write the catalog, so they run between sessions, in
// the session queue, as lr_set_rating does (tools-catalog.ts).

import { CATALOG_READ_TIMEOUT_MS, MAX_COLLECTION_PHOTOS, searchCriteria, type SearchFilters } from "../library/index.js";
import { UNANSWERED, WRITE_TIMEOUT_MS, mayHaveLanded } from "../sync/target.js";
import { ToolError, toToolError } from "./errors.js";
import { needPlugin, run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

/** Transfer.lua came with this plugin. */
export const TRANSFER_PLUGIN = "0.17.0";
/** How lr_list_collections writes a set path, and lr_create_collection reads it. */
export const SET_SEPARATOR = " / ";

export type CreateCollectionArgs = { name: string; set?: string | undefined };
export type AddToCollectionArgs = { collection_id: number; uuids: string[]; remove?: boolean | undefined };

/** "Set / Subset" as levels, each trimmed; [] for none. */
export const setLevels = (set: string | undefined): string[] => (set === undefined ? [] : set.split(SET_SEPARATOR.trim()).map((s) => s.trim()));

export async function createCollection(ctx: ToolContext, args: CreateCollectionArgs): Promise<ToolOutput> {
  return run(ctx, "lr_create_collection", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_create_collection", TRANSFER_PLUGIN, "it creates collections");
    return sessions.whenIdle("lr_create_collection", async () => {
      const name = args.name.trim();
      const r = await ctx.deps.client.request("create_collection", { name, set_path: setLevels(args.set) }, { timeoutMs: WRITE_TIMEOUT_MS });
      const json = { id: r.local_id, name: r.name, set: r.set_path ?? null, created: r.created, photo_count: r.photo_count };
      return { json, log: { id: r.local_id, created: r.created } };
    });
  });
}

/**
 * What the read-back shows: the photos changed, those already as asked, and those Lightroom did not
 * take. With no read-back (`after_in` absent) nothing is known to have changed, so none are listed as
 * changed or not taken (issue #77: an absent read-back read as empty listed every photo as removed).
 */
function outcome(asked: readonly string[], r: { before_in: string[]; after_in?: string[] | undefined; not_found: string[] }, remove: boolean) {
  const before = new Set(r.before_in);
  const found = asked.filter((u) => !r.not_found.includes(u));
  const unchanged = found.filter((u) => before.has(u) !== remove);
  if (r.after_in === undefined) return { changed: [], unchanged, not_taken: [] };
  const after = new Set(r.after_in);
  const wanted = (u: string): boolean => after.has(u) !== remove;
  return {
    changed: found.filter((u) => before.has(u) === remove && wanted(u)),
    unchanged,
    not_taken: found.filter((u) => before.has(u) === remove && !wanted(u)),
  };
}

export async function addToCollection(ctx: ToolContext, args: AddToCollectionArgs): Promise<ToolOutput> {
  return run(ctx, "lr_add_to_collection", args, async () => {
    const remove = args.remove === true;
    if (args.uuids.length > MAX_COLLECTION_PHOTOS) throw new ToolError("BAD_ARGUMENTS", `At most ${MAX_COLLECTION_PHOTOS} photos per call.`, false);
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_add_to_collection", TRANSFER_PLUGIN, "it changes collections");
    return sessions.whenIdle("lr_add_to_collection", async () => {
      let r;
      try {
        r = await ctx.deps.client.request("collection_photos", { collection_id: args.collection_id, uuids: args.uuids, remove }, { timeoutMs: WRITE_TIMEOUT_MS });
      } catch (err) {
        const e = toToolError(err);
        if (!UNANSWERED.has(e.code) || !mayHaveLanded(err)) throw err;
        throw new ToolError(e.code, `${e.message} Lightroom may still change the collection: list it again (lr_search_photos with collection_id) to see.`, e.recoverable, { maybe_written: true });
      }
      const o = outcome(args.uuids, r, remove);
      const doubt = [
        ...(r.write_error !== undefined ? [`Lightroom raised an error while writing: ${r.write_error}.`] : []),
        ...(r.after_in === undefined ? [`Lightroom could not read the collection back${r.after_error !== undefined ? `: ${r.after_error}` : ""}.`] : []),
      ];
      const json = {
        collection: { id: r.collection_id, name: r.name },
        [remove ? "removed" : "added"]: o.changed,
        unchanged: o.unchanged,
        not_found: r.not_found,
        ...(o.not_taken.length > 0 && doubt.length === 0 ? { not_taken: o.not_taken } : {}),
        ...(doubt.length > 0 ? { warning: `${doubt.join(" ")} \`unchanged\` lists the photos already as asked before the call; the others may or may not have changed.` } : {}),
      };
      return { json, log: { changed: o.changed.length, not_found: r.not_found.length, not_taken: o.not_taken.length } };
    });
  });
}

// --- Issue #218 row 7 (plugin 1.5.0, CollectionEdit.lua): collections by name, smart collections, delete.

type Listed = { local_id: number; name: string; set_path?: string | undefined; smart: boolean; photo_count: number };
const fold = (s: string): string => s.split("/").map((t) => t.trim().toLowerCase()).join("/");
const pathOf = (c: Listed): string => (c.set_path ? `${c.set_path}${SET_SEPARATOR}${c.name}` : c.name);

/**
 * The collection a name or "Set / Name" path means, case aside: a listed path first, then a bare name, as
 * upstream resolves them [upstream claim: Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/
 * HandlerCollections.lua:212-259]. A name several collections share is refused with the candidates (upstream fix #272).
 */
export async function findCollection(ctx: ToolContext, name: string): Promise<Listed> {
  const res = await ctx.deps.client.request("list_collections", {}, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
  const want = fold(name);
  const byPath = res.collections.filter((c) => fold(pathOf(c)) === want);
  const found = byPath.length > 0 ? byPath : res.collections.filter((c) => fold(c.name) === want);
  if (found.length === 0) throw new ToolError("UNKNOWN_COLLECTION", `No collection is named "${name}". lr_list_collections lists them.`, false);
  if (found.length > 1) {
    const candidates = found.map((c) => ({ id: c.local_id, name: c.name, set: c.set_path ?? null, smart: c.smart }));
    throw new ToolError("AMBIGUOUS_COLLECTION", `${found.length} collections are named "${name}": give its set path ("Set / Name") or its id.`, false, { candidates });
  }
  return found[0] as Listed;
}

export type CreateSmartArgs = SearchFilters & { name: string; set?: string | undefined };
export type DeleteCollectionArgs = { collection_id?: number | undefined; collection?: string | undefined; confirm: boolean };

export async function createSmartCollection(ctx: ToolContext, args: CreateSmartArgs): Promise<ToolOutput> {
  return run(ctx, "lr_create_smart_collection", args, async () => {
    const criteria = searchCriteria(args);
    if (criteria.length === 0) throw new ToolError("BAD_ARGUMENTS", "Give at least one filter: a smart collection holds the photos that match its rules.", false);
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_create_smart_collection", async () => {
      const r = await ctx.deps.client.request("create_smart_collection", { name: args.name.trim(), set_path: setLevels(args.set), criteria }, { timeoutMs: WRITE_TIMEOUT_MS });
      const undo = `To remove it, call lr_delete_collection with collection_id ${r.local_id} and confirm: true; no photo changes either way.`;
      const json = { id: r.local_id, name: r.name, set: r.set_path ?? null, smart: r.smart, photo_count: r.photo_count, rules: criteria, undo };
      return { json, log: { id: r.local_id, photo_count: r.photo_count } };
    });
  });
}

/** The deleted collection as lr_list_collections lists one, plus what makes it again. */
function deletedBefore(b: { local_id: number; name: string; set_path?: string | undefined; smart: boolean; photo_count: number; member_uuids?: string[] | undefined; members_truncated?: boolean | undefined; search_description?: unknown }) {
  return {
    id: b.local_id,
    name: b.name,
    set: b.set_path ?? null,
    smart: b.smart,
    photo_count: b.photo_count,
    ...(b.member_uuids !== undefined ? { member_uuids: b.member_uuids, members_truncated: b.members_truncated === true } : {}),
    ...(b.search_description !== undefined ? { search_description: b.search_description } : {}),
  };
}

export async function deleteCollection(ctx: ToolContext, args: DeleteCollectionArgs): Promise<ToolOutput> {
  return run(ctx, "lr_delete_collection", args, async () => {
    if (args.confirm !== true) throw new ToolError("CONFIRM_REQUIRED", "lr_delete_collection deletes a collection: ask the user, then call again with confirm: true.", false);
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_delete_collection", async () => {
      const id = args.collection_id ?? (await findCollection(ctx, args.collection ?? "")).local_id;
      const r = await ctx.deps.client.request("delete_collection", { collection_id: id }, { timeoutMs: WRITE_TIMEOUT_MS });
      const undo = r.before.smart
        ? "To make it again, call lr_create_smart_collection with the same name and the rules in `before.search_description`."
        : "To make it again, call lr_create_collection with the same name and set, then lr_add_to_collection with `before.member_uuids`.";
      return { json: { deleted: r.deleted, before: deletedBefore(r.before), photos_note: "The photos stay in the catalog.", undo }, log: { id, deleted: r.deleted } };
    });
  });
}
