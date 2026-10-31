// A collection by name (issue #218 row 7, moved out of tools-collections.ts so that tools-shared.ts can hand
// it to the session as SessionDeps.collectionPhotos, Phase 10 row 8, without an import cycle).

import type { BridgeClient } from "../bridge/index.js";
import { CATALOG_READ_TIMEOUT_MS } from "../library/index.js";
import { ToolError } from "./errors.js";

/** How lr_list_collections writes a set path, and lr_create_collection reads it. */
export const SET_SEPARATOR = " / ";

type Listed = { local_id: number; name: string; set_path?: string | undefined; smart: boolean; photo_count: number };
const fold = (s: string): string => s.split("/").map((t) => t.trim().toLowerCase()).join("/");
const pathOf = (c: Listed): string => (c.set_path ? `${c.set_path}${SET_SEPARATOR}${c.name}` : c.name);

/**
 * The collection a name or "Set / Name" path means, case aside: a listed path first, then a bare name, as
 * upstream resolves them [upstream claim: Automaat/lightroom-mcp@1040453 plugin/LightroomMCP.lrplugin/
 * HandlerCollections.lua:212-259]. A name several collections share is refused with the candidates (upstream fix #272).
 */
export async function findCollection(client: BridgeClient, name: string): Promise<Listed> {
  const res = await client.request("list_collections", {}, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
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

/** The uuids of the first `limit` photos of the collection `name` means, and how many photos it holds. */
export async function collectionPhotos(client: BridgeClient, name: string, limit: number): Promise<{ uuids: string[]; count: number }> {
  const { local_id } = await findCollection(client, name);
  const res = await client.request("search_photos", { criteria: [], collection_id: local_id, offset: 0, limit }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
  return { uuids: res.photos.flatMap((p) => (p.uuid ? [p.uuid] : [])), count: res.count };
}
