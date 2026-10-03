// The catalog tools kept from Automaat (PHASE6_PROTOTYPE_PLAN row 2; library\ has the descriptor and
// the write loop): lr_search_photos, lr_get_selected_photos and lr_list_collections read, and run at
// any time, a session open or not: they write nothing and leave the selection alone.
// lr_set_rating and lr_set_keywords write, and run only between sessions, in the session queue
// (SessionManager.whenIdle, as lr_sync_series): no session can begin while they write, and they
// never write while a session does [stated: Jim, 2026-10-02, "Go", decision D3-A of the row's plan].
// Engine 0.15.0 (GitHub issue #60 [stated: Jim, 2026-10-03, "Keyword hierarchy, set_gps"]): keyword
// paths in lr_set_keywords (library\keywords.ts), lr_list_keywords (a read, as above) and lr_set_gps
// (a write, as above), all three needing plugin 0.10.0.

import { pluginVersionAtLeast } from "../bridge/index.js";
import {
  CATALOG_READ_TIMEOUT_MS,
  DEFAULT_PAGE,
  gpsNotTaken,
  isKeywordPath,
  keywordsNotTaken,
  listing,
  normalizeKeyword,
  searchCriteria,
  writeEach,
  type Gps,
  type SearchFilters,
  type WriteResult,
} from "../library/index.js";
import { WRITE_TIMEOUT_MS } from "../sync/target.js";
import { ToolError } from "./errors.js";
import { run, sessionTools, type ToolContext, type ToolOutput } from "./tools-shared.js";

type Page = { limit?: number | undefined; offset?: number | undefined };
export type SearchPhotosArgs = SearchFilters & Page & { collection_id?: number | undefined };
export type ListKeywordsArgs = Page & { query?: string | undefined };
export type SetRatingArgs = { uuids: string[]; rating: number };
export type SetKeywordsArgs = { uuids: string[]; add?: string[] | undefined; remove?: string[] | undefined };
export type SetGpsArgs = { uuids: string[]; position: Gps };

/** Keyword paths, list_keywords and set_gps came with this plugin (Library.lua, KeywordTree.lua). */
export const KEYWORD_GPS_PLUGIN = "0.10.0";

const UNFILTERED =
  "No filter was given, so every photo in the catalog was searched. Give a filename, keywords, rating, dates or a collection_id to narrow it.";

/**
 * Refuses before anything is sent when Lightroom runs an older plugin: it has neither new command, and
 * would pass a path "A|B" whole to createKeyword as one top-level name [inference: plugin 0.9.0's
 * Library.lua setKeywords]; what Lightroom then makes of the "|" is [unverified].
 */
function needPlugin(ctx: ToolContext, tool: string, why: string): void {
  const version = ctx.deps.client.hello()?.plugin_version;
  if (pluginVersionAtLeast(version, KEYWORD_GPS_PLUGIN)) return;
  throw new ToolError(
    "PLUGIN_TOO_OLD",
    `${tool} needs the LrC-AVG plugin ${KEYWORD_GPS_PLUGIN} or later (${why}); Lightroom runs ${String(version ?? "an unknown version")}. Restart Lightroom so it loads the current plugin.`,
    false,
  );
}

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

export async function listKeywords(ctx: ToolContext, args: ListKeywordsArgs): Promise<ToolOutput> {
  return run(ctx, "lr_list_keywords", args, async () => {
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_list_keywords", "it reads the keyword tree");
    const offset = args.offset ?? 0;
    const limit = args.limit ?? DEFAULT_PAGE;
    const query = args.query !== undefined ? { query: args.query } : {};
    const res = await ctx.deps.client.request("list_keywords", { ...query, offset, limit }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    const returned = res.keywords.length;
    const more = offset + returned < res.count;
    const truncated = `${returned} of ${res.count} keywords from offset ${offset}: call again with offset ${offset + returned}, or narrow with query.`;
    const json = { count: res.count, offset, returned, has_more: more, keywords: res.keywords, ...(more ? { truncated } : {}) };
    return { json, log: { count: res.count, returned } };
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
    const add = (args.add ?? []).map(normalizeKeyword);
    const remove = (args.remove ?? []).map(normalizeKeyword);
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    if ([...add, ...remove].some(isKeywordPath)) needPlugin(ctx, "lr_set_keywords", "for a keyword path");
    return sessions.whenIdle("lr_set_keywords", async () => {
      const out = await writeEach(
        args.uuids,
        (uuid) => ctx.deps.client.request("set_keywords", { photo_uuid: uuid, add, remove }, { timeoutMs: WRITE_TIMEOUT_MS }),
        (r) => keywordsNotTaken(r.after, add, remove),
        "keywords",
        "KEYWORDS_NOT_TAKEN",
      );
      return written(out, { add, remove });
    });
  });
}

/** The plugin's `false` (no position) as null. */
const gps = (wire: { latitude: number; longitude: number } | false): Gps => (wire === false ? null : wire);

export async function setGps(ctx: ToolContext, args: SetGpsArgs): Promise<ToolOutput> {
  return run(ctx, "lr_set_gps", args, async () => {
    const want = args.position;
    const sessions = sessionTools(ctx);
    await ctx.deps.ensureBridge();
    needPlugin(ctx, "lr_set_gps", "it writes GPS positions");
    const payload = want === null ? { clear: true as const } : { latitude: want.latitude, longitude: want.longitude };
    return sessions.whenIdle("lr_set_gps", async () => {
      const out = await writeEach(
        args.uuids,
        async (uuid) => {
          const r = await ctx.deps.client.request("set_gps", { photo_uuid: uuid, ...payload }, { timeoutMs: WRITE_TIMEOUT_MS });
          return { ...r, before: gps(r.before), after: r.after === undefined ? undefined : gps(r.after) };
        },
        (r) => gpsNotTaken(r.after, want),
        "GPS position",
        "GPS_NOT_TAKEN",
      );
      return written(out, { position: want });
    });
  });
}
