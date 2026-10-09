// Spike S10, step 0: `npm run s10:check -- --fixtures` puts the fixture photos into the "fixtures"
// collection by file name (the collection is made if missing), so Jim adds nothing by hand (rule 04
// "Automate first"). The names are photos the 2026-10-08 read-only probes found in Jim's catalog, one
// per format [handle: logs\nonraw-2026-10-08\formats.json, probe-pv.mts output; committed redacted in
// row 2], plus every file named "S10-…": the formats Jim makes in Photoshop (spikes\S10\README.md
// part A). An exact name takes the original only, never a virtual copy; the JPEG's "Copy 1" is in the
// collection already [stated: Jim, 2026-10-08]. Adding is idempotent (Transfer.lua reads the old
// membership back), so the command can run again after Jim imports more files.

import { CATALOG_READ_TIMEOUT_MS } from "../library/index.js";
import type { Json } from "./phase3-config.js";
import { COLLECTION, type Ctx } from "./s10-config.js";

export const FIXTURE_FILES = [
  "DSC_0031.JPG", // the JPEG original (2004 Nikon D70), process version 15.4
  "IMG_1595.JPG", // a 2004 JPEG on process version 11.0 ("Version 5")
  "20251219-ThreeBeebeBrothers 1994 - Restored.png",
  "20260906-_OZ80013-Edit.tif",
  "20260906-_OZ80005-Edit-Edit.psd",
  "IMG_0027.HEIC",
  "20250414-20250413-_OZ81315-HDR-2.avif", // an HDR AVIF (ExtendedToneCurvePV2012 keys)
  "20260906-_OZ80005-Rendered.dng", // a DNG on the rendered pipeline
  "20260110-_Z8A0138-DxO_DeepPRIME XD3.dng", // a DNG on the raw pipeline (the Phase 0 fixture)
  "20260907-_OZ80093.NEF", // the raw fixture, the control
] as const;
/** Every file Jim makes for the formats his catalog lacks is named S10-<format>.<ext> (README part A). */
export const MADE_PREFIX = "S10-";

type Listed = { uuid?: string | undefined; filename?: string | undefined; is_virtual_copy?: boolean | undefined };

/** The catalog photos a fixture name means: the original of that exact name, or every "S10-…" file. */
export function wanted(name: string, photos: Listed[]): Listed[] {
  return photos.filter((p) => p.uuid !== undefined && (name === MADE_PREFIX ? (p.filename ?? "").startsWith(MADE_PREFIX) : p.filename === name && p.is_virtual_copy !== true));
}

export async function addFixtures(ctx: Ctx): Promise<Json> {
  const { client, say } = ctx.deps;
  const out: Json = { names: [...FIXTURE_FILES, MADE_PREFIX] };
  say(`Fixtures: the photos of the collection "${COLLECTION}", by file name:`);
  const listed = await client.request("list_collections", {}, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
  let collection = listed.collections.find((c) => c.name === COLLECTION);
  if (!collection) {
    const made = await client.request("create_collection", { name: COLLECTION, set_path: [] }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    collection = { local_id: made.local_id, name: made.name, smart: made.smart, photo_count: made.photo_count };
    out["created"] = made.created;
    say(`  made the collection "${COLLECTION}"`);
  }
  out["collection"] = { ...collection };
  if (collection.smart) {
    ctx.fail(`the collection "${COLLECTION}" is a smart collection, so photos cannot be added to it. In Library, rename it, then run the command again.`);
    return out;
  }
  const found: Json[] = [];
  const missing: string[] = [];
  for (const name of out["names"] as string[]) {
    const page = await client.request("search_photos", { criteria: [{ criteria: "filename", operation: "any", value: name }], offset: 0, limit: 50 }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    const matches = wanted(name, page.photos);
    if (matches.length === 0) {
      missing.push(name);
      say(`  ${name}: not in the catalog`);
    }
    for (const p of matches) {
      found.push({ name, filename: p.filename ?? null, uuid: p.uuid });
      say(`  ${p.filename ?? p.uuid}: found`);
    }
  }
  Object.assign(out, { found, missing });
  const uuids = found.map((f) => f["uuid"] as string);
  if (uuids.length > 0) {
    const res = await client.request("collection_photos", { collection_id: collection.local_id, uuids, remove: false }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    const after = res.after_in ?? res.before_in;
    Object.assign(out, { added: after.filter((u) => !res.before_in.includes(u)), already_in: res.before_in.filter((u) => uuids.includes(u)), not_found: res.not_found, in_collection: after.length });
    if (res.write_error !== undefined) ctx.fail(`adding to the collection: ${res.write_error}`);
  }
  say(`Fixtures: ${found.length} photos found, ${missing.length} names not in the catalog${missing.length ? ` (${missing.join("; ")})` : ""}; ${String(out["added"] ?? [])} added, ${String(out["in_collection"] ?? "?")} in the collection now.`);
  return out;
}
