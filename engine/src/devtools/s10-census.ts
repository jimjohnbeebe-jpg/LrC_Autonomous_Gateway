// Spike S10, step 1: the census of the "fixtures" collection (s10-config.ts has the plan). Every
// photo is read by uuid, so nothing is selected and nothing is written. Each photo's settings go to
// a dump file in the S5 shape (params\sdk-keys.ts s5DumpSchema), so `spikes\S5\pin.ts --out …`
// pins the rendered pipeline's keys from them in row 2; the census entry names the photo's pipeline
// (s10-config.ts pipelineOf), its process version, and which keys it carries beyond the raw pin or
// lacks from it.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sdkKeysJson from "../params/sdk-keys.lrc15.json" with { type: "json" };
import type { CommandPayloads, CommandResult } from "../bridge/index.js";
import { CATALOG_READ_TIMEOUT_MS, MAX_PAGE } from "../library/index.js";
import { PROCESS_VERSION_KEY, type SdkSettings } from "../params/index.js";
import { loadSdkKeys, type SdkKeyMap } from "../params/sdk-keys.js";
import { describeError } from "./phase1-check.js";
import type { Json } from "./phase3-config.js";
import { errorBody } from "./phase4-config.js";
import { COLLECTION, label, pipelineOf, type Ctx, type Photo } from "./s10-config.js";

export type Census = { collection: { local_id: number; name: string; photo_count: number }; photos: Photo[] };

/**
 * The dump's file name: s10_<file name>[__<copy name>]__<uuid's first 8>.json (S5Dump.lua's naming,
 * S5Common.lua safeName, plus the uuid: two originals of one file name in different folders would
 * otherwise write the same file; Greptile, PR #96).
 */
