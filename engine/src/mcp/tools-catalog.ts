// The catalog tools kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2; library\ has the descriptor and
// the write loop): lr_search_photos, lr_get_selected_photos and lr_list_collections read, and run at
// any time, a session open or not: they write nothing and leave the selection alone.
// lr_set_rating and lr_set_keywords write, and run only between sessions, in the session queue
// (SessionManager.whenIdle, as lr_sync_series): no session can begin while they write, and they
// never write while a session does [stated: Jim, 2026-10-02, "Go", decision D3-A of the row's plan].

import { CATALOG_READ_TIMEOUT_MS, DEFAULT_PAGE, listing, searchCriteria, writeEach, type SearchFilters, type WriteResult } from "../library/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

type Page = { limit?: number | undefined; offset?: number | undefined };
export type SearchPhotosArgs = SearchFilters & Page & { collection_id?: number | undefined };
export type SetRatingArgs = { uuids: string[]; rating: number };
export type SetKeywordsArgs = { uuids: string[]; add?: string[] | undefined; remove?: string[] | undefined };

const UNFILTERED =
  "No filter was given, so every photo in the catalog was searched. Give a filename, keywords, rating, dates or a collection_id to narrow it.";

export async function searchPhotos(ctx: ToolContext, args: SearchPhotosArgs): Promise<ToolOutput> {
  return run(ctx, "lr_search_photos", args, async () => {
    await ctx.deps.ensureBridge();
    const criteria = searchCriteria(args);
    const offset = args.offset ?? 0;
    const limit = args.limit ?? DEFAULT_PAGE;
    const inCollection = args.collection_id !== undefined ? { collection_id: args.collection_id } : {};
    const res = await ctx.deps.client.request("search_photos", { criteria, ...inCollection, offset, limit }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    const photos = res.photos.map(listing);
    const json = {
      count: res.count,
      offset,
      returned: photos.length,
      has_more: offset + photos.length < res.count,
      photos,
      ...(criteria.length === 0 && args.collection_id === undefined ? { warning: UNFILTERED } : {}),
    };
    return { json, log: { count: res.count, returned: photos.length } };
  });
}

export async function getSelectedPhotos(ctx: ToolContext, args: { limit?: number | undefined }): Promise<ToolOutput> {
  return run(ctx, "lr_get_selected_photos", args, async () => {
    await ctx.deps.ensureBridge();
    const res = await ctx.deps.client.request("get_selection", { max: args.limit ?? DEFAULT_PAGE });
    const photos = res.photos.map(listing);
    return { json: { count: res.count, returned: photos.length, has_more: photos.length < res.count, photos }, log: { count: res.count } };
  });
}

export async function listCollections(ctx: ToolContext, args: Page): Promise<ToolOutput> {
  return run(ctx, "lr_list_collections", args, async () => {
    await ctx.deps.ensureBridge();
    const res = await ctx.deps.client.request("list_collections", {}, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    const offset = args.offset ?? 0;
    const page = res.collections.slice(offset, offset + (args.limit ?? DEFAULT_PAGE));
    const collections = page.map((c) => ({ id: c.local_id, name: c.name, set: c.set_path ?? null, smart: c.smart, photo_count: c.photo_count }));
    return { json: { count: res.collections.length, offset, returned: collections.length, has_more: offset + collections.length < res.collections.length, collections }, log: { count: res.collections.length } };
  });
}

/** A write tool's answer: how many photos changed, each photo's before and after, and the failures. */
function written<T>(out: WriteResult<T>, extra: Record<string, unknown>): ToolOutput {
  const changed = out.photos.filter((p) => p.changed).length;
  return { json: { ...extra, changed, photos: out.photos, failed: out.failed }, log: { changed, failed: out.failed.length } };
}

export async function setRating(ctx: ToolContext, args: SetRatingArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_rating", args, async () => {
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_set_rating", async () => {
      const out = await writeEach(
        args.uuids,
        (uuid) => ctx.deps.client.request("set_rating", { photo_uuid: uuid, rating: args.rating }, { timeoutMs: WRITE_TIMEOUT_MS }),
        (r) => (r.after === args.rating ? null : `Lightroom read back rating ${r.after}, not ${args.rating}.`),
        "rating",
        "RATING_NOT_TAKEN",
      );
      return written(out, { rating: args.rating });
    });
  });
}

export async function setKeywords(ctx: ToolContext, args: SetKeywordsArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_keywords", args, async () => {
    const add = args.add ?? [];
    const remove = args.remove ?? [];
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    return sessions.whenIdle("lr_set_keywords", async () => {
      const out = await writeEach(
        args.uuids,
        (uuid) => ctx.deps.client.request("set_keywords", { photo_uuid: uuid, add, remove }, { timeoutMs: WRITE_TIMEOUT_MS }),
        (r) => {
          const missing = add.filter((k) => !r.after.includes(k));
          const left = remove.filter((k) => r.after.includes(k));
          if (missing.length === 0 && left.length === 0) return null;
          return `Lightroom read back keywords without ${JSON.stringify(missing)} and still with ${JSON.stringify(left)}.`;
        },
        "keywords",
        "KEYWORDS_NOT_TAKEN",
      );
      return written(out, { add, remove });
    });
  });
}
