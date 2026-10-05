// lr_create_collection and lr_add_to_collection (GitHub issue #55, engine 0.17.0, plugin 0.17.0
// Transfer.lua): Automaat's create_collection and add_to_collection, added back. Collections are named
// by id (lr_list_collections), not by name as Automaat did, since two collections in different sets
// may share a name [upstream claim: vendor\automaat\plugin\LightroomMCP.lrplugin\HandlerCollections.lua:
// 70-72 refuses a second one for that reason]. Both write the catalog, so they run between sessions, in
// the session queue, as lr_set_rating does (tools-catalog.ts).

import { MAX_COLLECTION_PHOTOS } from "../library/index.js";
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

/** What the read-back shows: the photos changed, those already as asked, and those Lightroom did not take. */
function outcome(asked: readonly string[], r: { before_in: string[]; after_in?: string[] | undefined; not_found: string[] }, remove: boolean) {
  const before = new Set(r.before_in);
  const after = new Set(r.after_in ?? []);
  const found = asked.filter((u) => !r.not_found.includes(u));
  const wanted = (u: string): boolean => after.has(u) !== remove;
  return {
    changed: found.filter((u) => before.has(u) === remove && wanted(u)),
    unchanged: found.filter((u) => before.has(u) !== remove),
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