export function dumpName(p: Pick<Photo, "filename" | "copy_name" | "uuid">): string {
  const safe = (s: string): string => s.replace(/[\\/:*?"<>|]/g, "_");
  return `s10_${safe(p.filename)}${p.copy_name ? `__${safe(p.copy_name)}` : ""}__${safe(p.uuid).slice(0, 8)}.json`;
}

type Listed = CommandResult<"search_photos">["photos"];

/** Every page of a search (the plugin's page is at most MAX_PAGE; a result past `count` is never asked for). */
export async function allPages(ctx: Ctx, request: Omit<CommandPayloads["search_photos"], "offset" | "limit">): Promise<Listed> {
  const photos: Listed = [];
  for (let offset = 0; ; offset += MAX_PAGE) {
    const page = await ctx.deps.client.request("search_photos", { ...request, offset, limit: MAX_PAGE }, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
    photos.push(...page.photos);
    if (page.photos.length === 0 || photos.length >= page.count) return photos;
  }
}

const text = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** The census entry of one photo from its context and settings. */
export function describe(ctx: Ctx, pinned: SdkKeyMap, context: CommandResult<"get_context">, settings: SdkSettings, selected: string | null): Photo {
  const { pipeline, signals } = pipelineOf(ctx.deps.map, settings);
  const keys = Object.keys(settings);
  return {
    uuid: context.uuid,
    local_id: context.local_id,
    filename: text(context["filename"]) ?? context.uuid,
    copy_name: text(context["copy_name"]),
    is_virtual_copy: context["is_virtual_copy"] === true,
    file_format: text(context["file_format"]),
    pipeline,
    signals,
    process_version: text(settings[PROCESS_VERSION_KEY]),
    key_count: keys.length,
    extra_keys: keys.filter((k) => !pinned.has(k)).sort(),
    missing_pinned_keys: pinned.keys().filter((k) => !(k in settings)).sort(),
    selected: context.uuid === selected,
    start: settings,
  };
}

/** The entry as the results file and the summary carry it (without the settings). */
export function summary(p: Photo): Json {
  const { start: _start, ...rest } = p;
  return rest;
}

const line = (p: Photo): string =>
  `${(p.file_format ?? "?").padEnd(5)} ${label(p).padEnd(44)} ${p.pipeline.padEnd(9)} PV ${p.process_version ?? "?"}  ${p.key_count} keys` +
  `${p.extra_keys.length ? `  +${p.extra_keys.join(",")}` : ""}${p.selected ? "  (selected)" : ""}`;

/** What the rendered photos share: keys in every one, and keys in some only (state, not pipeline). */
function renderedKeys(photos: Photo[]): Json | null {
  const rendered = photos.filter((p) => p.pipeline === "rendered");
  if (rendered.length === 0) return null;
  const sets = rendered.map((p) => new Set(Object.keys(p.start)));
  const shared = [...(sets[0] as Set<string>)].filter((k) => sets.every((s) => s.has(k))).sort();
  const union = new Set(sets.flatMap((s) => [...s]));
  const extraInAll = (rendered[0] as Photo).extra_keys.filter((k) => rendered.every((p) => p.extra_keys.includes(k)));
  return { photos: rendered.length, shared_keys: shared.length, state_keys: [...union].filter((k) => !shared.includes(k)).sort(), extra_keys_in_all: extraInAll, missing_pinned_in_all: (rendered[0] as Photo).missing_pinned_keys.filter((k) => rendered.every((p) => p.missing_pinned_keys.includes(k))) };
}

/** Read the collection's photos; null, with the reason failed, when the collection is missing or empty. */
export async function census(ctx: Ctx): Promise<Census | null> {
  const { client, say, dumpDir } = ctx.deps;
  const out: Json = {};
  ctx.results["census"] = out;
  const listed = await client.request("list_collections", {}, { timeoutMs: CATALOG_READ_TIMEOUT_MS });
  const found = listed.collections.filter((c) => c.name === COLLECTION);
  if (found.length !== 1) {
    ctx.fail(found.length === 0
      ? `Lightroom has no collection named "${COLLECTION}". In Library, make one with that name and add one photo of each file type to it (spikes\\S10\\README.md), then run the command again. Nothing was written.`
      : `Lightroom has ${found.length} collections named "${COLLECTION}"; keep one. Nothing was written.`);
    return null;
  }
  const c = found[0] as (typeof found)[number];
  out["collection"] = { ...c };
  const listedPhotos = await allPages(ctx, { criteria: [], collection_id: c.local_id });
  let selected: string | null = null;
  try {
    selected = (await client.request("get_context", {})).uuid;
  } catch (err) {
    out["selected"] = { error: errorBody(err) }; // nothing selected: the questions and the copies have no photo
  }
  const pinned = loadSdkKeys(sdkKeysJson as unknown);
  const photos: Photo[] = [];
  const skipped: Json[] = [];
  mkdirSync(dumpDir, { recursive: true });
  for (const p of listedPhotos) {
    if (!p.uuid) {
      skipped.push({ local_id: p.local_id, filename: p.filename ?? null, reason: "the plugin could not read its uuid" });
      continue;
    }
    try {
      const context = await client.request("get_context", { photo_uuid: p.uuid });
      const settings = (await client.request("get_settings", { photo_uuid: p.uuid })).settings;
      const photo = describe(ctx, pinned, context, settings, selected);
      photos.push(photo);
      const meta = { spike: "S10", ...summary(photo), local_identifier: photo.local_id, camera_model: context["camera"] ?? null, lens: context["lens"] ?? null, width: context["width"] ?? null, height: context["height"] ?? null, lr_version: context.lrc_version, captured_at: (ctx.deps.now ?? (() => new Date()))().toISOString() };
      writeFileSync(path.join(dumpDir, dumpName(photo)), `${JSON.stringify({ meta, settings }, null, 2)}\n`);
      say(`  ${line(photo)}`);
    } catch (err) {
      skipped.push({ uuid: p.uuid, filename: p.filename ?? null, error: errorBody(err) });
      say(`  ${p.filename ?? p.uuid}: could not be read (${describeError(err)})`);
    }
  }
  const count = (pipeline: string): number => photos.filter((p) => p.pipeline === pipeline).length;
  Object.assign(out, { photos: photos.map(summary), skipped, pipelines: { raw: count("raw"), rendered: count("rendered"), unknown: count("unknown") }, rendered: renderedKeys(photos), dump_dir: dumpDir });
  if (photos.length === 0) {
    ctx.fail(`the collection "${COLLECTION}" holds no photo the plugin could read. Nothing was written.`);
    return null;
  }
  return { collection: { local_id: c.local_id, name: c.name, photo_count: c.photo_count }, photos };
}
